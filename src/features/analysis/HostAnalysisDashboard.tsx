"use client";

import Link from "next/link";
import {
  AI_WEIGHT_KEYS,
  isValidAiWeights,
} from "../../shared/host-analysis-weights";
import { AnalysisCard, criteria } from "./components/AnalysisCard";
import { useAnalysisDashboard } from "./hooks/useAnalysisDashboard";

const PAGE_SIZE = 50;
const formatUsd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 6,
    maximumFractionDigits: 8,
  }).format(value);

export default function HostAnalysisDashboard({
  mode = "deterministic",
}: {
  mode?: "deterministic" | "ai";
}) {
  const isAi = mode === "ai";
  const {
    offset,
    setOffset,
    queryInput,
    setQueryInput,
    country,
    setCountry,
    city,
    setCity,
    favoritesOnly,
    setFavoritesOnly,
    locations,
    analyses,
    total,
    status,
    error,
    aiWeights,
    usageSummary,
    expandedHost,
    hostDetails,
    detailLoading,
    detailError,
    favoriteBusy,
    changeWeight,
    resetWeights,
    toggleFavorite,
    toggleDetails,
    setRefreshVersion,
  } = useAnalysisDashboard(isAi);

  const countries = [
    ...new Set(
      locations
        .map((item) => item.country)
        .filter((item): item is string => Boolean(item)),
    ),
  ].sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
  const cities = [
    ...new Set(
      locations
        .filter((item) => !country || item.country === country)
        .map((item) => item.city)
        .filter((item): item is string => Boolean(item)),
    ),
  ].sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <h1>{isAi ? "Analisi host IA" : "Analisi host deterministica"}</h1>
          <p>
            <Link href="/">← Torna alla raccolta</Link> ·{" "}
            <Link href={isAi ? "/analisi-host" : "/analisi-host-ia"}>
              {isAi ? "Analisi deterministica" : "Analisi IA"}
            </Link>
          </p>
        </div>
      </header>
      <main className="analysis-main">
        <div className="notice">
          <strong>
            {isAi
              ? "Analisi IA dei profili host."
              : "Valutazione preliminare, non verificata online."}
          </strong>{" "}
          {isAi
            ? "Il modello valuta i singoli criteri; il punteggio totale viene ricalcolato localmente con i pesi selezionati. I dati geografici sono mostrati e filtrabili, ma non entrano nell'analisi."
            : "Basata esclusivamente sui dati locali disponibili; città e paese non entrano nell’analisi. Il primo screening usa segnali testuali e va verificato leggendo le schede e parlando con l’host."}
        </div>
        {isAi && (
          <section
            className="usage-summary"
            aria-label="Riepilogo costi stimati analisi IA"
          >
            <div className="usage-summary-heading">
              <h2>Utilizzo API · stima</h2>
              <span>USD · IVA 22%</span>
            </div>
            <div className="usage-summary-grid">
              <div>
                <span>Chiamate · host</span>
                <strong>
                  {usageSummary
                    ? `${usageSummary.calls.toLocaleString("it-IT")} · ${usageSummary.hosts.toLocaleString("it-IT")}`
                    : "—"}
                </strong>
              </div>
              <div>
                <span>Token input · output</span>
                <strong>
                  {usageSummary
                    ? `${usageSummary.input_tokens.toLocaleString("it-IT")} · ${usageSummary.output_tokens.toLocaleString("it-IT")}`
                    : "—"}
                </strong>
              </div>
              <div>
                <span>Stima netta</span>
                <strong>
                  {usageSummary ? formatUsd(usageSummary.cost_net_usd) : "—"}
                </strong>
              </div>
              <div>
                <span>IVA 22%</span>
                <strong>
                  {usageSummary ? formatUsd(usageSummary.vat_usd) : "—"}
                </strong>
              </div>
              <div className="usage-summary-total">
                <span>Totale stimato IVA inclusa</span>
                <strong>
                  {usageSummary ? formatUsd(usageSummary.cost_gross_usd) : "—"}
                </strong>
              </div>
            </div>
            {usageSummary?.calls_without_cost ? (
              <p className="usage-summary-note">
                Costo non determinabile per{" "}
                {usageSummary.calls_without_cost.toLocaleString("it-IT")}{" "}
                chiamate; gli importi mostrati sommano solo quelle con usage e
                tariffa disponibili.
              </p>
            ) : (
              <p className="usage-summary-note">
                Output conteggiato secondo i token fatturabili, inclusi quelli
                di reasoning quando riportati dal provider.
              </p>
            )}
          </section>
        )}
        <section className="panel">
          <div className="weights-panel">
            <div className="weights-heading">
              <div>
                <h2>Pesi dei criteri</h2>
                <p>
                  Condivisi tra analisi deterministica e IA; la somma deve
                  essere 100%.
                </p>
              </div>
              <button type="button" onClick={resetWeights}>
                Ripristina predefiniti
              </button>
            </div>
            <div className="weight-grid">
              {AI_WEIGHT_KEYS.map((key) => (
                <label key={key}>
                  <span>
                    {criteria.find(
                      ([, scoreKey]) => scoreKey === `${key}_score`,
                    )?.[0] ?? key}
                  </span>
                  <div>
                    <input
                      aria-label={`Peso ${key}`}
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={aiWeights[key]}
                      onChange={(event) =>
                        changeWeight(key, Number(event.target.value))
                      }
                    />
                    <span>%</span>
                  </div>
                </label>
              ))}
            </div>
            <div
              className={`weight-total ${isValidAiWeights(aiWeights) ? "valid" : "invalid"}`}
              role="status"
            >
              Somma:{" "}
              {AI_WEIGHT_KEYS.reduce((sum, key) => sum + aiWeights[key], 0)}%
              {isValidAiWeights(aiWeights)
                ? " · classifica aggiornata su tutte le analisi"
                : " · completa la somma per aggiornare la classifica"}
            </div>
          </div>
          <div className="toolbar">
            <select
              aria-label="Filtra per paese"
              value={country}
              onChange={(event) => {
                setCountry(event.target.value);
                setCity("");
                setOffset(0);
              }}
            >
              <option value="">Tutti i paesi</option>
              {countries.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtra per città"
              value={city}
              onChange={(event) => {
                setCity(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">Tutte le città</option>
              {cities.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtra per preferiti"
              value={favoritesOnly ? "1" : "0"}
              onChange={(event) => {
                setFavoritesOnly(event.target.value === "1");
                setOffset(0);
              }}
            >
              <option value="0">Tutti gli host</option>
              <option value="1">Solo preferiti</option>
            </select>
            <input
              type="search"
              aria-label="Cerca"
              placeholder="Cerca nome, azienda o dominio"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setRefreshVersion((value) => value + 1)}
            >
              Aggiorna
            </button>
          </div>
          <div
            className={`analysis-status ${error ? "error-text" : ""}`}
            role="status"
            aria-live="polite"
          >
            {status}
          </div>
          <div className="analysis-list">
            {analyses.length ? (
              analyses.map((item) => (
                <AnalysisCard
                  key={item.host_id}
                  item={item}
                  precision={2}
                  isAi={isAi}
                  expanded={expandedHost === item.host_id}
                  details={hostDetails[item.host_id]}
                  detailLoading={detailLoading === item.host_id}
                  detailError={expandedHost === item.host_id ? detailError : ""}
                  favoriteBusy={favoriteBusy.has(item.host_id)}
                  onToggleFavorite={() => void toggleFavorite(item)}
                  onToggleDetails={() => void toggleDetails(item.host_id)}
                />
              ))
            ) : (
              <div className="analysis-card">
                {error
                  ? "Impossibile caricare le analisi."
                  : isAi
                    ? "Non sono ancora presenti analisi IA. Avvia l'analisi dal pulsante IA nella tabella degli host."
                    : "Non ci sono ancora analisi deterministiche salvate. Avvia l'analisi dall'elenco host."}
              </div>
            )}
          </div>
          <div className="paging">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() =>
                setOffset((value) => Math.max(0, value - PAGE_SIZE))
              }
            >
              Precedente
            </button>
            <span>
              Pagina {currentPage} di {pages}
            </span>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset((value) => value + PAGE_SIZE)}
            >
              Successiva
            </button>
          </div>
        </section>
      </main>
    </>
  );
}
