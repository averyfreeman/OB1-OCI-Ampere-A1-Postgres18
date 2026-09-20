import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

async function sessionKey() {
  try {
    return (await requireSession()).apiKey;
  } catch (error) {
    if (error instanceof AuthError) return null;
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const apiKey = await sessionKey();
  if (!apiKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const inbound = await request.formData();
    const file = inbound.get("file");
    if (!file || typeof (file as Blob).arrayBuffer !== "function") {
      return NextResponse.json({ error: "file multipart field is required" }, { status: 400 });
    }
    const form = new FormData();
    form.append("file", file as Blob, (file as File).name || "uploaded-file");
    const response = await fetch(`${API_URL}/ingest/file`, {
      method: "POST",
      headers: { "x-brain-key": apiKey },
      body: form,
    });
    const data = await response.json().catch(() => ({ error: response.statusText }));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "File upload failed" }, { status: 500 });
  }
}

export async function GET() {
  const apiKey = await sessionKey();
  if (!apiKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const response = await fetch(`${API_URL}/files`, { headers: { "x-brain-key": apiKey }, cache: "no-store" });
    const data = await response.json().catch(() => ({ error: response.statusText }));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load files" }, { status: 500 });
  }
}
