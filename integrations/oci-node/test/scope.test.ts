import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScopeGrants,
  effectiveAgentId,
  extractBearerToken,
  hasScopeCapability,
  resolveScopeGrant,
} from "../src/scope.js";

test("default brain key creates an administrative compatibility grant", () => {
  const grants = buildScopeGrants("brain-secret", "default");
  assert.equal(grants.length, 1);
  assert.equal(grants[0].id, "default");
  assert.equal(hasScopeCapability(grants[0], "admin"), true);
  assert.equal(grants[0].includeLegacyThoughts, true);
});

test("custom grant resolves bearer credentials without exposing the secret", () => {
  const grants = buildScopeGrants(undefined, "default", JSON.stringify([{
    id: "codex",
    secret: "codex-secret",
    default_workspace_id: "engineering",
    allowed_workspaces: ["engineering"],
    allowed_projects: ["ob1"],
    capabilities: ["recall", "writeback"],
  }]));
  assert.equal(extractBearerToken("Bearer codex-secret"), "codex-secret");
  const grant = resolveScopeGrant(grants, { authorization: "Bearer codex-secret" });
  assert.equal(grant?.id, "codex");
  assert.equal(hasScopeCapability(grant!, "review"), false);
});

test("non-admin grant cannot impersonate another personal-memory principal", () => {
  const [grant] = buildScopeGrants(undefined, "default", JSON.stringify([{
    id: "codex",
    secret: "codex-secret",
    principal_id: "codex",
    capabilities: ["recall", "writeback"],
  }]));
  assert.equal(effectiveAgentId(grant, "another-agent"), "codex");
});
