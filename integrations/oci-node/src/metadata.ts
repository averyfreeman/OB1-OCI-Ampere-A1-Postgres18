import { AiProvider } from "./provider.js";

const TYPES = new Set([
  "observation",
  "task",
  "idea",
  "reference",
  "person_note",
  "decision",
  "lesson",
  "meeting",
  "journal",
]);

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 30);
}

export function fallbackMetadata(text: string): Record<string, unknown> {
  const lower = text.toLowerCase();
  const type = /\b(todo|next step|ship|implement|fix|review|publish)\b/.test(lower)
    ? "task"
    : /\b(decided|decision|must|should)\b/.test(lower)
      ? "decision"
      : /\b(recipe|docs|reference|guide|url|https?:\/\/)/.test(lower)
        ? "reference"
        : "observation";
  const topics = [
    lower.includes("openclaw") ? "OpenClaw" : null,
    lower.includes("agent memory") ? "Agent Memory" : null,
    lower.includes("dashboard") ? "dashboard" : null,
    lower.includes("nate") ? "Nate Jones" : null,
  ].filter((item): item is string => Boolean(item));
  return {
    people: [],
    topics: topics.length ? topics : ["open brain"],
    action_items: [],
    dates_mentioned: [],
    type,
    summary: text.replace(/\s+/g, " ").trim().slice(0, 240),
    metadata_source: "local-fallback",
  };
}

export function normalizeMetadata(value: Record<string, unknown>, fallbackText: string): Record<string, unknown> {
  const fallback = fallbackMetadata(fallbackText);
  const candidateType = typeof value.type === "string" && TYPES.has(value.type) ? value.type : fallback.type;
  return {
    ...fallback,
    ...value,
    people: stringArray(value.people),
    topics: stringArray(value.topics).slice(0, 12),
    action_items: stringArray(value.action_items).slice(0, 20),
    dates_mentioned: stringArray(value.dates_mentioned).slice(0, 20),
    type: candidateType,
    summary: typeof value.summary === "string" ? value.summary.trim().slice(0, 1000) : fallback.summary,
  };
}

export async function extractMetadata(provider: AiProvider, text: string): Promise<{
  metadata: Record<string, unknown>;
  provider: string;
  model: string;
}> {
  try {
    const result = await provider.extractMetadata(text);
    return {
      metadata: normalizeMetadata(result.value, text),
      provider: result.provider,
      model: result.model,
    };
  } catch {
    const metadata = fallbackMetadata(text);
    return { metadata, provider: "local", model: "fallback" };
  }
}

export function imageMetadata(value: Record<string, unknown>, fallbackText: string): Record<string, unknown> {
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const visibleText = stringArray(value.visible_text);
  const content = [title, description, visibleText.length ? `Visible text: ${visibleText.join(" | ")}` : ""]
    .filter(Boolean)
    .join("\n\n");
  return normalizeMetadata({
    ...value,
    summary: description || title || fallbackText,
    content_origin: "vision_generated",
    evidence_status: "unconfirmed",
  }, content || fallbackText);
}
