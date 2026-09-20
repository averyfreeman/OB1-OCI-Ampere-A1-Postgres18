export type AgentMemoryConfig = {
  endpoint: string;
  accessKey: string;
  workspaceId: string;
  projectId?: string;
  sessionId?: string;
  agentId?: string;
  clientSurface?: string;
  requireReviewByDefault?: boolean;
  includeUnconfirmedRecall?: boolean;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
};

function requestInput(input: Record<string, unknown>) {
  return input && typeof input === "object" ? input : {};
}

function projectIdFrom(input: Record<string, unknown>, configuredProjectId?: string) {
  if (configuredProjectId) return configuredProjectId;
  if (typeof input.project_id === "string" || input.project_id === null) return input.project_id;
  return null;
}

export class AgentMemoryClient {
  private endpoint: string;
  private accessKey: string;

  constructor(private config: AgentMemoryConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, "");
    this.accessKey = config.accessKey;
    if (!this.accessKey) {
      throw new Error("OB1 Agent Memory access key missing. Configure plugins.entries.nbj-ob1-agent-memory.config.accessKey.");
    }
  }

  async request(path: string, options: RequestOptions = {}) {
    const response = await fetch(`${this.endpoint}${path}`, {
      method: options.method || "GET",
      headers: {
        "content-type": "application/json",
        "x-brain-key": this.accessKey,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`OB1 Agent Memory API ${response.status}: ${data.error || text}`);
    }
    return data;
  }

  recall(input: Record<string, unknown>) {
    const request = requestInput(input);
    const projectId = projectIdFrom(request, this.config.projectId);
    return this.request("/recall", {
      method: "POST",
      body: {
        ...request,
        schema_version: "openbrain.openclaw.recall.v1",
        workspace_id: this.config.workspaceId,
        project_id: projectId,
        session_id: typeof request.session_id === "string" ? request.session_id : this.config.sessionId || null,
        agent_id: typeof request.agent_id === "string" ? request.agent_id : this.config.agentId || null,
        client_surface: typeof request.client_surface === "string" ? request.client_surface : this.config.clientSurface || "openclaw",
        scope: {
          include_unconfirmed: this.config.includeUnconfirmedRecall ?? false,
          ...(typeof request.scope === "object" && request.scope ? request.scope : {}),
        },
      },
    });
  }

  writeback(input: Record<string, unknown>) {
    const request = requestInput(input);
    const projectId = projectIdFrom(request, this.config.projectId);
    return this.request("/writeback", {
      method: "POST",
      body: {
        ...request,
        schema_version: "openbrain.openclaw.writeback.v1",
        workspace_id: this.config.workspaceId,
        project_id: projectId,
        session_id: typeof request.session_id === "string" ? request.session_id : this.config.sessionId || null,
        agent_id: typeof request.agent_id === "string" ? request.agent_id : this.config.agentId || null,
        client_surface: typeof request.client_surface === "string" ? request.client_surface : this.config.clientSurface || "openclaw",
        provenance: {
          default_status: "generated",
          confidence: 0.5,
          requires_review: this.config.requireReviewByDefault ?? true,
          ...(typeof request.provenance === "object" && request.provenance ? request.provenance : {}),
        },
      },
    });
  }

  reportUsage(requestId: string, input: Record<string, unknown>) {
    return this.request(`/recall/${requestId}/usage`, { method: "POST", body: input });
  }

  inspectMemory(memoryId: string) {
    return this.request(`/memories/${memoryId}`);
  }

  listReviewQueue(input: { workspace_id?: string; project_id?: string } = {}) {
    const workspaceId = input.workspace_id || this.config.workspaceId;
    const projectId = input.project_id || this.config.projectId;
    const params = new URLSearchParams({ workspace_id: workspaceId });
    if (projectId) params.set("project_id", projectId);
    return this.request(`/memories/review?${params.toString()}`);
  }

  reviewMemory(memoryId: string, input: Record<string, unknown>) {
    return this.request(`/memories/${memoryId}/review`, { method: "PATCH", body: input });
  }

  getRecallTrace(requestId: string) {
    return this.request(`/recall-traces/${requestId}`);
  }
}
