import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

async function getKey() {
  try {
    return (await requireSession()).apiKey;
  } catch (error) {
    if (error instanceof AuthError) return null;
    throw error;
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = await getKey();
  if (!apiKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const response = await fetch(`${API_URL}/files/${encodeURIComponent(id)}`, { headers: { "x-brain-key": apiKey }, cache: "no-store" });
    const data = await response.json().catch(() => ({ error: response.statusText }));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load file" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = await getKey();
  if (!apiKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const response = await fetch(`${API_URL}/files/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-brain-key": apiKey } });
    const data = await response.json().catch(() => ({ error: response.statusText }));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete file" }, { status: 500 });
  }
}
