import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw error;
  }
  const { id } = await params;
  try {
    const response = await fetch(`${API_URL}/files/${encodeURIComponent(id)}/content`, { headers: { "x-brain-key": apiKey }, cache: "no-store" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: response.statusText }));
      return NextResponse.json(data, { status: response.status });
    }
    const headers = new Headers();
    for (const name of ["content-type", "content-length", "content-disposition", "cache-control"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(response.body, { status: response.status, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to download file" }, { status: 500 });
  }
}
