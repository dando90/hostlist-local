import {
  analyzeHostDeterministically, getAiAnalysisFilters, getAnalysisFilters, getCaptures, getDomains,
  getAiAnalysisUsageSummary, getHostAiAnalyses, getHostAnalyses, getHostAnalysisDetails, getHosts, getStatus, readHost, saveCapture, saveHostDetail, setHostFavorite,
} from "./store.ts";
import { analyzeHostWithAi } from "./ai/analyze-host.ts";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
function jsonResponse(value: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...jsonHeaders, ...extraHeaders } });
}

function isAllowedExtensionOrigin(origin: string | null) {
  return !origin || origin.startsWith("moz-extension://");
}

function isAllowedLocalDashboardOrigin(origin: string | null, hostHeader: string | null) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const requestHost = (hostHeader ?? "").toLocaleLowerCase("en");
    const hostname = parsed.hostname.toLocaleLowerCase("en");
    const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
    return parsed.protocol === "http:" && parsed.port === "18765" && isLoopback && parsed.host.toLocaleLowerCase("en") === requestHost;
  } catch {
    return false;
  }
}

async function readJsonLimited(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("JSON non valido");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw Object.assign(new Error("Richiesta troppo grande"), { status: 413 });
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  } catch {
    throw new Error("JSON non valido");
  }
}

export async function handleApi(request: Request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS" && ["/api/capture", "/api/host-detail"].includes(pathname)) {
    if (!origin?.startsWith("moz-extension://")) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    } });
  }

  if (request.method === "POST" && ["/api/capture", "/api/host-detail"].includes(pathname)) {
    if (!isAllowedExtensionOrigin(origin)) return new Response(null, { status: 403 });
    const cors: Record<string, string> = origin?.startsWith("moz-extension://") ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
    try {
      const body = await readJsonLimited(request, 8 * 1024 * 1024);
      if (pathname === "/api/capture") return jsonResponse({ ok: true, ...saveCapture(body) }, 200, cors);
      return jsonResponse({ ok: true, ...saveHostDetail(body) }, 200, cors);
    } catch (error) {
      const message = (error as Error).message;
      const status = (error as Error & { status?: number }).status ?? (message === "Host non presente nell'elenco locale" ? 404 : 400);
      const responseMessage = pathname === "/api/capture" && message !== "Endpoint non riconosciuto" ? "Errore locale durante il salvataggio" : message;
      return jsonResponse({ ok: false, error: responseMessage || "JSON non valido" }, status, cors);
    }
  }

  if (request.method === "POST" && pathname === "/api/host-analyses/deterministic") {
    if (!isAllowedLocalDashboardOrigin(origin, request.headers.get("host"))) {
      return jsonResponse({ error: "Origine rifiutata: l'analisi è consentita solo dalla dashboard locale su 127.0.0.1:18765." }, 403);
    }
    try {
      const body = await readJsonLimited(request, 1024);
      const hostId = String(body?.hostId ?? "");
      if (!/^\d+$/.test(hostId)) return jsonResponse({ error: "ID host non valido" }, 400);
      const result = analyzeHostDeterministically(hostId, body?.onlyIfMissing === true);
      return result ? jsonResponse({ ok: true, ...result }) : jsonResponse({ error: "Host non trovato" }, 404);
    } catch (error) {
      console.error("HostList deterministic analysis error:", error);
      const message = (error as Error).message;
      const busy = /SQLITE_BUSY|database is locked/i.test(message);
      return jsonResponse({ error: busy ? "Database occupato; riprova tra poco." : "Errore durante l'analisi deterministica", retryable: busy, code: busy ? "DATABASE_BUSY" : "DETERMINISTIC_ANALYSIS_FAILED" }, busy ? 503 : 500);
    }
  }

  if (request.method === "POST" && pathname === "/api/host-favorite") {
    if (!isAllowedLocalDashboardOrigin(origin, request.headers.get("host"))) return jsonResponse({ error: "Origine rifiutata." }, 403);
    try {
      const body = await readJsonLimited(request, 1024);
      const hostId = String(body?.hostId ?? "");
      if (!/^\d+$/.test(hostId) || typeof body?.favorite !== "boolean") return jsonResponse({ error: "ID host o preferito non valido." }, 400);
      const result = setHostFavorite(hostId, body.favorite);
      return result ? jsonResponse({ ok: true, ...result }) : jsonResponse({ error: "Host non trovato." }, 404);
    } catch (error) {
      const message = (error as Error).message;
      const busy = /SQLITE_BUSY|database is locked/i.test(message);
      return jsonResponse({ error: busy ? "Database occupato; riprova tra poco." : "Errore nel salvataggio del preferito." }, busy ? 503 : 500);
    }
  }

  if (request.method === "POST" && pathname === "/api/host-ai-analysis") {
    if (!isAllowedLocalDashboardOrigin(origin, request.headers.get("host"))) {
      return jsonResponse({ error: "Origine rifiutata: l'analisi è consentita solo dalla dashboard locale." }, 403);
    }
    try {
      const body = await readJsonLimited(request, 1024);
      const hostId = String(body?.hostId ?? "");
      if (!/^\d+$/.test(hostId)) return jsonResponse({ error: "ID host non valido." }, 400);
      const result = await analyzeHostWithAi(hostId, body?.onlyIfMissing === true);
      if (result.skipped === "in_progress") return jsonResponse({ ok: body?.onlyIfMissing === true, skipped: result.skipped, error: "Analisi IA già in corso per questo host.", code: "HOST_AI_IN_PROGRESS", retryable: false }, body?.onlyIfMissing === true ? 200 : 409);
      return jsonResponse({ ok: true, ...result });
    } catch (error) {
      const message = (error as Error).message;
      const detail = error as Error & { status?: number; retryable?: boolean; retryAfterMs?: number; code?: string };
      const busy = /SQLITE_BUSY|database is locked/i.test(message);
      const status = detail.status ?? (busy ? 503 : message.includes("OPENAI_API_KEY") ? 503 : 500);
      const safeMessage = message.includes("OPENAI_API_KEY") ? "Configura OPENAI_API_KEY nel file .env e riavvia il server." : message;
      return jsonResponse({ ok: false, error: safeMessage || "Errore durante l'analisi IA.", code: detail.code ?? (busy ? "DATABASE_BUSY" : "ANALYSIS_FAILED"), retryable: detail.retryable ?? busy, retryAfterMs: detail.retryAfterMs }, status);
    }
  }

  if (request.method !== "GET") return new Response(null, { status: 405 });

  try {
    if (pathname === "/api/status") return jsonResponse(getStatus());
    if (pathname === "/api/domains") return jsonResponse({ domains: getDomains() });
    if (pathname === "/api/hosts") return jsonResponse(getHosts(url.searchParams));
    if (pathname === "/api/captures") return jsonResponse({ captures: getCaptures() });
    if (pathname === "/api/host") {
      const host = readHost(url.searchParams.get("id") ?? "");
      return host ? jsonResponse(host) : jsonResponse({ error: "Profilo non trovato" }, 404);
    }
    if (pathname === "/api/host-analysis-details") {
      const details = getHostAnalysisDetails(url.searchParams.get("id") ?? "");
      return details ? jsonResponse(details) : jsonResponse({ error: "Profilo non trovato." }, 404);
    }
    if (pathname === "/api/host-analyses") {
      try { return jsonResponse(getHostAnalyses(url.searchParams)); }
      catch (error) { return jsonResponse({ error: (error as Error).message }, 400); }
    }
    if (pathname === "/api/host-analysis-filters") return jsonResponse({ locations: getAnalysisFilters() });
    if (pathname === "/api/host-ai-analyses") {
      try { return jsonResponse(getHostAiAnalyses(url.searchParams)); }
      catch (error) { return jsonResponse({ error: (error as Error).message }, 400); }
    }
    if (pathname === "/api/host-ai-analysis-usage") return jsonResponse(getAiAnalysisUsageSummary());
    if (pathname === "/api/host-ai-analysis-filters") return jsonResponse({ locations: getAiAnalysisFilters() });
    return jsonResponse({ error: "Endpoint non trovato" }, 404);
  } catch (error) {
    console.error("HostList API error:", error);
    return jsonResponse({ error: "Errore interno del server locale" }, 500);
  }
}
