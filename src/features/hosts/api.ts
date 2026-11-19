import {
  getJson,
  postJson,
  postJsonAllowError,
  postRequest,
} from "../../shared/api-client";
import type { Capture, Host, HostDetail, Status } from "./types";

export { getJson };

export function getHostStatus() {
  return getJson<Status>("/api/status");
}

export function getHostDomains() {
  return getJson<{ domains: string[] }>("/api/domains");
}

export function getRecentCaptures() {
  return getJson<{ captures: Capture[] }>("/api/captures");
}

export function getHosts(params: URLSearchParams) {
  return getJson<{ total: number; hosts: Host[] }>(`/api/hosts?${params}`);
}

export function getHostDetail(hostId: string) {
  return getJson<HostDetail>(`/api/host?id=${encodeURIComponent(hostId)}`);
}

export function saveHostFavorite(hostId: string, favorite: boolean) {
  return postRequest("/api/host-favorite", { hostId, favorite });
}

export function runDeterministicAnalysis(
  hostId: string,
  onlyIfMissing = false,
) {
  return postJson<{ ok?: boolean; error?: string }>(
    "/api/host-analyses/deterministic",
    { hostId, ...(onlyIfMissing ? { onlyIfMissing: true } : {}) },
    {
      requireOk: true,
      invalidJsonMessage: (status, responseText) => {
        const excerpt = responseText.trim().slice(0, 180);
        return `Il server ha risposto con HTTP ${status} senza JSON${excerpt ? `: ${excerpt}` : "."}`;
      },
    },
  );
}

export function runAiAnalysis(hostId: string) {
  return postJson<{ ok?: boolean; error?: string; model_id?: string }>(
    "/api/host-ai-analysis",
    { hostId },
    { requireOk: true },
  );
}

export function runAnalysisBatchRequest(endpoint: string, hostId: string) {
  return postJsonAllowError<{
    ok?: boolean;
    skipped?: "already_analyzed" | "in_progress";
    error?: string;
    retryable?: boolean;
    retryAfterMs?: number;
  }>(endpoint, { hostId, onlyIfMissing: true });
}
