import { createHash } from "node:crypto";

export type AnalysisSourceRow = {
  id: string;
  fullname: string | null;
  company: string | null;
  primary_domain: string | null;
  secondary_domain: string | null;
  host_experience_years: string | number | null;
  team_size: string | number | null;
  motivation: string | null;
  specific_skills: string | null;
  offer_extra_info: string | null;
  business_impact: string | unknown[] | null;
};

export type HostAnalysisPayload = {
  company?: string;
  primary_domain?: string;
  secondary_domains?: string[];
  host_experience_years?: number | string;
  team_size?: number | string;
  motivation?: string;
  specific_skills?: string;
  offer_extra_info?: string;
  business_impact?: unknown[];
};

function clean(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").trim();
  return !text || text === "-" ? null : text;
}

function numberOrText(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? number : text;
}

export function buildHostAnalysisPayload(row: AnalysisSourceRow): HostAnalysisPayload {
  const payload: HostAnalysisPayload = {};
  const company = clean(row.company);
  if (company) payload.company = company;
  const primaryDomain = clean(row.primary_domain);
  if (primaryDomain) payload.primary_domain = primaryDomain;
  const secondaryDomains = (clean(row.secondary_domain) ?? "").split(/\n+/).map((value) => value.trim()).filter(Boolean);
  if (secondaryDomains.length) payload.secondary_domains = [...new Set(secondaryDomains)];
  const years = numberOrText(row.host_experience_years);
  if (years !== null) payload.host_experience_years = years;
  const teamSize = numberOrText(row.team_size);
  if (teamSize !== null) payload.team_size = teamSize;
  for (const key of ["motivation", "specific_skills", "offer_extra_info"] as const) {
    const value = clean(row[key]);
    if (value) payload[key] = value;
  }
  let impact = row.business_impact;
  if (typeof impact === "string") {
    try { impact = JSON.parse(impact); } catch { impact = []; }
  }
  if (Array.isArray(impact) && impact.length) payload.business_impact = impact;
  return payload;
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
