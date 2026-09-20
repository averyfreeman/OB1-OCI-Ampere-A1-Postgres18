import assert from "node:assert/strict";
import test from "node:test";

import { classifyIntentHeuristic } from "../src/intent.js";

test("intent heuristic recognizes code-focused requests", () => {
  const result = classifyIntentHeuristic("Why did the Next.js build fail while collecting page data for the API route?");
  assert.equal(result.primary, "code");
  assert.ok(result.confidence > 0.7);
});

test("intent heuristic recognizes research requests", () => {
  const result = classifyIntentHeuristic("Compare the evidence and citations for these two embedding models.");
  assert.equal(result.primary, "research");
});

test("ambiguous follow-up can carry an explicit advisory hint", () => {
  const result = classifyIntentHeuristic("Continue with that", "personal");
  assert.equal(result.primary, "personal");
  assert.equal(result.source, "hint");
});

