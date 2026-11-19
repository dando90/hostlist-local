import fs from "node:fs";
import path from "node:path";

const pricingFile = path.join(process.cwd(), "analysis", "model-pricing-v1.json");

type ModelPrice = {
  serviceTier: string;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  outputUsdPerMillion: number;
};

type PricingConfiguration = {
  version: string;
  currency: "USD";
  vatRate: number;
  models: Record<string, ModelPrice>;
};

export type AiTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
};

export type AiPriceSnapshot = {
  version: string;
  currency: "USD";
  vatRate: number;
  serviceTier: string | null;
  inputUsdPerMillion: number | null;
  cachedInputUsdPerMillion: number | null;
  cacheWriteUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
};

export type AiCostEstimate = AiTokenUsage & {
  netUsd: number | null;
  vatUsd: number | null;
  grossUsd: number | null;
};

function readPricing(): PricingConfiguration {
  const value = JSON.parse(fs.readFileSync(pricingFile, "utf8")) as PricingConfiguration;
  if (!value || value.currency !== "USD" || !Number.isFinite(value.vatRate) || !value.version || !value.models) {
    throw new Error(`Configurazione prezzi non valida: ${pricingFile}`);
  }
  return value;
}

export function getAiPriceSnapshot(modelId: string): AiPriceSnapshot {
  const config = readPricing();
  const model = config.models[modelId];
  return {
    version: config.version,
    currency: config.currency,
    vatRate: config.vatRate,
    serviceTier: model?.serviceTier ?? null,
    inputUsdPerMillion: model?.inputUsdPerMillion ?? null,
    cachedInputUsdPerMillion: model?.cachedInputUsdPerMillion ?? null,
    cacheWriteUsdPerMillion: model?.cacheWriteUsdPerMillion ?? null,
    outputUsdPerMillion: model?.outputUsdPerMillion ?? null,
  };
}

export function extractAiTokenUsage(rawMessage: unknown): AiTokenUsage {
  const raw = rawMessage && typeof rawMessage === "object" ? rawMessage as Record<string, unknown> : {};
  const usage = raw.usage_metadata && typeof raw.usage_metadata === "object" ? raw.usage_metadata as Record<string, unknown> : {};
  const inputDetails = usage.input_token_details && typeof usage.input_token_details === "object" ? usage.input_token_details as Record<string, unknown> : {};
  const outputDetails = usage.output_token_details && typeof usage.output_token_details === "object" ? usage.output_token_details as Record<string, unknown> : {};
  const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cachedInputTokens: count(inputDetails.cache_read),
    cacheWriteTokens: count(inputDetails.cache_creation),
    reasoningTokens: count(outputDetails.reasoning),
  };
}

export function calculateAiCostEstimate(usage: AiTokenUsage, price: AiPriceSnapshot): AiCostEstimate {
  const costFields = [price.inputUsdPerMillion, price.cachedInputUsdPerMillion, price.cacheWriteUsdPerMillion, price.outputUsdPerMillion];
  const hasCompleteUsage = usage.inputTokens !== null && usage.outputTokens !== null;
  const hasRates = price.serviceTier !== null && costFields.every((value) => value !== null && Number.isFinite(value));
  const cached = usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const validInputBreakdown = usage.inputTokens !== null && cached + cacheWrite <= usage.inputTokens;
  const netUsd = hasCompleteUsage && hasRates && validInputBreakdown
    ? ((usage.inputTokens! - cached - cacheWrite) * price.inputUsdPerMillion! + cached * price.cachedInputUsdPerMillion! + cacheWrite * price.cacheWriteUsdPerMillion! + usage.outputTokens! * price.outputUsdPerMillion!) / 1_000_000
    : null;
  const vatUsd = netUsd === null ? null : netUsd * price.vatRate;
  return { ...usage, netUsd, vatUsd, grossUsd: netUsd === null ? null : netUsd + vatUsd! };
}
