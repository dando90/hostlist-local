import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { defaultOpenAiModel, getOpenAiConfig } from "./config.ts";

export const HostAnalysisSchema = z.object({
  scores: z.object({
    software_project: z.number().int().min(1).max(10),
    ai_llm: z.number().int().min(1).max(10),
    mentoring: z.number().int().min(1).max(10),
    technology: z.number().int().min(1).max(10),
    contribution: z.number().int().min(1).max(10),
    networking: z.number().int().min(1).max(10),
  }),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  learning_potential: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.enum(["alta", "media", "bassa"]),
});

export type HostAnalysis = z.infer<typeof HostAnalysisSchema>;

/** Creates the configured server-side model; calls are made only by an explicit host-analysis request. */
export function createPreliminaryModel() {
  const { apiKey, model } = getOpenAiConfig();
  return new ChatOpenAI({ apiKey, model: model || defaultOpenAiModel, timeout: 90_000, maxRetries: 0 });
}
