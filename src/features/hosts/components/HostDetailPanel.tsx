import { Fragment } from "react";
import type { HostDetail } from "../types";
import {
  displayHostValue,
  formatHostFieldLabel,
  formatHostTime,
} from "../format";

export function HostDetailPanel({
  hostId,
  data,
  onCopy,
  copyStatus,
  onClose,
}: {
  hostId: string;
  data?: HostDetail;
  onCopy: (id: string, raw: string) => void;
  copyStatus: string;
  onClose: () => void;
}) {
  if (!data)
    return (
      <div className="profile">
        <strong>Dettaglio host {hostId}</strong>
        <p className="muted">Caricamento del profilo…</p>
      </div>
    );
  const saved = data.savedDetail;
  return (
    <div className="profile">
      <div className="detail-top">
        <strong>Dettaglio host {hostId}</strong>
        <button type="button" onClick={onClose}>
          Chiudi dettaglio
        </button>
      </div>
      <dl className="summary-fields">
        <div>
          <dt>Lingue</dt>
          <dd>{data.languages || "—"}</dd>
        </div>
        <div>
          <dt>Prima acquisizione</dt>
          <dd>{formatHostTime(data.first_seen)}</dd>
        </div>
        <div>
          <dt>Ultima acquisizione</dt>
          <dd>{formatHostTime(data.last_seen)}</dd>
        </div>
        <div>
          <dt>Paesi secondari</dt>
          <dd>{data.secondary_country || "—"}</dd>
        </div>
        <div>
          <dt>Settori secondari</dt>
          <dd>{data.secondary_domain || "—"}</dd>
        </div>
      </dl>
      {!saved ? (
        <p className="muted">
          Scheda dettagliata non ancora acquisita. Apri il profilo per salvarla.
        </p>
      ) : (
        <div className="saved-detail">
          <div className="detail-top">
            <p>
              <strong>Scheda dettagliata acquisita:</strong>{" "}
              {formatHostTime(saved.capturedAt)}
            </p>
            <button
              type="button"
              onClick={() => void onCopy(hostId, saved.rawJson)}
            >
              Copia JSON raw
            </button>
          </div>
          {Object.entries(saved.fields).filter(
            ([, value]) =>
              value !== null && value !== undefined && value !== "",
          ).length ? (
            <div className="detail-fields-wrap">
              <table className="detail-fields">
                <tbody>
                  {Object.entries(saved.fields)
                    .filter(
                      ([, value]) =>
                        value !== null && value !== undefined && value !== "",
                    )
                    .map(([key, value]) => (
                      <tr key={key}>
                        <th scope="row">{formatHostFieldLabel(key)}</th>
                        <td>
                          {displayHostValue(value)
                            .split(/<br\s*\/?>/i)
                            .map((part, index, all) => (
                              <Fragment key={`${key}-${index}`}>
                                {part}
                                {index < all.length - 1 && <br />}
                              </Fragment>
                            ))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Nessun campo valorizzato.</p>
          )}
          <span className="copy-status" role="status" aria-live="polite">
            {copyStatus}
          </span>
        </div>
      )}
    </div>
  );
}
