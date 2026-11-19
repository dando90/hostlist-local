import type { Capture } from "../types";
import { formatHostTime } from "../format";

export function CaptureHistory({ captures }: { captures: Capture[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Risposte catturate</h2>
        <span className="subtle">Le più recenti per prime</span>
      </div>
      {!captures.length ? (
        <div className="empty">In attesa della prima risposta JSON…</div>
      ) : (
        captures.map((capture) => (
          <details className="capture-item" key={capture.id}>
            <summary>
              <span className="capture-time">
                {formatHostTime(capture.captured_at)}
              </span>
              <span className="badge">
                {capture.record_count} profili · pagina{" "}
                {capture.page_start ?? "?"}
              </span>
              <span className="subtle">
                record totali: {capture.total_rows ?? "n/d"}
              </span>
            </summary>
            <div className="capture-url">{capture.source_url}</div>
          </details>
        ))
      )}
    </section>
  );
}
