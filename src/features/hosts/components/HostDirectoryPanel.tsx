import { Fragment } from "react";
import type { AnalysisBatch, Host, HostDetail } from "../types";
import { HostDetailPanel } from "./HostDetailPanel";

type Props = {
  domains: string[];
  domain: string;
  favoritesOnly: boolean;
  search: string;
  debouncedSearch: string;
  page: number;
  total: number;
  totalPages: number;
  first: number;
  last: number;
  hosts: Host[];
  loading: boolean;
  error: string;
  runActive: boolean;
  openStatus: string;
  openError: boolean;
  batchStatus: string;
  batchError: boolean;
  expanded: Set<string>;
  details: Record<string, HostDetail>;
  copyStatus: Record<string, string>;
  analysisBusy: Set<string>;
  analysisMessages: Record<string, string>;
  aiBusyHost: string | null;
  aiMessages: Record<string, string>;
  onDomainChange: (value: string) => void;
  onFavoritesChange: (value: boolean) => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onCollectDetails: () => void;
  onRunBatch: (kind: AnalysisBatch["kind"]) => void;
  onStop: () => void;
  onFavorite: (host: Host) => void;
  onToggleHost: (hostId: string) => void;
  onOpenHost: (host: Host) => void;
  onAnalyzeDeterministic: (hostId: string) => void;
  onAnalyzeAi: (hostId: string) => void;
  onCopy: (hostId: string, rawJson: string) => void;
  onCloseHost: (hostId: string) => void;
  onPrevious: () => void;
  onNext: () => void;
};

export function HostDirectoryPanel(props: Props) {
  const {
    domains,
    domain,
    favoritesOnly,
    search,
    debouncedSearch,
    page,
    total,
    totalPages,
    first,
    last,
    hosts,
    loading,
    error,
    runActive,
    openStatus,
    openError,
    batchStatus,
    batchError,
    expanded,
    details,
    copyStatus,
    analysisBusy,
    analysisMessages,
    aiBusyHost,
    aiMessages,
  } = props;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Profili nel database</h2>
        <div className="tools">
          <select
            aria-label="Filtra per dominio applicativo"
            value={domain}
            disabled={runActive}
            onChange={(event) => props.onDomainChange(event.target.value)}
          >
            <option value="">Tutti i domini</option>
            {domains.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtra per preferiti"
            value={favoritesOnly ? "1" : "0"}
            disabled={runActive}
            onChange={(event) =>
              props.onFavoritesChange(event.target.value === "1")
            }
          >
            <option value="0">Tutti gli host</option>
            <option value="1">Solo preferiti</option>
          </select>
          <input
            type="search"
            placeholder="Cerca nome, città, paese o ID"
            value={search}
            disabled={runActive}
            onChange={(event) => props.onSearchChange(event.target.value)}
          />
          <button type="button" onClick={props.onRefresh}>
            Aggiorna
          </button>
          {!runActive ? (
            <div className="batch-actions">
              <button
                type="button"
                disabled={loading || debouncedSearch !== search.trim()}
                onClick={props.onCollectDetails}
              >
                Salva dettagli di questa pagina
              </button>
              <button
                type="button"
                disabled={loading || debouncedSearch !== search.trim()}
                onClick={() => props.onRunBatch("deterministic")}
              >
                Analisi deterministica di questa pagina
              </button>
              <button
                type="button"
                disabled={loading || debouncedSearch !== search.trim()}
                onClick={() => props.onRunBatch("ai")}
              >
                Analisi IA di questa pagina
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="stop-button"
              onClick={props.onStop}
            >
              Interrompi
            </button>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table className="host-table">
          <thead>
            <tr>
              <th>★</th>
              <th>ID</th>
              <th>Nome</th>
              <th>Paese / città</th>
              <th>Attività principale</th>
              <th>Dettaglio locale</th>
              <th>Analisi deterministica</th>
              <th>Analisi IA</th>
            </tr>
          </thead>
          <tbody>
            {loading && !hosts.length ? (
              <tr>
                <td colSpan={8} className="empty">
                  Caricamento…
                </td>
              </tr>
            ) : error && !hosts.length ? (
              <tr>
                <td colSpan={8} className="empty error-text">
                  {error}
                </td>
              </tr>
            ) : !hosts.length ? (
              <tr>
                <td colSpan={8} className="empty">
                  {search || domain || favoritesOnly
                    ? "Nessun profilo corrisponde ai filtri selezionati."
                    : "Ancora nessun profilo. Naviga nell’elenco host in Firefox."}
                </td>
              </tr>
            ) : (
              hosts.map((host) => (
                <Fragment key={host.id}>
                  <tr>
                    <td>
                      <button
                        className={`favorite-star ${host.is_favorite ? "selected" : ""}`}
                        type="button"
                        aria-label={
                          host.is_favorite
                            ? "Rimuovi dai preferiti"
                            : "Aggiungi ai preferiti"
                        }
                        aria-pressed={host.is_favorite === 1}
                        onClick={() => props.onFavorite(host)}
                      >
                        {host.is_favorite ? "★" : "☆"}
                      </button>
                    </td>
                    <td>
                      <button
                        className="id-button"
                        type="button"
                        onClick={() => props.onToggleHost(host.id)}
                      >
                        {host.id}
                      </button>
                    </td>
                    <td>{host.fullname || "—"}</td>
                    <td>
                      {[host.country, host.city].filter(Boolean).join(" · ") ||
                        "—"}
                    </td>
                    <td>{host.primary_domain || "—"}</td>
                    <td>
                      <button
                        className={`status-action ${host.detail_captured_at ? "status-ok" : "status-missing"}`}
                        type="button"
                        disabled={runActive}
                        onClick={() => props.onOpenHost(host)}
                      >
                        {host.detail_captured_at
                          ? "Salvato · aggiorna"
                          : "Apri profilo"}
                      </button>
                    </td>
                    <td>
                      <button
                        className={`status-action ${host.deterministic_analysis_exists ? "status-ok" : "status-missing"}`}
                        type="button"
                        disabled={analysisBusy.has(host.id)}
                        onClick={() => props.onAnalyzeDeterministic(host.id)}
                      >
                        {analysisBusy.has(host.id)
                          ? "Analisi…"
                          : host.deterministic_analysis_exists
                            ? "Rigenera"
                            : "Analizza"}
                      </button>
                      {analysisMessages[host.id] && (
                        <span className="row-action-status" role="status">
                          {analysisMessages[host.id]}
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className={`status-action ${host.ai_analysis_exists ? "status-ok" : "status-missing"}`}
                        type="button"
                        disabled={Boolean(aiBusyHost)}
                        onClick={() => props.onAnalyzeAi(host.id)}
                      >
                        {aiBusyHost === host.id
                          ? "Analisi IA…"
                          : host.ai_analysis_exists
                            ? "Rigenera IA"
                            : "Analizza IA"}
                      </button>
                      {aiMessages[host.id] && (
                        <span className="row-action-status" role="status">
                          {aiMessages[host.id]}
                        </span>
                      )}
                    </td>
                  </tr>
                  {expanded.has(host.id) && (
                    <tr className="detail-row">
                      <td colSpan={8}>
                        <HostDetailPanel
                          hostId={host.id}
                          data={details[host.id]}
                          onCopy={props.onCopy}
                          copyStatus={copyStatus[host.id] || ""}
                          onClose={() => props.onCloseHost(host.id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
      {openStatus && (
        <div
          className={`inline-status ${openError ? "error-text" : ""}`}
          role="status"
        >
          {openStatus}
        </div>
      )}
      {batchStatus && (
        <div
          className={`batch-status ${batchError ? "error-text" : ""}`}
          role="status"
          aria-live="polite"
        >
          {batchStatus}
        </div>
      )}
      <div className="panel-foot">
        <span>
          {error && hosts.length ? `${error} · ` : ""}
          {total
            ? `Visualizzati ${first}–${last} di ${total} profili`
            : "0 profili corrispondenti"}
        </span>
        <div className="pagination">
          <button
            type="button"
            disabled={page === 0 || runActive || loading}
            onClick={props.onPrevious}
          >
            Precedente
          </button>
          <span>
            {totalPages
              ? `Pagina ${page + 1} di ${totalPages}`
              : "Pagina 0 di 0"}
          </span>
          <button
            type="button"
            disabled={
              !totalPages || page + 1 >= totalPages || runActive || loading
            }
            onClick={props.onNext}
          >
            Successiva
          </button>
        </div>
      </div>
    </section>
  );
}
