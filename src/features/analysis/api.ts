import { getJson, postRequest } from "../../shared/api-client";
import type {
  AiUsageSummary,
  Analysis,
  HostAnalysisDetails,
  Location,
} from "./types";

export function getAnalysisFilters(isAi: boolean) {
  return getJson<{ locations: Location[] }>(
    isAi ? "/api/host-ai-analysis-filters" : "/api/host-analysis-filters",
  );
}

export function getAiUsageSummary() {
  return getJson<AiUsageSummary>("/api/host-ai-analysis-usage");
}

export function getAnalyses(url: string) {
  return getJson<{ total: number; analyses: Analysis[] }>(url);
}

export function getHostAnalysisDetails(hostId: string) {
  return getJson<HostAnalysisDetails>(
    `/api/host-analysis-details?id=${encodeURIComponent(hostId)}`,
  );
}

export function saveAnalysisFavorite(hostId: string, favorite: boolean) {
  return postRequest("/api/host-favorite", { hostId, favorite });
}
