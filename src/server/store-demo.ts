import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { analyzeDeterministically } from "./deterministic-analysis.ts";
import { buildHostAnalysisPayload } from "./analysis-input.ts";
import type { HostAnalysis } from "./ai/analysis-schema.ts";
import { calculateAiCostEstimate, getAiPriceSnapshot, type AiPriceSnapshot, type AiTokenUsage } from "./ai/cost-estimate.ts";
import { calculateAiOverallScore, readAiWeights } from "../shared/host-analysis-weights.ts";

const root = process.cwd();
const databasePath = process.env.HOSTLIST_DATABASE_PATH || path.join(root, "data", "hostlist.sqlite3");
const configPath = path.join(root, "config.json");
type FieldMap = { jsonKey: string; columnName: string };
type StoreGlobal = typeof globalThis & { __hostListDb?: DatabaseSync; __hostListStoreInitialized?: boolean };

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function json(value: unknown) {
  return JSON.stringify(value);
}

function decodeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

export function domainParts(value: unknown): string[] {
  return decodeHtml(value).replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, "")
    .split(/\r?\n/).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function normalizedDomain(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("it");
}

let config: { demoOrigin: string };
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (error) {
  throw new Error(`Impossibile leggere ${configPath}: ${(error as Error).message}`);
}
if (!config || typeof config !== "object" || Array.isArray(config) || typeof config.demoOrigin !== "string") {
  throw new Error('Configurazione non valida: "demoOrigin" deve essere una stringa.');
}

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const globalStore = globalThis as StoreGlobal;
export const db = globalStore.__hostListDb ?? new DatabaseSync(databasePath);
if (process.env.NODE_ENV !== "production") globalStore.__hostListDb = db;
// Set the busy handler before any pragma that may need a write lock.
db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
const journalMode = (db.prepare("PRAGMA journal_mode").get() as { journal_mode?: string } | undefined)?.journal_mode;
if (journalMode?.toLocaleLowerCase("en") !== "wal") db.exec("PRAGMA journal_mode=WAL;");
const initializeStore = !globalStore.__hostListStoreInitialized;
if (initializeStore) db.exec(`
  CREATE TABLE IF NOT EXISTS hosts (id TEXT PRIMARY KEY, fullname TEXT, company TEXT, country TEXT, city TEXT, raw_json TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, last_page_start INTEGER, source_url TEXT, is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0,1)));
  CREATE TABLE IF NOT EXISTS captures (id INTEGER PRIMARY KEY AUTOINCREMENT, captured_at TEXT NOT NULL, page_start INTEGER, page_count INTEGER, record_count INTEGER NOT NULL, total_rows INTEGER, source_url TEXT NOT NULL, response_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS host_details (host_id TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE, captured_at TEXT NOT NULL, source_url TEXT NOT NULL, raw_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS detail_field_map (json_key TEXT PRIMARY KEY, column_name TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS host_field_map (json_key TEXT PRIMARY KEY, column_name TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS host_analyses (host_id TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE, software_project_score REAL NOT NULL CHECK(software_project_score BETWEEN 1 AND 10), ai_llm_score REAL NOT NULL CHECK(ai_llm_score BETWEEN 1 AND 10), mentoring_score REAL NOT NULL CHECK(mentoring_score BETWEEN 1 AND 10), technology_score REAL NOT NULL CHECK(technology_score BETWEEN 1 AND 10), contribution_score REAL NOT NULL CHECK(contribution_score BETWEEN 1 AND 10), networking_score REAL NOT NULL CHECK(networking_score BETWEEN 1 AND 10), strengths_json TEXT NOT NULL, weaknesses_json TEXT NOT NULL, learning_potential TEXT NOT NULL, rationale TEXT NOT NULL, confidence TEXT NOT NULL CHECK(confidence IN ('alta','media','bassa')), analyzed_at TEXT NOT NULL, prompt_version TEXT NOT NULL, input_hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS host_ai_analyses (host_id TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE, software_project_score REAL NOT NULL CHECK(software_project_score BETWEEN 1 AND 10), ai_llm_score REAL NOT NULL CHECK(ai_llm_score BETWEEN 1 AND 10), mentoring_score REAL NOT NULL CHECK(mentoring_score BETWEEN 1 AND 10), technology_score REAL NOT NULL CHECK(technology_score BETWEEN 1 AND 10), contribution_score REAL NOT NULL CHECK(contribution_score BETWEEN 1 AND 10), networking_score REAL NOT NULL CHECK(networking_score BETWEEN 1 AND 10), strengths_json TEXT NOT NULL, weaknesses_json TEXT NOT NULL, learning_potential TEXT NOT NULL, rationale TEXT NOT NULL, confidence TEXT NOT NULL CHECK(confidence IN ('alta','media','bassa')), analyzed_at TEXT NOT NULL, prompt_version TEXT NOT NULL, input_hash TEXT NOT NULL, model_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS host_ai_analysis_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('started','response_received','succeeded','invalid_response','request_failed','save_failed')),
    lease_expires_at INTEGER,
    prompt_version TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    model_id TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cached_input_tokens INTEGER,
    cache_write_tokens INTEGER,
    reasoning_tokens INTEGER,
    pricing_version TEXT NOT NULL,
    currency TEXT NOT NULL,
    service_tier TEXT,
    input_usd_per_million REAL,
    cached_input_usd_per_million REAL,
    cache_write_usd_per_million REAL,
    output_usd_per_million REAL,
    vat_rate REAL NOT NULL,
    cost_net_usd REAL,
    vat_usd REAL,
    cost_gross_usd REAL
  );
  CREATE INDEX IF NOT EXISTS idx_hosts_fullname ON hosts(fullname);
  CREATE INDEX IF NOT EXISTS idx_hosts_country ON hosts(country);
  CREATE INDEX IF NOT EXISTS idx_hosts_last_seen ON hosts(last_seen DESC);
  CREATE INDEX IF NOT EXISTS idx_host_ai_runs_host ON host_ai_analysis_runs(host_id,started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_host_ai_runs_date ON host_ai_analysis_runs(started_at DESC);
`);

function migrateAiAnalysisRunLeases() {
  const columns = db.prepare("PRAGMA table_info(host_ai_analysis_runs)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "lease_expires_at")) {
    db.exec("ALTER TABLE host_ai_analysis_runs ADD COLUMN lease_expires_at INTEGER");
    const active = db.prepare("SELECT id,started_at FROM host_ai_analysis_runs WHERE status IN ('started','response_received')").all() as { id: number; started_at: string }[];
    const update = db.prepare("UPDATE host_ai_analysis_runs SET status=?,completed_at=?,lease_expires_at=? WHERE id=?");
    const now = Date.now();
    for (const run of active) {
      const expiresAt = Date.parse(run.started_at) + 180_000;
      if (!Number.isFinite(expiresAt) || expiresAt <= now) update.run("request_failed", new Date().toISOString(), null, run.id);
      else db.prepare("UPDATE host_ai_analysis_runs SET lease_expires_at=? WHERE id=?").run(expiresAt, run.id);
    }
  }
  db.prepare("UPDATE host_ai_analysis_runs SET status='request_failed',completed_at=?,lease_expires_at=NULL WHERE status IN ('started','response_received') AND lease_expires_at<=?")
    .run(new Date().toISOString(), Date.now());
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_host_ai_runs_active_host ON host_ai_analysis_runs(host_id) WHERE status IN ('started','response_received')");
}

function migrateHostFavorites() {
  const columns = db.prepare("PRAGMA table_info(hosts)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "is_favorite")) db.exec("ALTER TABLE hosts ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0,1))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_hosts_favorite ON hosts(is_favorite,id)");
}

function migrateDeterministicAnalysisTotals() {
  const columns = db.prepare("PRAGMA table_info(host_analyses)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "overall_score")) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`DROP INDEX IF EXISTS idx_host_analyses_score;
      CREATE TABLE host_analyses_without_total (
        host_id TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
        software_project_score REAL NOT NULL CHECK(software_project_score BETWEEN 1 AND 10),
        ai_llm_score REAL NOT NULL CHECK(ai_llm_score BETWEEN 1 AND 10),
        mentoring_score REAL NOT NULL CHECK(mentoring_score BETWEEN 1 AND 10),
        technology_score REAL NOT NULL CHECK(technology_score BETWEEN 1 AND 10),
        contribution_score REAL NOT NULL CHECK(contribution_score BETWEEN 1 AND 10),
        networking_score REAL NOT NULL CHECK(networking_score BETWEEN 1 AND 10),
        strengths_json TEXT NOT NULL, weaknesses_json TEXT NOT NULL, learning_potential TEXT NOT NULL,
        rationale TEXT NOT NULL, confidence TEXT NOT NULL CHECK(confidence IN ('alta','media','bassa')),
        analyzed_at TEXT NOT NULL, prompt_version TEXT NOT NULL, input_hash TEXT NOT NULL
      );
      INSERT INTO host_analyses_without_total(host_id,software_project_score,ai_llm_score,mentoring_score,technology_score,contribution_score,networking_score,strengths_json,weaknesses_json,learning_potential,rationale,confidence,analyzed_at,prompt_version,input_hash)
      SELECT host_id,software_project_score,ai_llm_score,mentoring_score,technology_score,contribution_score,networking_score,strengths_json,weaknesses_json,learning_potential,rationale,confidence,analyzed_at,prompt_version,input_hash FROM host_analyses;
      DROP TABLE host_analyses;
      ALTER TABLE host_analyses_without_total RENAME TO host_analyses;
      CREATE INDEX idx_host_analyses_date ON host_analyses(analyzed_at DESC,host_id ASC);`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

if (initializeStore) {
  migrateAiAnalysisRunLeases();
  migrateHostFavorites();
  migrateDeterministicAnalysisTotals();
  db.exec("CREATE INDEX IF NOT EXISTS idx_host_analyses_date ON host_analyses(analyzed_at DESC,host_id ASC)");
}

function migrateAiAnalysisTotals() {
  const columns = db.prepare("PRAGMA table_info(host_ai_analyses)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "overall_score")) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DROP INDEX IF EXISTS idx_host_ai_analyses_score; ALTER TABLE host_ai_analyses RENAME TO host_ai_analyses_with_total;");
    db.exec(`CREATE TABLE host_ai_analyses (
      host_id TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
      software_project_score REAL NOT NULL CHECK(software_project_score BETWEEN 1 AND 10),
      ai_llm_score REAL NOT NULL CHECK(ai_llm_score BETWEEN 1 AND 10),
      mentoring_score REAL NOT NULL CHECK(mentoring_score BETWEEN 1 AND 10),
      technology_score REAL NOT NULL CHECK(technology_score BETWEEN 1 AND 10),
      contribution_score REAL NOT NULL CHECK(contribution_score BETWEEN 1 AND 10),
      networking_score REAL NOT NULL CHECK(networking_score BETWEEN 1 AND 10),
      strengths_json TEXT NOT NULL, weaknesses_json TEXT NOT NULL, learning_potential TEXT NOT NULL,
      rationale TEXT NOT NULL, confidence TEXT NOT NULL CHECK(confidence IN ('alta','media','bassa')),
      analyzed_at TEXT NOT NULL, prompt_version TEXT NOT NULL, input_hash TEXT NOT NULL, model_id TEXT NOT NULL
    );
    INSERT INTO host_ai_analyses(host_id,software_project_score,ai_llm_score,mentoring_score,technology_score,contribution_score,networking_score,strengths_json,weaknesses_json,learning_potential,rationale,confidence,analyzed_at,prompt_version,input_hash,model_id)
    SELECT host_id,software_project_score,ai_llm_score,mentoring_score,technology_score,contribution_score,networking_score,strengths_json,weaknesses_json,learning_potential,rationale,confidence,analyzed_at,prompt_version,input_hash,model_id FROM host_ai_analyses_with_total;
    DROP TABLE host_ai_analyses_with_total;
    CREATE INDEX idx_host_ai_analyses_date ON host_ai_analyses(analyzed_at DESC,host_id ASC);`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

if (initializeStore) {
  migrateAiAnalysisTotals();
  db.exec("CREATE INDEX IF NOT EXISTS idx_host_ai_analyses_date ON host_ai_analyses(analyzed_at DESC,host_id ASC)");
}

const detailBaseColumns = new Set(["host_id", "captured_at", "source_url", "raw_json"]);
const hostServiceColumns = new Set(["raw_json", "first_seen", "last_seen", "last_page_start", "source_url", "is_favorite"]);
function columnBase(key: string, reserved: Set<string>) {
  let name = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  if (!name || /^\d/.test(name)) name = `field_${name || "value"}`;
  if (reserved.has(name)) name = `${name}_field`;
  return name;
}
function encodeField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") return json(value) ?? null;
  return String(value);
}
function ensureFields(table: "hosts" | "host_details", mapTable: "host_field_map" | "detail_field_map", payload: Record<string, unknown>): FieldMap[] {
  const existing = db.prepare(`SELECT json_key AS jsonKey, column_name AS columnName FROM ${mapTable}`).all() as FieldMap[];
  const map = new Map(existing.map((field) => [field.jsonKey, field.columnName]));
  const reserved = table === "hosts" ? hostServiceColumns : detailBaseColumns;
  const used = new Set([...reserved, ...existing.map((field) => field.columnName)]);
  const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((item) => item.name));
  const insert = db.prepare(`INSERT INTO ${mapTable} (json_key, column_name) VALUES (?, ?)`);
  for (const key of Object.keys(payload)) {
    if (map.has(key)) continue;
    const base = key === "id" ? "id" : columnBase(key, reserved);
    let column = base;
    for (let suffix = 2; used.has(column) || columns.has(column); suffix++) column = `${base}_${suffix}`;
    if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${quoteIdentifier(column)} TEXT`);
    insert.run(key, column);
    map.set(key, column);
    used.add(column);
    columns.add(column);
  }
  return [...map].map(([jsonKey, columnName]) => ({ jsonKey, columnName }));
}

function migrateExistingColumns() {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [key, column] of [["id", "id"], ["fullname", "fullname"], ["company", "company"], ["country", "country"], ["city", "city"], ["primary_domain", "primary_domain"], ["secondary_domain", "secondary_domain"], ["primary_country", "primary_country"], ["secondary_country", "secondary_country"], ["languages", "languages"]]) {
      const found = db.prepare("SELECT 1 FROM host_field_map WHERE json_key=?").get(key);
      if (!found) db.prepare("INSERT INTO host_field_map(json_key,column_name) VALUES(?,?)").run(key, column);
      if (!(db.prepare("PRAGMA table_info(hosts)").all() as { name: string }[]).some((item) => item.name === column)) db.exec(`ALTER TABLE hosts ADD COLUMN ${quoteIdentifier(column)} TEXT`);
    }
    const hosts = db.prepare("SELECT id,raw_json FROM hosts").all() as { id: string; raw_json: string }[];
    for (const host of hosts) ensureFields("hosts", "host_field_map", JSON.parse(host.raw_json));
    const details = db.prepare("SELECT host_id,raw_json FROM host_details").all() as { host_id: string; raw_json: string }[];
    for (const detail of details) ensureFields("host_details", "detail_field_map", JSON.parse(detail.raw_json));
    const hostFields = db.prepare("SELECT json_key AS jsonKey,column_name AS columnName FROM host_field_map").all() as FieldMap[];
    const detailFields = db.prepare("SELECT json_key AS jsonKey,column_name AS columnName FROM detail_field_map").all() as FieldMap[];
    for (const host of hosts) {
      const record = JSON.parse(host.raw_json);
      for (const field of hostFields) if (field.columnName !== "id") db.prepare(`UPDATE hosts SET ${quoteIdentifier(field.columnName)}=? WHERE id=?`).run(encodeField(record[field.jsonKey]), host.id);
    }
    for (const detail of details) {
      const record = JSON.parse(detail.raw_json);
      const sets = detailFields.map((field) => `${quoteIdentifier(field.columnName)}=?`).join(",");
      if (sets) db.prepare(`UPDATE host_details SET ${sets} WHERE host_id=?`).run(...detailFields.map((field) => encodeField(record[field.jsonKey])), detail.host_id);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
if (initializeStore) {
  migrateExistingColumns();
  globalStore.__hostListStoreInitialized = true;
}

export const nowIso = () => new Date().toISOString().replace(".000Z", "Z");
const hostFields = ["fullname", "company", "country", "city", "primary_domain", "secondary_domain", "primary_country", "secondary_country", "languages"] as const;
const detailFields = ["host_experience_years", "team_size", "motivation", "specific_skills", "offer_extra_info", "business_impact"] as const;
function recordsFrom(payload: any) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.records)) throw new Error("Elenco demo non valido");
  const records: Record<string, unknown>[] = (payload.records as unknown[]).filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).map((item) => {
    const record: Record<string, unknown> = { id: String(item.id ?? "") };
    for (const key of hostFields) if (item[key] !== undefined) record[key] = item[key];
    for (const key of detailFields) if (item[key] !== undefined) record[key] = item[key];
    return record;
  }).filter((item: Record<string, unknown>) => Boolean(item.id));
  const totalRows = Number.isFinite(Number(payload.totalRows)) ? Number(payload.totalRows) : null;
  return { records, totalRows };
}

export function saveCapture(body: any) {
  const { payload, sourceUrl } = body || {};
  if (!payload || typeof payload !== "object" || typeof sourceUrl !== "string") throw new Error("Payload o URL sorgente mancante");
  const source = new URL(sourceUrl);
  const configuredOrigin = new URL(config.demoOrigin);
  if (source.origin !== configuredOrigin.origin || !/^\/(?:projects\/hostlist-server\/)?demo-api\/hosts\/?$/.test(source.pathname)) throw new Error("Sorgente demo non riconosciuta");
  const { records, totalRows } = recordsFrom(payload);
  const pageStart = Number.parseInt(source.searchParams.get("pageStart") ?? "", 10) || null;
  const pageCount = Number.parseInt(source.searchParams.get("pageCount") ?? "", 10) || null;
  const timestamp = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    const capture = db.prepare("INSERT INTO captures(captured_at,page_start,page_count,record_count,total_rows,source_url,response_json) VALUES(?,?,?,?,?,?,?)");
    const result = capture.run(timestamp, pageStart, pageCount, records.length, totalRows, sourceUrl, json({ records, totalRows }));
    const accepted: { row: Record<string, unknown>; id: string }[] = records.map((row) => ({ row, id: String(row.id ?? "") })).filter(({ id }) => Boolean(id));
    const fieldsById = accepted.map(({ row, id }) => ({ row, id, fields: ensureFields("hosts", "host_field_map", row) }));
    const fields = [...new Set(fieldsById.flatMap((item) => item.fields.map((field) => field.columnName)))].filter((column) => column !== "id");
    const columns = ["id", ...fields, "raw_json", "first_seen", "last_seen", "last_page_start", "source_url"];
    const upsert = db.prepare(`INSERT INTO hosts(${columns.map(quoteIdentifier).join(",")}) VALUES(${columns.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${[...fields.map((column) => `${quoteIdentifier(column)}=excluded.${quoteIdentifier(column)}`), "raw_json=excluded.raw_json", "last_seen=excluded.last_seen", "last_page_start=excluded.last_page_start", "source_url=excluded.source_url"].join(",")}`);
    const fieldMap = new Map((db.prepare("SELECT json_key,column_name FROM host_field_map").all() as { json_key: string; column_name: string }[]).map((row) => [row.column_name, row.json_key]));
    for (const { row, id } of fieldsById) {
      const prior = db.prepare("SELECT first_seen FROM hosts WHERE id=?").get(id) as { first_seen?: string } | undefined;
      const values = [id, ...fields.map((column) => encodeField(row[fieldMap.get(column) ?? ""])), json(row), prior?.first_seen ?? timestamp, timestamp, pageStart, sourceUrl];
      upsert.run(...values);
    }
    db.exec("COMMIT");
    return { captureId: Number(result.lastInsertRowid), savedRows: records.length, totalRows, totalHosts: (db.prepare("SELECT COUNT(*) AS n FROM hosts").get() as { n: number }).n, pageStart, capturedAt: timestamp };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function saveHostDetail(body: any) {
  const { payload, sourceUrl } = body || {};
  if (!payload || typeof payload !== "object" || typeof sourceUrl !== "string") throw new Error("Payload o URL del dettaglio mancante");
  const source = new URL(sourceUrl);
  const configuredOrigin = new URL(config.demoOrigin);
  const match = source.pathname.match(/^\/(?:projects\/hostlist-server\/)?demo-api\/hosts\/([a-zA-Z0-9_-]+)\/?$/);
  if (source.origin !== configuredOrigin.origin || !match) throw new Error("Sorgente demo non riconosciuta");
  const hostId = match[1];
  if (String(payload.id ?? payload.hostId ?? "") !== hostId) throw new Error("ID host non corrispondente");
  const cleanPayload: Record<string, unknown> = {};
  for (const key of detailFields) if (payload[key] !== undefined) cleanPayload[key] = payload[key];
  if (!db.prepare("SELECT id FROM hosts WHERE id=?").get(hostId)) throw new Error("Host non presente nell'elenco locale");
  const capturedAt = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    const fields = ensureFields("host_details", "detail_field_map", cleanPayload);
    const columns = ["host_id", "captured_at", "source_url", "raw_json", ...fields.map((field) => field.columnName)];
    const values = [hostId, capturedAt, sourceUrl, json(cleanPayload), ...fields.map((field) => encodeField(cleanPayload[field.jsonKey]))];
    db.prepare(`INSERT INTO host_details(${columns.map(quoteIdentifier).join(",")}) VALUES(${columns.map(() => "?").join(",")}) ON CONFLICT(host_id) DO UPDATE SET ${columns.slice(1).map((column) => `${quoteIdentifier(column)}=excluded.${quoteIdentifier(column)}`).join(",")}`).run(...values);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { hostId, capturedAt };
}

export function readHost(hostId: string) {
  const host = db.prepare("SELECT * FROM hosts WHERE id=?").get(hostId) as Record<string, any> | undefined;
  if (!host) return null;
  delete host.raw_json;
  host.primary_domain = host.primary_domain ?? null; host.secondary_domain = host.secondary_domain ?? null;
  host.primary_country = host.primary_country ?? null; host.secondary_country = host.secondary_country ?? null; host.languages = host.languages ?? null;
  const detail = db.prepare("SELECT * FROM host_details WHERE host_id=?").get(hostId) as Record<string, any> | undefined;
  if (!detail) { host.savedDetail = null; return host; }
  const raw = JSON.parse(detail.raw_json);
  const fields: Record<string, unknown> = {};
  const maps = db.prepare("SELECT json_key AS jsonKey,column_name AS columnName FROM detail_field_map").all() as FieldMap[];
  for (const field of maps) {
    if (!Object.hasOwn(raw, field.jsonKey)) continue;
    const stored = detail[field.columnName]; const original = raw[field.jsonKey];
    fields[field.jsonKey] = stored == null || original == null ? null : typeof original === "string" ? stored : typeof original === "boolean" ? stored === "true" : typeof original === "number" ? Number(stored) : JSON.parse(stored);
  }
  host.savedDetail = { capturedAt: detail.captured_at, fields, rawJson: detail.raw_json };
  return host;
}

export function getStatus() {
  return {
    hosts: (db.prepare("SELECT COUNT(*) n FROM hosts").get() as { n: number }).n,
    captures: (db.prepare("SELECT COUNT(*) n FROM captures").get() as { n: number }).n,
    details: (db.prepare("SELECT COUNT(*) n FROM host_details").get() as { n: number }).n,
    latest: db.prepare("SELECT * FROM captures ORDER BY id DESC LIMIT 1").get() ?? null,
  };
}
export function getDomains() {
  const rows = db.prepare("SELECT primary_domain AS primary_domain,secondary_domain AS secondary_domain FROM hosts").all() as { primary_domain: string; secondary_domain: string }[];
  const unique = new Map<string, string>();
  for (const row of rows) for (const label of [...domainParts(row.primary_domain), ...domainParts(row.secondary_domain)]) {
    const key = normalizedDomain(label); if (key && !unique.has(key)) unique.set(key, label);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
}
export function getHosts(search: URLSearchParams) {
  const query = (search.get("q") ?? "").trim(); const selectedDomain = (search.get("domain") ?? "").trim();
  const favoritesOnly = search.get("favorites") === "1";
  const limit = Math.min(Math.max(Number.parseInt(search.get("limit") ?? "100", 10) || 100, 1), 500);
  const offset = Math.max(Number.parseInt(search.get("offset") ?? "0", 10) || 0, 0);
  const select = `SELECT h.id,h.fullname,h.country,h.city,h.primary_domain AS primary_domain,h.secondary_domain AS secondary_domain,h.primary_country AS primary_country,h.languages AS languages,h.last_seen,h.is_favorite,d.captured_at AS detail_captured_at,CASE WHEN a.host_id IS NULL THEN 0 ELSE 1 END AS deterministic_analysis_exists,CASE WHEN ai.host_id IS NULL THEN 0 ELSE 1 END AS ai_analysis_exists FROM hosts h LEFT JOIN host_details d ON d.host_id=h.id LEFT JOIN host_analyses a ON a.host_id=h.id LEFT JOIN host_ai_analyses ai ON ai.host_id=h.id`;
  const pattern = `%${query}%`;
  let rows = (query ? db.prepare(`${select} WHERE h.fullname LIKE ? OR h.country LIKE ? OR h.city LIKE ? OR h.id LIKE ? ORDER BY h.last_seen DESC`).all(pattern, pattern, pattern, pattern) : db.prepare(`${select} ORDER BY h.last_seen DESC`).all()) as Record<string, any>[];
  if (selectedDomain) { const target = normalizedDomain(selectedDomain); rows = rows.filter((row) => [...domainParts(row.primary_domain), ...domainParts(row.secondary_domain)].some((part) => normalizedDomain(part) === target)); }
  if (favoritesOnly) rows = rows.filter((row) => row.is_favorite === 1);
  return { total: rows.length, hosts: rows.slice(offset, offset + limit) };
}

export function setHostFavorite(hostId: string, favorite: boolean) {
  const result = db.prepare("UPDATE hosts SET is_favorite=? WHERE id=?").run(favorite ? 1 : 0, hostId);
  if (!result.changes) return null;
  return { hostId, is_favorite: favorite ? 1 : 0 };
}

export function getHostAnalysisDetails(hostId: string) {
  const host = db.prepare("SELECT raw_json,first_seen,last_seen FROM hosts WHERE id=?").get(hostId) as { raw_json: string; first_seen: string; last_seen: string } | undefined;
  if (!host) return null;
  const detail = db.prepare("SELECT raw_json,captured_at FROM host_details WHERE host_id=?").get(hostId) as { raw_json: string; captured_at: string } | undefined;
  const synthetic = JSON.parse(host.raw_json) as Record<string, unknown>;
  const full = detail ? JSON.parse(detail.raw_json) as Record<string, unknown> : {};
  const source = { id: hostId, fullname: synthetic.fullname, company: synthetic.company,
    primary_domain: synthetic.primary_domain, secondary_domain: full.secondary_domain ?? synthetic.secondary_domain,
    host_experience_years: full.host_experience_years ?? synthetic.host_experience_years,
    team_size: full.team_size ?? synthetic.team_size, motivation: full.motivation ?? synthetic.motivation,
    specific_skills: full.specific_skills ?? synthetic.specific_skills,
    offer_extra_info: full.offer_extra_info ?? synthetic.offer_extra_info,
    business_impact: full.business_impact ?? synthetic.business_impact } as Parameters<typeof buildHostAnalysisPayload>[0];
  const professional = Object.fromEntries(Object.entries(full).filter(([key, value]) =>
    detailFields.includes(key as typeof detailFields[number]) && value !== null && value !== undefined && value !== ""));
  return {
    hostId,
    capturedAt: detail?.captured_at ?? null,
    firstSeen: host.first_seen,
    lastSeen: host.last_seen,
    modelPayload: buildHostAnalysisPayload(source),
    professional,
    website: null as string | null,
  };
}
export function getCaptures() { return db.prepare("SELECT id,captured_at,page_start,page_count,record_count,total_rows,source_url FROM captures ORDER BY id DESC LIMIT 3").all(); }

export function getHostAiAnalysisInput(hostId: string) {
  const host = db.prepare("SELECT raw_json FROM hosts WHERE id=?").get(hostId) as { raw_json: string } | undefined;
  if (!host) return undefined;
  const detail = db.prepare("SELECT raw_json FROM host_details WHERE host_id=?").get(hostId) as { raw_json: string } | undefined;
  return { ...(JSON.parse(host.raw_json) as Record<string, unknown>), ...(detail ? JSON.parse(detail.raw_json) as Record<string, unknown> : {}) };
}

export function startHostAiAnalysisRun(hostId: string, metadata: { promptVersion: string; inputHash: string; modelId: string }, onlyIfMissing = false) {
  const price = getAiPriceSnapshot(metadata.modelId);
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE host_ai_analysis_runs SET status='request_failed',completed_at=?,lease_expires_at=NULL WHERE status IN ('started','response_received') AND lease_expires_at<=?")
      .run(new Date(now).toISOString(), now);
    if (onlyIfMissing && db.prepare("SELECT 1 FROM host_ai_analyses WHERE host_id=?").get(hostId)) {
      db.exec("COMMIT");
      return { state: "already_analyzed" as const };
    }
    if (db.prepare("SELECT 1 FROM host_ai_analysis_runs WHERE host_id=? AND status IN ('started','response_received') LIMIT 1").get(hostId)) {
      db.exec("COMMIT");
      return { state: "in_progress" as const };
    }
    const result = db.prepare(`INSERT INTO host_ai_analysis_runs(host_id,started_at,status,lease_expires_at,prompt_version,input_hash,model_id,pricing_version,currency,service_tier,input_usd_per_million,cached_input_usd_per_million,cache_write_usd_per_million,output_usd_per_million,vat_rate)
      VALUES(?,?,'started',?,?,?,?,?,?,?,?,?,?,?,?)`).run(hostId, new Date(now).toISOString(), now + 180_000, metadata.promptVersion, metadata.inputHash, metadata.modelId,
      price.version, price.currency, price.serviceTier, price.inputUsdPerMillion, price.cachedInputUsdPerMillion, price.cacheWriteUsdPerMillion, price.outputUsdPerMillion, price.vatRate);
    db.exec("COMMIT");
    return { state: "claimed" as const, runId: Number(result.lastInsertRowid) };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* La transazione potrebbe essere già stata chiusa. */ }
    throw error;
  }
}

export function renewHostAiAnalysisRunLease(runId: number) {
  return db.prepare("UPDATE host_ai_analysis_runs SET lease_expires_at=? WHERE id=? AND status IN ('started','response_received')")
    .run(Date.now() + 180_000, runId).changes > 0;
}

export function recordHostAiAnalysisUsage(runId: number, usage: AiTokenUsage) {
  const row = db.prepare(`SELECT pricing_version,currency,service_tier,input_usd_per_million,cached_input_usd_per_million,cache_write_usd_per_million,output_usd_per_million,vat_rate
    FROM host_ai_analysis_runs WHERE id=?`).get(runId) as {
      pricing_version: string; currency: "USD"; service_tier: string | null; input_usd_per_million: number | null;
      cached_input_usd_per_million: number | null; cache_write_usd_per_million: number | null; output_usd_per_million: number | null; vat_rate: number;
    } | undefined;
  if (!row) throw new Error("Tentativo di analisi IA non trovato nel registro locale.");
  const price: AiPriceSnapshot = {
    version: row.pricing_version, currency: row.currency, vatRate: row.vat_rate, serviceTier: row.service_tier,
    inputUsdPerMillion: row.input_usd_per_million, cachedInputUsdPerMillion: row.cached_input_usd_per_million,
    cacheWriteUsdPerMillion: row.cache_write_usd_per_million, outputUsdPerMillion: row.output_usd_per_million,
  };
  const cost = calculateAiCostEstimate(usage, price);
  db.prepare(`UPDATE host_ai_analysis_runs SET completed_at=?,status='response_received',lease_expires_at=?,input_tokens=?,output_tokens=?,cached_input_tokens=?,cache_write_tokens=?,reasoning_tokens=?,cost_net_usd=?,vat_usd=?,cost_gross_usd=? WHERE id=?`)
    .run(nowIso(), Date.now() + 180_000, usage.inputTokens, usage.outputTokens, usage.cachedInputTokens, usage.cacheWriteTokens, usage.reasoningTokens, cost.netUsd, cost.vatUsd, cost.grossUsd, runId);
}

export function finishHostAiAnalysisRun(runId: number, status: "succeeded" | "invalid_response" | "request_failed" | "save_failed") {
  db.prepare("UPDATE host_ai_analysis_runs SET status=?,completed_at=COALESCE(completed_at,?),lease_expires_at=NULL WHERE id=?").run(status, nowIso(), runId);
}

export function getAiAnalysisUsageSummary() {
  return db.prepare(`SELECT COUNT(*) AS calls,
    COUNT(DISTINCT host_id) AS hosts,
    COALESCE(SUM(input_tokens),0) AS input_tokens,
    COALESCE(SUM(output_tokens),0) AS output_tokens,
    COALESCE(SUM(cached_input_tokens),0) AS cached_input_tokens,
    COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
    COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens,
    COALESCE(SUM(cost_net_usd),0) AS cost_net_usd,
    COALESCE(SUM(vat_usd),0) AS vat_usd,
    COALESCE(SUM(cost_gross_usd),0) AS cost_gross_usd,
    COALESCE(SUM(CASE WHEN cost_gross_usd IS NULL THEN 1 ELSE 0 END),0) AS calls_without_cost
    FROM host_ai_analysis_runs`).get();
}

export function saveHostAiAnalysis(hostId: string, result: HostAnalysis, metadata: { promptVersion: string; inputHash: string; modelId: string }) {
  const analyzedAt = nowIso();
  db.prepare(`INSERT INTO host_ai_analyses(host_id,software_project_score,ai_llm_score,mentoring_score,technology_score,contribution_score,networking_score,strengths_json,weaknesses_json,learning_potential,rationale,confidence,analyzed_at,prompt_version,input_hash,model_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(host_id) DO UPDATE SET software_project_score=excluded.software_project_score,ai_llm_score=excluded.ai_llm_score,mentoring_score=excluded.mentoring_score,technology_score=excluded.technology_score,contribution_score=excluded.contribution_score,networking_score=excluded.networking_score,strengths_json=excluded.strengths_json,weaknesses_json=excluded.weaknesses_json,learning_potential=excluded.learning_potential,rationale=excluded.rationale,confidence=excluded.confidence,analyzed_at=excluded.analyzed_at,prompt_version=excluded.prompt_version,input_hash=excluded.input_hash,model_id=excluded.model_id`)
    .run(hostId,result.scores.software_project,result.scores.ai_llm,result.scores.mentoring,result.scores.technology,result.scores.contribution,result.scores.networking,json(result.strengths),json(result.weaknesses),result.learning_potential,result.rationale,result.confidence,analyzedAt,metadata.promptVersion,metadata.inputHash,metadata.modelId);
  return { hostId, analyzed_at: analyzedAt, model_id: metadata.modelId };
}

export function getHostAnalyses(search: URLSearchParams) {
  return getRankedAnalyses(search, "host_analyses");
}
export function getAnalysisFilters() {
  return db.prepare("SELECT DISTINCT h.country,h.city FROM hosts h JOIN host_analyses a ON a.host_id=h.id WHERE h.country IS NOT NULL OR h.city IS NOT NULL ORDER BY h.country COLLATE NOCASE,h.city COLLATE NOCASE").all();
}

export function analyzeHostDeterministically(hostId: string, onlyIfMissing = false) {
  if (onlyIfMissing && db.prepare("SELECT 1 FROM host_analyses WHERE host_id=?").get(hostId)) return { hostId, skipped: "already_analyzed" as const };
  const source = db.prepare(`SELECT h.raw_json AS host_raw,d.raw_json AS detail_raw FROM hosts h LEFT JOIN host_details d ON d.host_id=h.id WHERE h.id=?`).get(hostId) as { host_raw: string; detail_raw: string | null } | undefined;
  if (!source) return null;
  const host = JSON.parse(source.host_raw) as Record<string, unknown>;
  const detail = source.detail_raw ? JSON.parse(source.detail_raw) as Record<string, unknown> : {};
  const row = { ...host, ...detail };
  const result = analyzeDeterministically(row);
  const now = nowIso();
  db.prepare(`INSERT INTO host_analyses(host_id,software_project_score,ai_llm_score,mentoring_score,technology_score,contribution_score,networking_score,strengths_json,weaknesses_json,learning_potential,rationale,confidence,analyzed_at,prompt_version,input_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(host_id) DO UPDATE SET software_project_score=excluded.software_project_score,ai_llm_score=excluded.ai_llm_score,mentoring_score=excluded.mentoring_score,technology_score=excluded.technology_score,contribution_score=excluded.contribution_score,networking_score=excluded.networking_score,strengths_json=excluded.strengths_json,weaknesses_json=excluded.weaknesses_json,learning_potential=excluded.learning_potential,rationale=excluded.rationale,confidence=excluded.confidence,analyzed_at=excluded.analyzed_at,prompt_version=excluded.prompt_version,input_hash=excluded.input_hash`)
    .run(hostId, result.scores.software_project, result.scores.ai_llm, result.scores.mentoring, result.scores.technology, result.scores.contribution, result.scores.networking, json(result.strengths), json(result.weaknesses), result.learning_potential, result.rationale, result.confidence, now, result.prompt_version, result.input_hash);
  return { hostId, analyzed_at: now };
}

function getRankedAnalyses(search: URLSearchParams, table: "host_analyses" | "host_ai_analyses") {
  const weights = readAiWeights(search);
  const query = (search.get("q") ?? "").trim();
  const country = (search.get("country") ?? "").trim(); const city = (search.get("city") ?? "").trim();
  const favoritesOnly = search.get("favorites") === "1";
  const limit = Math.min(Math.max(Number.parseInt(search.get("limit") ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(Number.parseInt(search.get("offset") ?? "0", 10) || 0, 0);
  const filters: string[] = []; const params: string[] = [];
  if (query) { filters.push("(h.fullname LIKE ? OR h.company LIKE ? OR h.primary_domain LIKE ? OR h.secondary_domain LIKE ?)"); params.push(...Array(4).fill(`%${query}%`)); }
  if (country) { filters.push("h.country=?"); params.push(country); } if (city) { filters.push("h.city=?"); params.push(city); }
  if (favoritesOnly) filters.push("h.is_favorite=1");
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const modelColumn = table === "host_ai_analyses" ? ",a.model_id" : "";
  const rows = db.prepare(`SELECT a.host_id,h.fullname,h.company,h.primary_domain,h.secondary_domain,h.country,h.city,h.is_favorite,
    a.software_project_score,a.ai_llm_score,a.mentoring_score,a.technology_score,a.contribution_score,a.networking_score,
    a.strengths_json,a.weaknesses_json,a.learning_potential,a.rationale,a.confidence,a.analyzed_at,a.prompt_version,a.input_hash${modelColumn}
    FROM ${table} a JOIN hosts h ON h.id=a.host_id ${where}`).all(...params) as Record<string, any>[];
  const scored: Record<string, any>[] = rows.map((row) => ({
    ...row,
    overall_score: calculateAiOverallScore({ software_project: row.software_project_score, ai_llm: row.ai_llm_score, mentoring: row.mentoring_score, technology: row.technology_score, contribution: row.contribution_score, networking: row.networking_score }, weights),
    strengths: JSON.parse(row.strengths_json), weaknesses: JSON.parse(row.weaknesses_json), strengths_json: undefined, weaknesses_json: undefined,
  })).sort((a: Record<string, any>, b: Record<string, any>) => b.overall_score - a.overall_score || String(a.host_id).localeCompare(String(b.host_id), "en", { numeric: true }));
  return { total: scored.length, weights, analyses: scored.slice(offset, offset + limit) };
}

export function getHostAiAnalyses(search: URLSearchParams) {
  return getRankedAnalyses(search, "host_ai_analyses");
}
export function getAiAnalysisFilters() {
  return db.prepare("SELECT DISTINCT h.country,h.city FROM hosts h JOIN host_ai_analyses a ON a.host_id=h.id WHERE h.country IS NOT NULL OR h.city IS NOT NULL ORDER BY h.country COLLATE NOCASE,h.city COLLATE NOCASE").all();
}
