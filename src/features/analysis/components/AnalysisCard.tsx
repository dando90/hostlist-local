import type { Analysis, HostAnalysisDetails } from "../types";

export const criteria: Array<[string, keyof Analysis]> = [
  ["Software/progetti", "software_project_score"],
  ["AI/LLM", "ai_llm_score"],
  ["Mentoring", "mentoring_score"],
  ["Tecnologie", "technology_score"],
  ["Contributo", "contribution_score"],
  ["Networking", "networking_score"],
];
export const formatDetailValue = (value: unknown) =>
  (Array.isArray(value)
    ? value
        .map((entry) =>
          typeof entry === "object" && entry !== null
            ? JSON.stringify(entry)
            : String(entry),
        )
        .join(", ")
    : typeof value === "object" && value !== null
      ? JSON.stringify(value, null, 2)
      : String(value ?? "")
  ).replace(/<br\s*\/?\s*>/gi, "\n");
export const formatFieldLabel = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("it-IT"));
const escapeValue = (value: unknown) => String(value ?? "");

export function AnalysisCard({
  item,
  precision,
  isAi,
  expanded,
  details,
  detailLoading,
  detailError,
  favoriteBusy,
  onToggleFavorite,
  onToggleDetails,
}: {
  item: Analysis;
  precision: number;
  isAi: boolean;
  expanded: boolean;
  details?: HostAnalysisDetails;
  detailLoading: boolean;
  detailError: string;
  favoriteBusy: boolean;
  onToggleFavorite: () => void;
  onToggleDetails: () => void;
}) {
  return (
    <article className="analysis-card">
      <div className="analysis-head">
        <button
          className={`favorite-star ${item.is_favorite ? "selected" : ""}`}
          type="button"
          aria-label={
            item.is_favorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"
          }
          aria-pressed={item.is_favorite === 1}
          disabled={favoriteBusy}
          onClick={onToggleFavorite}
        >
          {item.is_favorite ? "★" : "☆"}
        </button>
        <div className="score">
          {Number(item.overall_score).toFixed(precision)}
        </div>
        <div className="analysis-name">
          <h2>{item.fullname || item.company || "Host"}</h2>
          <div className="analysis-id">
            ID {item.host_id} · {item.company || "Azienda non indicata"} ·{" "}
            {[item.city, item.country].filter(Boolean).join(", ") ||
              "Località non indicata"}
          </div>
          <div className="domains">
            {[item.primary_domain, item.secondary_domain].filter(Boolean).join(" · ") ||
              "Domini non indicati"}
          </div>
        </div>
        <div className="confidence">
          {item.model_id ? `${item.model_id} · ` : ""}Affidabilità{" "}
          {item.confidence}
        </div>
      </div>
      <div className="criteria">
        {criteria.map(([label, key]) => (
          <span key={key}>
            {label}: {Number(item[key]).toFixed(1)}
          </span>
        ))}
      </div>
      <div className="analysis-sections">
        <section>
          <h3>Punti di forza</h3>
          <ul>
            {item.strengths.map((value, index) => (
              <li key={`${index}-${value}`}>{escapeValue(value)}</li>
            ))}
          </ul>
          <h3>Potenziale formativo</h3>
          <p>{item.learning_potential}</p>
        </section>
        <section>
          <h3>Punti di debolezza / da verificare</h3>
          <ul>
            {item.weaknesses.map((value, index) => (
              <li key={`${index}-${value}`}>{escapeValue(value)}</li>
            ))}
          </ul>
          <h3>Motivazione</h3>
          <p>{item.rationale}</p>
        </section>
      </div>
      {isAi && (
        <div className="analysis-detail-action">
          <button type="button" onClick={onToggleDetails}>
            {expanded ? "Chiudi scheda host" : "Mostra scheda host"}
          </button>
        </div>
      )}
      {isAi && expanded && (
        <HostAnalysisDetailPanel
          details={details}
          loading={detailLoading}
          error={detailError}
          onClose={onToggleDetails}
        />
      )}
    </article>
  );
}

function HostAnalysisDetailPanel({
  details,
  loading,
  error,
  onClose,
}: {
  details?: HostAnalysisDetails;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  return (
    <section className="analysis-source-panel">
      <div className="detail-top">
        <div>
          <h3>Dati del profilo usati per la valutazione</h3>
          <p>
            Fonte locale · acquisizione scheda:{" "}
            {details?.capturedAt
              ? new Date(details.capturedAt).toLocaleString("it-IT")
              : "non acquisita"}
          </p>
        </div>
        <button type="button" onClick={onClose}>
          Chiudi scheda
        </button>
      </div>
      {loading && <p className="muted">Caricamento dei dati originali…</p>}
      {error && <p className="error-text">{error}</p>}
      {details && (
        <>
          <div className="source-metadata">
            <span>
              Prima acquisizione:{" "}
              {new Date(details.firstSeen).toLocaleString("it-IT")}
            </span>
            <span>
              Ultima acquisizione:{" "}
              {new Date(details.lastSeen).toLocaleString("it-IT")}
            </span>
            {details.website && (
              <a
                href={details.website}
                target="_blank"
                rel="noopener noreferrer"
              >
                Apri sito web ↗
              </a>
            )}
          </div>
          <h4>Campi inviati al modello</h4>
          <FieldTable values={details.modelPayload} />
          <h4>Altri dati professionali e disponibilità</h4>
          <FieldTable values={details.professional} />
        </>
      )}
    </section>
  );
}

function FieldTable({ values }: { values: Record<string, unknown> }) {
  const entries = Object.entries(values).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  return entries.length ? (
    <div className="detail-fields-wrap">
      <table className="detail-fields">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <th scope="row">{formatFieldLabel(key)}</th>
              <td className="source-value">{formatDetailValue(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="muted">Nessun dato disponibile.</p>
  );
}
