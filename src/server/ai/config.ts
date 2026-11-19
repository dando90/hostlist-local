export const defaultOpenAiModel = "gpt-6-luna";

export function getOpenAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY non configurata nel file .env");
  return {
    apiKey,
    model: process.env.OPENAI_MODEL?.trim() || defaultOpenAiModel,
  };
}
