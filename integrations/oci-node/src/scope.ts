import { timingSafeEqual } from "node:crypto";

export const SCOPE_VISIBILITIES = [
  "personal",
  "channel",
  "project",
  "workspace",
  "organization",
] as const;

export const SCOPE_CAPABILITIES = [
  "recall",
  "writeback",
  "review",
  "admin",
] as const;

export const SCOPE_MODES = ["auto", "personal", "project", "workspace"] as const;

export type ScopeVisibility = (typeof SCOPE_VISIBILITIES)[number];
export type ScopeCapability = (typeof SCOPE_CAPABILITIES)[number];
export type ScopeMode = (typeof SCOPE_MODES)[number];

export type ScopeGrant = {
  id: string;
  secret: string;
  principalId: string;
  defaultWorkspaceId: string;
  defaultProjectId?: string;
  allowedWorkspaces: string[];
  allowedProjects: string[];
  allowedVisibility: ScopeVisibility[];
  capabilities: ScopeCapability[];
  defaultScopeMode: ScopeMode;
  allowUnconfirmed: boolean;
  includeLegacyThoughts: boolean;
};

type RawScopeGrant = {
  id?: unknown;
  secret?: unknown;
  principal_id?: unknown;
  default_workspace_id?: unknown;
  default_project_id?: unknown;
  allowed_workspaces?: unknown;
  allowed_projects?: unknown;
  allowed_visibility?: unknown;
  capabilities?: unknown;
  default_scope_mode?: unknown;
  allow_unconfirmed?: unknown;
  include_legacy_thoughts?: unknown;
};

export type ScopeAuthRequest = {
  apiKey?: string | null;
  authorization?: string | null;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const values = value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : fallback;
}

function visibilityList(value: unknown, fallback: ScopeVisibility[]): ScopeVisibility[] {
  const values = stringList(value, fallback).filter(
    (item): item is ScopeVisibility =>
      (SCOPE_VISIBILITIES as readonly string[]).includes(item),
  );
  return values.length > 0 ? [...new Set(values)] : fallback;
}

function capabilityList(value: unknown, fallback: ScopeCapability[]): ScopeCapability[] {
  const values = stringList(value, fallback).filter(
    (item): item is ScopeCapability =>
      (SCOPE_CAPABILITIES as readonly string[]).includes(item),
  );
  return values.length > 0 ? [...new Set(values)] : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function scopeMode(value: unknown, fallback: ScopeMode): ScopeMode {
  return typeof value === "string" && (SCOPE_MODES as readonly string[]).includes(value)
    ? (value as ScopeMode)
    : fallback;
}

function parseRawGrant(
  value: unknown,
  index: number,
  defaults: {
    workspaceId: string;
    brainKey?: string;
  },
): ScopeGrant | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const raw = value as RawScopeGrant;
  const secret = nonEmptyString(raw.secret);
  if (!secret) return undefined;

  const id = nonEmptyString(raw.id) ?? `grant-${index + 1}`;
  const defaultWorkspaceId =
    nonEmptyString(raw.default_workspace_id) ?? defaults.workspaceId;
  const principalId = nonEmptyString(raw.principal_id) ?? id;

  return {
    id,
    secret,
    principalId,
    defaultWorkspaceId,
    defaultProjectId: nonEmptyString(raw.default_project_id),
    allowedWorkspaces: stringList(raw.allowed_workspaces, [defaultWorkspaceId]),
    allowedProjects: stringList(raw.allowed_projects, ["*"]),
    allowedVisibility: visibilityList(raw.allowed_visibility, ["personal", "channel", "project", "workspace"]),
    capabilities: capabilityList(raw.capabilities, ["recall", "writeback"]),
    defaultScopeMode: scopeMode(raw.default_scope_mode, "auto"),
    allowUnconfirmed: boolValue(raw.allow_unconfirmed, false),
    includeLegacyThoughts: boolValue(raw.include_legacy_thoughts, false),
  };
}

export function buildScopeGrants(
  brainKey: string | undefined,
  defaultWorkspaceId: string,
  rawJson?: string,
): ScopeGrant[] {
  const grants: ScopeGrant[] = [];

  if (brainKey) {
    grants.push({
      id: "default",
      secret: brainKey,
      principalId: "default",
      defaultWorkspaceId,
      allowedWorkspaces: ["*"],
      allowedProjects: ["*"],
      allowedVisibility: [...SCOPE_VISIBILITIES],
      capabilities: [...SCOPE_CAPABILITIES],
      defaultScopeMode: "auto",
      allowUnconfirmed: true,
      includeLegacyThoughts: true,
    });
  }

  if (rawJson?.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        parsed.forEach((entry, index) => {
          const grant = parseRawGrant(entry, index, { workspaceId: defaultWorkspaceId, brainKey });
          if (grant) grants.push(grant);
        });
      }
    } catch {
      // Configuration validation reports the malformed value separately. Keeping this
      // parser total ensures a bad optional grant cannot take down health checks.
    }
  }

  return grants;
}

function secretsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function extractBearerToken(authorization?: string | null): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || undefined;
}

export function resolveScopeGrant(
  grants: ScopeGrant[],
  request: ScopeAuthRequest,
): ScopeGrant | undefined {
  const provided = request.apiKey?.trim() || extractBearerToken(request.authorization);
  if (!provided) return undefined;
  return grants.find((grant) => secretsEqual(grant.secret, provided));
}

export function hasScopeCapability(grant: ScopeGrant, capability: ScopeCapability): boolean {
  return grant.capabilities.includes(capability) || grant.capabilities.includes("admin");
}

/**
 * A harness may provide an agent label for provenance, but a non-admin grant
 * cannot use that label to impersonate another principal's personal memory.
 */
export function effectiveAgentId(grant: ScopeGrant, requestedAgentId?: string | null): string {
  return hasScopeCapability(grant, "admin") && requestedAgentId?.trim()
    ? requestedAgentId.trim()
    : grant.principalId;
}

export function allowsValue(allowed: string[], value: string | undefined): boolean {
  if (!value) return true;
  return allowed.includes("*") || allowed.includes(value);
}

export function assertScopeGrantCanUse(
  grant: ScopeGrant,
  context: { workspaceId: string; projectId?: string },
): void {
  if (!allowsValue(grant.allowedWorkspaces, context.workspaceId)) {
    throw new Error("Scope grant is not authorized for this workspace");
  }
  if (!allowsValue(grant.allowedProjects, context.projectId)) {
    throw new Error("Scope grant is not authorized for this project");
  }
}

export function canUseVisibility(grant: ScopeGrant, visibility: ScopeVisibility): boolean {
  return grant.allowedVisibility.includes(visibility) || grant.capabilities.includes("admin");
}
