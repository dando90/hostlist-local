import fs from "node:fs";
import path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { buildHostAnalysisPayload, sha256 } from "../analysis-input.ts";
import { finishHostAiAnalysisRun, getHostAiAnalysisInput, recordHostAiAnalysisUsage, renewHostAiAnalysisRunLease, saveHostAiAnalysis, startHostAiAnalysisRun } from "../store.ts";
import { createPreliminaryModel, HostAnalysisSchema } from "./analysis-schema.ts";
import { getOpenAiConfig } from "./config.ts";
import { extractAiTokenUsage } from "./cost-estimate.ts";

export const hostAiPromptVersion = "host-ai-analysis-v1";

export async function analyzeHostWithAi(hostId: string, onlyIfMissing = false) {
  const row = getHostAiAnalysisInput(hostId);
  if (!row) throw Object.assign(new Error("Host non trovato nel database locale."), { status: 404 });

  const payload = buildHostAnalysisPayload(row as Parameters<typeof buildHostAnalysisPayload>[0]);
  const payloadJson = JSON.stringify(payload);
  const inputHash = sha256(payloadJson);
  const modelId = process.env.OPENAI_MODEL?.trim() || "gpt-6-luna";
  const claim = startHostAiAnalysisRun(hostId, {
    promptVersion: hostAiPromptVersion,
    inputHash,
    modelId,
  }, onlyIfMissing);
  if (claim.state !== "claimed") return { skipped: claim.state };
  const runId = claim.runId;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let runFinished = false;
  const finishRun = (status: "succeeded" | "invalid_response" | "request_failed" | "save_failed") => {
    finishHostAiAnalysisRun(runId, status);
    runFinished = true;
  };
  try {
    heartbeat = setInterval(() => {
      try { renewHostAiAnalysisRunLease(runId); } catch (error) { console.error("HostList AI lease renewal failed:", error); }
    }, 30_000);
    heartbeat.unref?.();
    let config: ReturnType<typeof getOpenAiConfig>;
    try { config = getOpenAiConfig(); }
    catch (error) {
      finishRun("request_failed");
      throw Object.assign(error as Error, { status: 503, retryable: false, code: "MISSING_API_KEY" });
    }
  const promptPath = path.join(process.cwd(), "analysis", "host-analysis-llm-prompt-v1.md");
  const systemPrompt = fs.readFileSync(promptPath, "utf8");
    const structuredModel = createPreliminaryModel().withStructuredOutput(HostAnalysisSchema, {
    name: "host_ai_analysis",
    method: "jsonSchema",
    includeRaw: true,
  });

    let response: { raw?: unknown; parsed?: unknown };
  try {
    response = await structuredModel.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(payloadJson),
    ]) as { raw?: unknown; parsed?: unknown };
  } catch (error) {
    console.error("HostList OpenAI analysis error:", error);
    finishRun("request_failed");
    const source = error as Error & { status?: number; code?: string; headers?: Headers | Record<string, string>; response?: { headers?: Headers | Record<string, string>; status?: number } };
    const status = Number(source?.status ?? source?.response?.status);
    const errorCode = String(source?.code ?? "").toLocaleLowerCase("en");
    // Rate-limit errors can mention adding a payment method in their help URL;
    // classify by the structured error code, not by that incidental URL text.
    const needsUserAction = /insufficient_quota|billing_hard_limit|usage_limit_exceeded|hard_spend_limit/.test(errorCode) || /exceeded your current quota|hard spending limit reached/i.test(source?.message ?? "");
    const retryable = !needsUserAction && (status === 429 || status === 503 || status >= 500 || ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED"].includes(String(source?.code)) || /APIConnectionError|network|fetch failed|timeout/i.test(`${source?.name ?? ""} ${source?.message ?? ""}`));
    const headers = source?.headers ?? source?.response?.headers;
    const retryAfter = headers instanceof Headers ? headers.get("retry-after") : headers && (headers as Record<string, string>)["retry-after"];
    const retryAfterMs = retryAfter ? (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())) : undefined;
    throw Object.assign(new Error(source?.message?.includes("OPENAI_API_KEY") ? source.message : "Il modello non ha restituito un’analisi valida. Verifica la connessione e riprova."), {
      status: source?.message?.includes("OPENAI_API_KEY") ? 503 : status === 429 ? 429 : 502,
      retryable: Boolean(retryable), retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
      code: source?.message?.includes("OPENAI_API_KEY") ? "MISSING_API_KEY" : "MODEL_REQUEST_FAILED",
    });
  }

  recordHostAiAnalysisUsage(runId, extractAiTokenUsage(response.raw));
  const parsed = HostAnalysisSchema.safeParse(response.parsed);
  if (!parsed.success) {
    finishRun("invalid_response");
    throw Object.assign(new Error("La risposta IA non rispetta lo schema previsto; l’analisi precedente è stata mantenuta."), { status: 502, retryable: false, code: "INVALID_RESPONSE" });
  }
  try {
    const saved = saveHostAiAnalysis(hostId, parsed.data, {
      promptVersion: hostAiPromptVersion,
      inputHash,
      modelId: config.model,
    });
    finishRun("succeeded");
    return { ...saved, run_id: runId };
  } catch (error) {
    finishRun("save_failed");
    throw error;
  }
  } catch (error) {
    if (!runFinished) {
      try { finishRun("request_failed"); }
      catch (finishError) { console.error("HostList could not close AI run:", finishError); }
    }
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}
