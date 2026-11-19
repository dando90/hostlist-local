export const AI_WEIGHT_KEYS = [
  "software_project",
  "ai_llm",
  "mentoring",
  "technology",
  "contribution",
  "networking",
] as const;

export type AiWeightKey = (typeof AI_WEIGHT_KEYS)[number];
export type AiWeights = Record<AiWeightKey, number>;

export const DEFAULT_AI_WEIGHTS: AiWeights = {
  software_project: 25,
  ai_llm: 20,
  mentoring: 25,
  technology: 10,
  contribution: 15,
  networking: 5,
};

export const AI_WEIGHT_QUERY_KEYS: Record<AiWeightKey, string> = {
  software_project: "weight_software_project",
  ai_llm: "weight_ai_llm",
  mentoring: "weight_mentoring",
  technology: "weight_technology",
  contribution: "weight_contribution",
  networking: "weight_networking",
};

export const AI_WEIGHT_STORAGE_KEY = "hostlist.ai-analysis-weights.v1";

export function isAiWeightsValue(value: unknown): value is AiWeights {
  if (!value || typeof value !== "object") return false;
  const weights = value as Record<string, unknown>;
  return AI_WEIGHT_KEYS.every((key) => typeof weights[key] === "number" && Number.isFinite(weights[key]) && weights[key] >= 0 && weights[key] <= 100);
}

export function isValidAiWeights(value: unknown): value is AiWeights {
  return isAiWeightsValue(value) && Math.abs(AI_WEIGHT_KEYS.reduce((sum, key) => sum + value[key], 0) - 100) < 0.000001;
}

export function readAiWeights(params: URLSearchParams): AiWeights {
  const entries = AI_WEIGHT_KEYS.map((key) => [key, params.get(AI_WEIGHT_QUERY_KEYS[key])] as const);
  const supplied = entries.filter(([, value]) => value !== null).length;
  if (supplied === 0) return DEFAULT_AI_WEIGHTS;
  if (supplied !== AI_WEIGHT_KEYS.length) throw new Error("Specificare tutti e sei i pesi delle analisi.");
  const parsed = Object.fromEntries(entries.map(([key, value]) => [key, Number(value)])) as AiWeights;
  if (entries.some(([, value]) => value === "" || !Number.isFinite(Number(value))) || !isValidAiWeights(parsed)) {
    throw new Error("I pesi devono essere numeri tra 0 e 100 e sommare a 100.");
  }
  return parsed;
}

export function calculateAiOverallScore(scores: Record<AiWeightKey, number>, weights: AiWeights) {
  const weighted = AI_WEIGHT_KEYS.reduce((sum, key) => sum + scores[key] * weights[key], 0) / 100;
  return Math.round((weighted + Number.EPSILON) * 100) / 100;
}
