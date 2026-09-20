import { AiProvider } from "./provider.js";

export const INTENT_DOMAINS = ["code", "research", "personal", "operations", "general"] as const;
export type IntentDomain = (typeof INTENT_DOMAINS)[number];
export type IntentSource = "hint" | "heuristic" | "session" | "model" | "unknown";

export type IntentResolution = {
  primary: IntentDomain;
  scores: Record<IntentDomain, number>;
  confidence: number;
  source: IntentSource;
};

type IntentInput = {
  query: string;
  hint?: string;
  prior?: Pick<IntentResolution, "primary" | "scores">;
};

const KEYWORDS: Record<IntentDomain, RegExp[]> = {
  code: [
    /\b(code|coding|program|programming|repo|repository|git|commit|branch|pull request|function|class|variable|typescript|javascript|python|rust|go|sql|shell|regex|api|endpoint|schema|migration|build|compile|test|bug|debug|exception|stack trace|error|package|dependency|npm|node|docker|kubernetes|deploy)\b/i,
  ],
  research: [
    /\b(research|study|studies|paper|literature|citation|source|evidence|investigate|investigation|analysis|compare|comparison|survey|market|history|science|academic|benchmark|trade[- ]?off)\b/i,
  ],
  personal: [
    /\b(i prefer|my preference|remember that|about me|family|friend|health|journal|diary|habit|goal|birthday|home|personal|feeling|reflection)\b/i,
  ],
  operations: [
    /\b(server|instance|service|systemd|firewall|network|oci|oracle cloud|monitor|monitoring|alert|incident|uptime|backup|disk|cpu|memory usage|process|log rotation|runbook|maintenance|status)\b/i,
  ],
  general: [],
};

const INTENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    primary: { type: "string", enum: [...INTENT_DOMAINS] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    scores: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(INTENT_DOMAINS.map((domain) => [domain, { type: "number", minimum: 0, maximum: 1 }])),
      required: [...INTENT_DOMAINS],
    },
  },
  required: ["primary", "confidence", "scores"],
};

function emptyScores(): Record<IntentDomain, number> {
  return { code: 0, research: 0, personal: 0, operations: 0, general: 0 };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizeScores(value: unknown): Record<IntentDomain, number> {
  const scores = emptyScores();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const domain of INTENT_DOMAINS) {
      const raw = (value as Record<string, unknown>)[domain];
      if (typeof raw === "number") scores[domain] = clamp(raw);
    }
  }
  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  if (total === 0) scores.general = 1;
  return scores;
}

function highest(scores: Record<IntentDomain, number>): { domain: IntentDomain; score: number; second: number } {
  const ordered = INTENT_DOMAINS
    .map((domain) => ({ domain, score: scores[domain] }))
    .sort((left, right) => right.score - left.score);
  return { domain: ordered[0].domain, score: ordered[0].score, second: ordered[1].score };
}

function confidenceFor(scores: Record<IntentDomain, number>): number {
  const top = highest(scores);
  if (top.domain === "general" && top.score <= 0.35) return 0.35;
  return clamp(0.55 + (top.score * 0.35) + ((top.score - top.second) * 0.35));
}

function validDomain(value: unknown): value is IntentDomain {
  return typeof value === "string" && (INTENT_DOMAINS as readonly string[]).includes(value);
}

export function classifyIntentHeuristic(query: string, hint?: string): IntentResolution {
  const scores = emptyScores();
  const normalized = query.trim();

  for (const domain of INTENT_DOMAINS) {
    for (const pattern of KEYWORDS[domain]) {
      if (pattern.test(normalized)) scores[domain] += 0.35;
    }
  }

  const top = highest(scores);
  if (top.score === 0 && validDomain(hint)) {
    scores[hint] = 0.65;
    scores.general = 0.35;
  } else if (top.score === 0) {
    scores.general = 0.4;
  }

  const resolved = highest(scores);
  return {
    primary: resolved.domain,
    scores,
    confidence: confidenceFor(scores),
    source: top.score === 0 && validDomain(hint) ? "hint" : "heuristic",
  };
}

function sanitizeForClassifier(value: string): string {
  return value
    .replace(/(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, "$1-[redacted]")
    .slice(0, 6000);
}

function fromModel(value: Record<string, unknown>): IntentResolution | undefined {
  const primary = validDomain(value.primary) ? value.primary : undefined;
  if (!primary) return undefined;
  const scores = normalizeScores(value.scores);
  return {
    primary,
    scores,
    confidence: clamp(typeof value.confidence === "number" ? value.confidence : confidenceFor(scores)),
    source: "model",
  };
}

export class IntentResolver {
  constructor(private readonly provider: AiProvider) {}

  async resolve(input: IntentInput): Promise<IntentResolution> {
    const heuristic = classifyIntentHeuristic(input.query, input.hint);
    if (heuristic.confidence >= 0.82 && heuristic.primary !== "general") return heuristic;

    // Short, ambiguous follow-ups should stay in the active session domain. The
    // session is a ranking hint only; authorization is evaluated independently.
    if (input.prior && input.query.trim().split(/\s+/).filter(Boolean).length <= 12 && heuristic.primary === "general") {
      const priorScores = normalizeScores(input.prior.scores);
      return {
        primary: validDomain(input.prior.primary) ? input.prior.primary : highest(priorScores).domain,
        scores: priorScores,
        confidence: 0.68,
        source: "session",
      };
    }

    try {
      const result = await this.provider.structured({
        system: "Classify the user's request into exactly one memory retrieval domain. Use code for software development and exact technical configuration, research for investigation and evidence gathering, personal for user-specific life context, operations for infrastructure and maintenance, and general otherwise. This classification is advisory ranking metadata, never an authorization decision. Do not repeat secrets or private text.",
        user: JSON.stringify({ query: sanitizeForClassifier(input.query), intent_hint: validDomain(input.hint) ? input.hint : undefined, prior_domain: input.prior?.primary }),
        schema: INTENT_SCHEMA,
        maxOutputTokens: 500,
      });
      const modelResolution = fromModel(result.value);
      if (modelResolution) return modelResolution;
    } catch {
      // Intent classification must never make recall or writeback unavailable.
    }

    return heuristic.primary === "general" && heuristic.confidence < 0.5
      ? { ...heuristic, source: "unknown" }
      : heuristic;
  }
}

