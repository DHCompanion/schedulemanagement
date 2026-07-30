"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendJson } from "@/lib/http";
import type { TradeDriftRow } from "@/lib/trades/tradeDrift";

export interface OsDisciplineOption { id: number; name: string; division: string; }
export interface PartnerOption { osPartnerId: number; name: string; }
export interface DisciplineRow { canonicalScope: string; suggestions: OsDisciplineOption[]; }
export interface AssignmentRow {
  osDisciplineId: number;
  disciplineName: string;
  currentPartnerId: number | null;
  currentPartnerName: string;
  onRoster: boolean;
  partners: PartnerOption[];
}

type Tab = "assignment" | "unmapped" | "dismissed" | "drift";

// Disciplines and companies are closed sets owned by Skiles Connect, so both are
// <select>s. They were free-text inputs back when the vocabulary was whatever
// anyone had typed before.
export function TradesPanel({ projectId, disciplineRows, assignmentRows, disciplines, dismissedScopes, driftRows }: {
  projectId: string;
  disciplineRows: DisciplineRow[];
  assignmentRows: AssignmentRow[];
  disciplines: OsDisciplineOption[];
  dismissedScopes: string[];
  driftRows: TradeDriftRow[];
}) {
  const router = useRouter();
  // Mapping scopes to disciplines is what fills the assignment tab, so start
  // there while anything is still unmapped — landing on an empty tab reads as
  // broken.
  const [tab, setTab] = useState<Tab>(disciplineRows.length > 0 ? "unmapped" : "assignment");
  const [disc, setDisc] = useState<Record<string, number>>({});
  // Connect usually puts exactly one partner on a project per discipline, so an
  // unassigned discipline with a single covering partner is already decided —
  // pre-select it rather than present a one-item dropdown. Still only persisted
  // by Save, so the choice is visible and overridable before it is written.
  const [comp, setComp] = useState<Record<number, number>>(() =>
    Object.fromEntries(
      assignmentRows
        .map((row) => [row.osDisciplineId, row.currentPartnerId ?? (row.partners.length === 1 ? row.partners[0].osPartnerId : null)])
        .filter((entry): entry is [number, number] => entry[1] !== null)
    )
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDiscipline, setBulkDiscipline] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disciplineName = (id: number) => disciplines.find((d) => d.id === id)?.name ?? "";

  function toggleSelected(scope: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  function applyBulkDiscipline() {
    const id = Number(bulkDiscipline);
    if (!Number.isInteger(id) || id <= 0 || selected.size === 0) return;
    setDisc((prev) => {
      const next = { ...prev };
      for (const scope of selected) next[scope] = id;
      return next;
    });
    setSelected(new Set());
    setBulkDiscipline("");
  }

  async function save() {
    setBusy(true);
    setError(null);
    const disciplinePayload = Object.entries(disc)
      .filter(([, id]) => Number.isInteger(id))
      .map(([canonicalScope, id]) => ({ canonicalScope, osDisciplineId: id, disciplineName: disciplineName(id) }));
    const assignments = Object.entries(comp)
      .filter(([, partnerId]) => Number.isInteger(partnerId))
      .map(([osDisciplineId, osPartnerId]) => ({ osDisciplineId: Number(osDisciplineId), osPartnerId }));
    const err = await sendJson("/api/trades", { projectId, disciplines: disciplinePayload, assignments });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    router.refresh();
  }

  async function dismiss(scope: string) {
    setRowBusy(scope);
    setError(null);
    const err = await sendJson("/api/trades/dismiss", { projectId, canonicalScope: scope });
    setRowBusy(null);
    if (err) {
      setError(err);
      return;
    }
    router.refresh();
  }

  async function restore(scope: string) {
    setRowBusy(scope);
    setError(null);
    const err = await sendJson("/api/trades/restore", { projectId, canonicalScope: scope });
    setRowBusy(null);
    if (err) {
      setError(err);
      return;
    }
    router.refresh();
  }

  async function resolveDrift(row: TradeDriftRow, action: "accept" | "keep") {
    const key = `${row.osDisciplineId}::${row.fileValue}`;
    setRowBusy(key);
    setError(null);
    const err = await sendJson("/api/trades/drift", { projectId, osDisciplineId: row.osDisciplineId, fileValue: row.fileValue, action });
    setRowBusy(null);
    if (err) {
      setError(err);
      return;
    }
    router.refresh();
  }

  if (disciplines.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
        No trade partners for this project yet. Disciplines and companies come from the project&apos;s trade
        partner roster in Skiles Connect, which loads when the tool is launched from there.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-500">
        Disciplines and companies come from this project&apos;s roster in Skiles Connect, refreshed at each launch.
      </p>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-1 border-b border-slate-200">
        {([
          ["unmapped", `Unmapped Activities (${disciplineRows.length})`],
          ["assignment", "Trade Assignment"],
          ["drift", `Changed in MS Project (${driftRows.length})`],
          ["dismissed", `Dismissed (${dismissedScopes.length})`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-medium ${tab === key ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "assignment" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Discipline → trade partner (this project)</h2>
          {assignmentRows.length === 0 ? (
            <p className="text-sm text-slate-500">Map scopes to disciplines on the Unmapped Activities tab, then assign companies here.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
              {assignmentRows.map((r) => (
                <li key={r.osDisciplineId} className="px-3 py-3">
                  <div className="font-medium">{r.disciplineName}</div>
                  {r.currentPartnerId !== null && !r.onRoster && (
                    <p className="mt-1 text-xs text-amber-700">
                      {r.currentPartnerName} is no longer on this project&apos;s roster in Skiles Connect.
                    </p>
                  )}
                  {r.currentPartnerId === null && r.partners.length === 1 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Only partner on this project covering this discipline — selected for you, Save to confirm.
                    </p>
                  )}
                  {r.partners.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">No partner on this project covers this discipline.</p>
                  ) : (
                    <select
                      value={comp[r.osDisciplineId] ?? ""}
                      onChange={(e) => setComp((v) => ({ ...v, [r.osDisciplineId]: Number(e.target.value) }))}
                      className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="">Select a trade partner…</option>
                      {r.partners.map((p) => (
                        <option key={p.osPartnerId} value={p.osPartnerId}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button disabled={busy} onClick={save} className="self-start rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </section>
      )}

      {tab === "unmapped" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Scope → discipline (global)</h2>
          {disciplineRows.length === 0 ? (
            <p className="text-sm text-slate-500">No scopes need a discipline.</p>
          ) : (
            <>
              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded border border-slate-300 bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-600">{selected.size} selected</span>
                  <select
                    value={bulkDiscipline}
                    onChange={(e) => setBulkDiscipline(e.target.value)}
                    className="min-w-[10rem] flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">Trade discipline…</option>
                    {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <button onClick={applyBulkDiscipline} className="whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white">
                    Apply to {selected.size} selected
                  </button>
                </div>
              )}
              <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
                {disciplineRows.map((r) => (
                  <li key={r.canonicalScope} className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={selected.has(r.canonicalScope)} onChange={() => toggleSelected(r.canonicalScope)} className="mt-1" />
                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium">{r.canonicalScope}</div>
                          <button
                            disabled={rowBusy === r.canonicalScope}
                            onClick={() => dismiss(r.canonicalScope)}
                            className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                          >
                            {rowBusy === r.canonicalScope ? "Working…" : "Dismiss"}
                          </button>
                        </div>
                        {r.suggestions.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.suggestions.map((s) => (
                              <button key={s.id} onClick={() => setDisc((v) => ({ ...v, [r.canonicalScope]: s.id }))} className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">{s.name}</button>
                            ))}
                          </div>
                        )}
                        <select
                          value={disc[r.canonicalScope] ?? ""}
                          onChange={(e) => setDisc((v) => ({ ...v, [r.canonicalScope]: Number(e.target.value) }))}
                          className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                        >
                          <option value="">Trade discipline…</option>
                          {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button disabled={busy} onClick={save} className="self-start rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </section>
      )}

      {tab === "drift" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Changed in MS Project</h2>
          <p className="text-xs text-slate-500">
            The re-imported schedule names a different trade partner than this project has assigned. Accepting
            reassigns the discipline; keeping this one leaves the assignment alone until the file says something new.
          </p>
          {driftRows.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing has changed in the file.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
              {driftRows.map((r) => {
                const key = `${r.osDisciplineId}::${r.fileValue}`;
                const busy = rowBusy === key;
                return (
                  <li key={key} className="px-3 py-3">
                    <div className="font-medium">{r.disciplineName}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      file: <span className="font-medium">{r.fileValue}</span> · here:{" "}
                      <span className="font-medium">{r.toolValue ?? "unassigned"}</span> · {r.activityCount} activit
                      {r.activityCount === 1 ? "y" : "ies"}
                    </div>
                    <div className="mt-2 flex gap-1">
                      <button
                        disabled={busy}
                        onClick={() => resolveDrift(r, "accept")}
                        className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        {busy ? "Working…" : "Accept file"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => resolveDrift(r, "keep")}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                      >
                        {busy ? "Working…" : "Keep this one"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "dismissed" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Dismissed scopes (this project)</h2>
          {dismissedScopes.length === 0 ? (
            <p className="text-sm text-slate-500">No dismissed scopes.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
              {dismissedScopes.map((scope) => (
                <li key={scope} className="flex items-center justify-between gap-3 px-3 py-3">
                  <span className="font-medium">{scope}</span>
                  <button
                    disabled={rowBusy === scope}
                    onClick={() => restore(scope)}
                    className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                  >
                    {rowBusy === scope ? "Working…" : "Restore"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
