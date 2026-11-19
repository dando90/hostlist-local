import { createHash } from "node:crypto";

const groups = {
  software: ["software", "developer", "programming", "web development", "application", "platform", "saas", "database", "api", "automation"],
  ai: ["artificial intelligence", "machine learning", "llm", "generative ai", "chatbot", "data science", "analytics", "predictive", "computer vision", "rag "],
  tech: ["javascript", "typescript", "react", "python", "php", "java", "node.js", "cloud", "sql", "cybersecurity", "engineering", "automation"],
  mentoring: ["mentor", "training", "teach", "coaching", "knowledge transfer", "learning", "guidance", "supervis"],
  practical: ["project", "develop", "implement", "build", "create", "launch", "customer", "sales", "strategy", "product", "service", "prototype"],
  network: ["partner", "network", "international", "customer", "supplier", "market", "sales", "collaboration", "ecosystem"],
};
type Row = Record<string, unknown>;
const text = (value: unknown) => value == null ? "" : typeof value === "string" ? value : Array.isArray(value) ? value.join(" ") : String(value);
function score(corpus: string, terms: string[], base: number, bonus: number, cap: number) {
  const hits = terms.filter((term) => corpus.includes(term));
  return { score: Math.round(Math.min(cap, base + Math.min(bonus, Math.max(0, hits.length - 1) * 0.55 + (hits.length ? 0.65 : 0)))), hits };
}

export function analyzeDeterministically(row: Row) {
  const detail = Object.fromEntries(["secondary_domain", "motivation", "specific_skills", "offer_extra_info", "business_impact", "host_experience_years", "team_size"].map((key) => [key, row[key] ?? null]));
  const corpus = [row.primary_domain, row.secondary_domain, row.company, detail.motivation, detail.specific_skills, detail.offer_extra_info, detail.business_impact].filter(Boolean).map(text).join(" ").toLocaleLowerCase("en");
  const soft = score(corpus, groups.software, 4.8, 3, 9.5);
  const ai = score(corpus, groups.ai, 2.6, 4.4, 9.5);
  const tech = score(corpus, groups.tech, 4, 4.4, 9.5);
  const mentoringHits = groups.mentoring.filter((term) => corpus.includes(term));
  const experience = Number.parseFloat(text(detail.host_experience_years));
  const team = Number.parseInt(text(detail.team_size), 10);
  const mentoring = Math.round(Math.min(8, 4.2 + Math.min(2, mentoringHits.length * 0.6) + (Number.isFinite(experience) && experience >= 5 ? 0.8 : 0) + (Number.isFinite(team) && team >= 5 ? 0.5 : 0) + (detail.motivation ? 0.4 : 0)));
  const practicalHits = groups.practical.filter((term) => corpus.includes(term));
  const contribution = Math.round(Math.min(9, 4 + Math.min(4, practicalHits.length * 0.42) + (detail.offer_extra_info ? 0.4 : 0)));
  const networkHits = groups.network.filter((term) => corpus.includes(term));
  const networking = Math.round(Math.min(8.5, 3.8 + Math.min(3.3, networkHits.length * 0.42) + (Number.isFinite(team) && team >= 10 ? 0.5 : 0)));
  const scores = { software_project: soft.score, ai_llm: ai.score, mentoring, technology: tech.score, contribution, networking };
  const strengths = [soft.hits.length ? `Attività digitali: ${soft.hits.slice(0, 3).join(", ")}.` : "", tech.hits.length ? `Competenze tecniche: ${tech.hits.slice(0, 4).join(", ")}.` : "", ai.hits.length ? `Temi di dati o AI: ${ai.hits.slice(0, 3).join(", ")}.` : "", practicalHits.length ? `Attività pratiche: ${practicalHits.slice(0, 3).join(", ")}.` : ""].filter(Boolean);
  const weaknesses = [!ai.hits.length ? "Non emergono riferimenti espliciti ad AI o dati." : "", !detail.specific_skills ? "Competenze specifiche non descritte." : "", !mentoringHits.length ? "Non sono descritte attività di affiancamento o condivisione." : "", !detail.offer_extra_info ? "Non sono descritti dettagli sulle attività pratiche." : ""].filter(Boolean);
  const input = { primary_domain: row.primary_domain ?? null, secondary_domain: row.secondary_domain ?? null, company: row.company ?? null, detail };
  const top = Object.entries({ software_project: soft.score, ai_llm: ai.score, technology: tech.score }).sort((a, b) => b[1] - a[1])[0][0].replaceAll("_", "/");
  const missing = [detail.motivation, detail.specific_skills, detail.offer_extra_info, detail.business_impact].filter((value) => !value).length;
  return {
    scores,
    strengths: strengths.length ? strengths.slice(0, 4) : ["Il profilo contiene poche evidenze descrittive specifiche."],
    weaknesses: weaknesses.length ? weaknesses.slice(0, 4) : ["Una conversazione diretta è necessaria per verificare il contesto e le attività."],
    learning_potential: ai.hits.length || soft.hits.length >= 3 ? "Possibile apprendimento su sviluppo di soluzioni digitali e pratiche tecniche." : "Le informazioni non bastano a stimare con precisione il potenziale formativo.",
    rationale: `Prima selezione documentale: il profilo emerge soprattutto per ${top}. Il punteggio va verificato con un colloquio mirato.`,
    confidence: missing <= 1 ? "media" : "bassa",
    prompt_version: "deterministic-lexical-v1",
    input_hash: createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex"),
  } as const;
}
