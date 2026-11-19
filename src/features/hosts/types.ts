export type Capture = {
  id: number;
  captured_at: string;
  page_start: number | null;
  page_count: number | null;
  record_count: number;
  total_rows: number | null;
  source_url: string;
};
export type Status = {
  hosts: number;
  captures: number;
  details: number;
  latest: Capture | null;
};
export type Host = {
  id: string;
  fullname: string | null;
  country: string | null;
  city: string | null;
  primary_domain: string | null;
  secondary_domain: string | null;
  primary_country: string | null;
  secondary_country: string | null;
  languages: string | null;
  first_seen?: string;
  last_seen: string;
  detail_captured_at: string | null;
  deterministic_analysis_exists: number;
  ai_analysis_exists: number;
  is_favorite: number;
};
export type HostDetail = Host & {
  savedDetail: {
    capturedAt: string;
    fields: Record<string, unknown>;
    rawJson: string;
  } | null;
};
export type RunState = {
  cancelled: boolean;
  cancel: () => void;
  cancelWaiters: Set<() => void>;
};
export type AnalysisBatch = {
  cancelled: boolean;
  kind: "deterministic" | "ai";
  stopWaiters: Set<() => void>;
};
export type PendingDetail = {
  resolve: (saved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
};
export type ExtensionEvent = {
  type?: string;
  kind?: "list" | "host-detail";
  hostId?: string;
  capturedAt?: string;
};
