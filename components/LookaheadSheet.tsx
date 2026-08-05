import type { LookaheadView } from "@/lib/lookahead/lookaheadView";

// No hooks, no "use client", nothing async: the PDF endpoint renders this exact
// tree through renderToStaticMarkup, so screen and paper cannot drift.
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function LookaheadSheet({ view, projectName }: { view: LookaheadView; projectName: string }) {
  return (
    <div className="sheet">
      <header className="hd">
        <div>
          <div className="hd-brand">Skiles Group · {projectName}</div>
          <div className="hd-title">
            {view.title} · {view.windowLabel}
          </div>
        </div>
        <div className="hd-meta">
          Status date {view.statusDateLabel}
          <br />
          Generated {view.generatedLabel}
        </div>
      </header>

      <div className="stats">
        <div className="stat">
          <div className={`stat-n${view.stats.driftDays > 0 ? " bad" : ""}`}>
            {view.stats.driftDays > 0 ? `+${view.stats.driftDays}d` : "on plan"}
          </div>
          <div className="stat-l">projected drift</div>
        </div>
        <div className="stat">
          <div className={`stat-n${view.stats.atRiskCount > 0 ? " warn" : ""}`}>{view.stats.atRiskCount}</div>
          <div className="stat-l">at risk</div>
        </div>
        <div className="stat">
          <div className="stat-n">{view.stats.percentComplete}%</div>
          <div className="stat-l">complete</div>
        </div>
        <div className="stat">
          <div className="stat-n">{view.stats.startingCount}</div>
          <div className="stat-l">starting this window</div>
        </div>
      </div>

      <section className="box">
        <h2>Needs attention</h2>
        <ul>
          {view.attention.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      {view.milestones.length > 0 && (
        <section className="box">
          <h2>Milestones</h2>
          <div className="ms">
            {view.milestones.map((m) => (
              <span key={`${m.name}|${m.expected ?? ""}`} className={`ms-chip${m.beyondWindow ? " beyond" : ""}`}>
                {m.name} ·<span className="mark planned" />
                {m.planned ? fmtDay(m.planned) : "—"} –<span className="mark expected" />
                {m.expected ? fmtDay(m.expected) : "—"}
                {m.driftDays > 0 && <span className="ms-drift"> +{m.driftDays}d</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="pagebreak" />

      {view.bands.length === 0 ? (
        <p className="empty">No activities fall in this window.</p>
      ) : (
        <>
          <div className="axis">
            <div className="axis-name">Activity</div>
            <div className="axis-time">
              {view.ticks.map((t) => (
                <span key={`${t.label}|${t.leftPct}`} style={{ left: `${t.leftPct}%` }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
          {view.bands.map((band) => (
            <section key={band.trade} className="band">
              <div
                className="band-hd"
                data-band={band.trade}
                style={{ background: band.color.bg, color: band.color.text }}
              >
                <span>{band.trade}</span>
                <span className="band-partners">{band.partners.join(" · ")}</span>
              </div>
              {band.rows.map((r) => (
                <div key={r.id} className="row">
                  <div className="row-name">
                    <span className={r.isCritical ? "crit" : undefined}>{r.name}</span>
                    {r.secondaryName && <span className="alt">{r.secondaryName}</span>}
                    {r.atRisk && <span className="risk">AT RISK</span>}
                  </div>
                  <div className="row-time">
                    {view.weekends.map((w, i) => (
                      <div key={i} className="wknd" style={{ left: `${w.leftPct}%`, width: `${w.widthPct}%` }} />
                    ))}
                    {view.todayPct !== null && <div className="today" style={{ left: `${view.todayPct}%` }} />}
                    {r.bar && (
                      <div
                        data-bar="expected"
                        className="bar"
                        style={{ left: `${r.bar.leftPct}%`, width: `${r.bar.widthPct}%` }}
                      >
                        <div className="bar-fill" style={{ width: `${r.percentComplete}%` }} />
                      </div>
                    )}
                    {r.ghostPct !== null && <div data-ghost="planned" className="ghost" style={{ left: `${r.ghostPct}%` }} />}
                    {r.plannedPointPct !== null && (
                      <span data-diamond="planned" className="dia planned" style={{ left: `${r.plannedPointPct}%` }} />
                    )}
                    {r.expectedPointPct !== null && (
                      <span data-diamond="expected" className="dia expected" style={{ left: `${r.expectedPointPct}%` }} />
                    )}
                    {r.bar && r.driftDays > 0 && (
                      <span className="drift" style={{ left: `${Math.min(r.bar.leftPct + r.bar.widthPct, 96)}%` }}>
                        +{r.driftDays}d
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
      <p className="foot">Exported from Schedule Manager</p>
    </div>
  );
}
