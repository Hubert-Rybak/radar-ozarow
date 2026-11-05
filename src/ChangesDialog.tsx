import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatDay, loadChanges, plural, type ChangeLog } from "./changes";
import { kindColors, kindLabels } from "./model";
import { investmentTypes } from "./investments";
import type { PermitState } from "./PermitPanel";
import type { InvestmentState } from "./InvestmentPanel";
import type { Layer } from "./RadarMap";

const PAGE = 14;

export default function ChangesDialog({ onClose, onPick, permits, investments }: {
  onClose: () => void;
  /** Opens the record's card; the dialog is closed by the caller. */
  onPick: (layer: Layer, id: string) => void;
  permits: PermitState;
  investments: InvestmentState;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [log, setLog] = useState<ChangeLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    loadChanges(fetch, controller.signal).then(setLog, reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => controller.abort();
  }, [attempt]);

  const permitIds = new Set(permits.all.map(r => r.id));
  const investmentIds = new Set(investments.all.map(r => r.id));
  const sourceName = (id: string) => investments.data?.sources.find(s => s.id === id)?.name || id;
  const days = log?.days.slice(0, shown) || [];

  return (
    <div className="about-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="about" role="dialog" aria-modal="true" aria-labelledby="changes-title">
        <div className="about-bar">
          <h2 id="changes-title" ref={heading} tabIndex={-1}>Lista zmian</h2>
          <button type="button" className="round-button" onClick={onClose} aria-label="Zamknij listę zmian">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="about-body">
          <p className="muted">
            Nowe rekordy według dnia, w którym pojawiły się w codziennym imporcie danych — nie jest to data wniosku ani decyzji.
            Dni bez nowych rekordów pomijamy.{log ? ` Historia od ${formatDay(log.since, false)}.` : ""}
          </p>
          {error ? (
            <div className="empty-state" role="alert">
              <strong>Nie udało się wczytać listy zmian.</strong>
              <p>{error}</p>
              <button type="button" className="primary-button" onClick={() => setAttempt(n => n + 1)}>Ponów odczyt</button>
            </div>
          ) : !log ? (
            <div className="empty-state" role="status"><span className="loading-ring" aria-hidden="true" />Ładowanie listy zmian…</div>
          ) : !log.days.length ? (
            <div className="empty-state"><strong>Brak nowych rekordów</strong><p>Od {formatDay(log.since, false)} nie pojawiły się nowe wpisy.</p></div>
          ) : (
            <ol className="change-days">
              {days.map(day => (
                <li key={day.date} className="change-day">
                  <section aria-labelledby={`day-${day.date}`}>
                    <h3 id={`day-${day.date}`}>{formatDay(day.date)}</h3>
                    <p className="muted">{[
                      day.permits.length ? plural(day.permits.length, "nowa budowa", "nowe budowy", "nowych budów") : "",
                      day.investments.length ? plural(day.investments.length, "nowa inwestycja", "nowe inwestycje", "nowych inwestycji") : "",
                    ].filter(Boolean).join(" · ")}</p>
                    {day.permits.length > 0 && (
                      <>
                        <h4>Budowy</h4>
                        <ul className="change-list">
                          {day.permits.map(e => (
                            <li key={e.id}>
                              <ChangeRow state={permits.loading ? "loading" : permitIds.has(e.id) ? "present" : "gone"} onClick={() => onPick("permits", e.id)}
                                title={e.title} meta={[kindLabels[e.kind] || e.kind, e.locality].filter(Boolean).join(" · ")}
                                mark={<span className="legend-mark square" style={{ background: kindColors[e.kind] }} aria-hidden="true" />} />
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {day.investments.length > 0 && (
                      <>
                        <h4>Inwestycje</h4>
                        <ul className="change-list">
                          {day.investments.map(e => (
                            <li key={e.id}>
                              <ChangeRow state={investments.loading ? "loading" : investmentIds.has(e.id) ? "present" : "gone"} onClick={() => onPick("investments", e.id)}
                                title={e.title} meta={[investmentTypes[e.recordType as keyof typeof investmentTypes] || e.recordType, sourceName(e.sourceId)].join(" · ")}
                                mark={<span className="legend-mark circle" style={{ background: "var(--accent)" }} aria-hidden="true" />} />
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </section>
                </li>
              ))}
            </ol>
          )}
          {log && log.days.length > shown && (
            <button type="button" className="more-button" onClick={() => setShown(n => n + PAGE)}>
              Pokaż starsze dni ({log.days.length - shown})
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ChangeRow({ state, onClick, title, meta, mark }: {
  state: "present" | "gone" | "loading"; onClick: () => void; title: string; meta: string; mark: ReactNode;
}) {
  const body = (
    <>
      {mark}
      <span className="change-main">
        <span className="change-title">{title}</span>
        <span className="change-meta">{meta}{state === "gone" ? " · nie ma go już w bieżącym zbiorze" : ""}</span>
      </span>
    </>
  );
  return state === "gone"
    ? <div className="change-row gone">{body}</div>
    : <button type="button" className="change-row" onClick={onClick} disabled={state === "loading"}>{body}</button>;
}
