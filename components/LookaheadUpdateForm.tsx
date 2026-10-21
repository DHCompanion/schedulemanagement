"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { appPath, sendJson } from "@/lib/http";
import type { Impact as ImpactCore } from "@/lib/updates/computeImpacts";

export interface LookaheadFormRow {
  externalUid: number;
  canonicalActivityKey: string;
  wbsCode: string | null;
  /** Names of the WBS summary rows above this activity, outermost first. */
  wbsPath: string[];
  name: string;
  type: string;
  plannedStart: string | null;
  plannedFinish: string | null;
  slippage: "overdue" | "should-have-started" | "on-track";
  status: "not_started" | "in_progress" | "complete" | "completed_as_planned";
  actualStart: string;
  actualFinish: string;
  percentComplete: number | null;
  note: string;
  /** Full ISO timestamps accepted on the review screen; null when on plan. */
  forecastStart: string | null;
  forecastFinish: string | null;
  /** Incomplete work that should have started by the data date, or is underway. */
  dueByDataDate: boolean;
}

/** One not-started activity the unsaved entries would move, as POST /impacts returns it. */
export type Impact = ImpactCore & { name: string; wbsCode: string | null; drivenByName: string | null; note: string | null };

type Status = LookaheadFormRow["status"];

const slip: Record<LookaheadFormRow["slippage"], { label: string; className: string }> = {
  overdue: { label: "Overdue", className: "bg-red-50 text-red-700 ring-red-200" },
  "should-have-started": { label: "Should have started", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  "on-track": { label: "On track", className: "bg-slate-50 text-slate-500 ring-slate-200" },
};

const statusOptions: { value: Exclude<Status, "completed_as_planned">; label: string; on: string }[] = [
  { value: "not_started", label: "Not started", on: "bg-slate-700 text-white" },
  { value: "in_progress", label: "In progress", on: "bg-sky-600 text-white" },
  { value: "complete", label: "Complete", on: "bg-emerald-600 text-white" },
];

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const isComplete = (s: Status) => s === "complete" || s === "completed_as_planned";

function validate(r: LookaheadFormRow): string | null {
  if (r.status === "in_progress" && !r.actualStart) return "Enter an actual start.";
  if (isComplete(r.status) && !r.actualFinish) return "Enter an actual finish.";
  if (r.actualStart && r.actualFinish && r.actualFinish < r.actualStart) return "Actual finish is before actual start.";
  if (r.percentComplete != null && (r.percentComplete < 0 || r.percentComplete > 100)) return "% complete must be 0–100.";
  return null;
}

/** Fields a status change implies, so the row can never hold a contradictory combination. */
function applyStatus(r: LookaheadFormRow, status: Status): Partial<LookaheadFormRow> {
  if (status === "not_started") return { status, actualStart: "", actualFinish: "", percentComplete: null };
  if (status === "in_progress") return { status, actualFinish: "", percentComplete: r.percentComplete === 100 ? null : r.percentComplete };
  return { status, percentComplete: 100 };
}

const editable = (r: LookaheadFormRow) =>
  JSON.stringify([r.status, r.actualStart, r.actualFinish, r.percentComplete, r.note, r.forecastStart, r.forecastFinish]);

function toEntry(r: LookaheadFormRow) {
  return {
    activityExternalUid: r.externalUid,
    canonicalActivityKey: r.canonicalActivityKey,
    status: r.status === "completed_as_planned" ? "complete" : r.status,
    actualStart: r.actualStart || null,
    actualFinish: r.actualFinish || null,
    percentComplete: r.percentComplete,
    note: r.note || null,
    forecastStart: r.forecastStart,
    forecastFinish: r.forecastFinish,
  };
}

export function LookaheadUpdateForm({
  updateId, projectId, rows, readOnly,
}: { updateId: string; projectId: string; rows: LookaheadFormRow[]; readOnly: boolean }) {
  const router = useRouter();
  // A refresh after saving hands down fresh rows; reset to them so the form
  // (and the unsaved baseline) is the server's truth again.
  const [base, setBase] = useState(rows);
  const [data, setData] = useState(rows);
  if (rows !== base) { setBase(rows); setData(rows); }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [review, setReview] = useState<{ impacts: Impact[]; adjust: Set<number>; finalize: boolean } | null>(null);

  const baseline = new Map(base.map((r) => [r.externalUid, editable(r)]));
  const isDirty = (r: LookaheadFormRow) => baseline.get(r.externalUid) !== editable(r);
  const dirtyCount = data.filter(isDirty).length;
  const invalid = data.filter((r) => isDirty(r) && validate(r)).length;
  const upcomingCount = data.filter((r) => !r.dueByDataDate).length;
  const visible = data.filter((r) => showUpcoming || r.dueByDataDate || isDirty(r));

  useEffect(() => {
    if (!dirtyCount || readOnly) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount, readOnly]);

  function patch(uid: number, p: Partial<LookaheadFormRow>) {
    setData((d) => d.map((r) => (r.externalUid === uid ? { ...r, ...p } : r)));
  }

  async function check(finalize: boolean) {
    setError(null);
    if (invalid) { setShowErrors(true); setError(`Fix ${invalid === 1 ? "the highlighted row" : `the ${invalid} highlighted rows`} before saving.`); return; }
    setBusy(true);
    const res = await fetch(appPath(`/api/updates/${updateId}/impacts`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: data.map(toEntry) }),
    });
    if (!res.ok) { setError("Couldn't check which activities move. Try again."); setBusy(false); return; }
    const impacts = ((await res.json()) as { impacts?: Impact[] }).impacts ?? [];
    if (impacts.length) { setReview({ impacts, adjust: new Set(), finalize }); setBusy(false); return; }
    await persist(data.map(toEntry), finalize);
  }

  async function confirmReview() {
    if (!review) return;
    const adjusted = review.impacts.filter((i) => review.adjust.has(i.externalUid));
    const byUid = new Map(adjusted.map((i) => [i.externalUid, i]));
    const entries = data.map((r) => {
      const i = byUid.get(r.externalUid);
      return toEntry(i ? { ...r, forecastStart: i.proposedStart, forecastFinish: i.proposedFinish } : r);
    });
    const inForm = new Set(data.map((r) => r.externalUid));
    for (const i of adjusted.filter((i) => !inForm.has(i.externalUid))) {
      entries.push({
        activityExternalUid: i.externalUid, canonicalActivityKey: i.canonicalActivityKey, status: "not_started",
        actualStart: null, actualFinish: null, percentComplete: null, note: i.note,
        forecastStart: i.proposedStart, forecastFinish: i.proposedFinish,
      });
    }
    setReview(null);
    setBusy(true);
    await persist(entries, review.finalize);
  }

  async function persist(entries: ReturnType<typeof toEntry>[], finalize: boolean) {
    // sendJson's own transport is used here, but its returned message is not —
    // this endpoint has never surfaced the server's wording (see the
    // component test locking in "Failed to save." for any failure body).
    const entriesErr = await sendJson(`/api/updates/${updateId}/entries`, { entries });
    if (entriesErr) { setError("Failed to save."); setBusy(false); return; }
    if (finalize) {
      const fin = await fetch(appPath(`/api/updates/${updateId}/finalize`), { method: "POST" });
      if (!fin.ok) { setError("Failed to finalize."); setBusy(false); return; }
    }
    setBusy(false);
    setShowErrors(false);
    if (finalize) router.push(`/projects/${projectId}/updates`);
    else router.refresh();
  }

  return (
    <div className="pb-20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-slate-600">
          {showUpcoming
            ? `All ${data.length} activities in the lookahead`
            : `${data.length - upcomingCount} activities due by the data date`}
        </p>
        {upcomingCount > 0 && (
          <button
            type="button"
            onClick={() => setShowUpcoming((v) => !v)}
            aria-pressed={showUpcoming}
            className="rounded-full border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50"
          >
            {showUpcoming ? "Hide upcoming" : `Show upcoming (${upcomingCount})`}
          </button>
        )}
      </div>

      {error && <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {visible.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Nothing was due to start by the data date.{upcomingCount > 0 && " Show upcoming to update work ahead of plan."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {visible.map((r, i) => (
            <Fragment key={r.externalUid}>
              {r.wbsPath.length > 0 && r.wbsPath.join(" › ") !== visible[i - 1]?.wbsPath.join(" › ") && (
                <li className="bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700" data-testid="wbs-header">
                  {r.wbsPath.join(" › ")}
                </li>
              )}
              <ActivityRow
                r={r}
                readOnly={readOnly}
                dirty={isDirty(r)}
                problem={showErrors && isDirty(r) ? validate(r) : null}
                onChange={(p) => patch(r.externalUid, p)}
              />
            </Fragment>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <span className="text-sm text-slate-600" aria-live="polite">
              {dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}` : "All changes saved"}
            </span>
            <span className="flex gap-2">
              <button disabled={busy} onClick={() => check(false)} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50">Save draft</button>
              <button disabled={busy} onClick={() => check(true)} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Finalize</button>
            </span>
          </div>
        </div>
      )}

      {review && (
        <ImpactReview
          impacts={review.impacts}
          adjust={review.adjust}
          finalize={review.finalize}
          onToggle={(uid) => setReview((rv) => {
            if (!rv) return rv;
            const adjust = new Set(rv.adjust);
            if (adjust.has(uid)) adjust.delete(uid); else adjust.add(uid);
            return { ...rv, adjust };
          })}
          onAdjustAll={() => setReview((rv) => rv && { ...rv, adjust: new Set(rv.impacts.map((i) => i.externalUid)) })}
          onCancel={() => setReview(null)}
          onConfirm={confirmReview}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-500">
      {label}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

const inputClass = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-400";

function ActivityRow({ r, readOnly, dirty, problem, onChange }: {
  r: LookaheadFormRow; readOnly: boolean; dirty: boolean; problem: string | null;
  onChange: (p: Partial<LookaheadFormRow>) => void;
}) {
  const notStarted = r.status === "not_started";
  const complete = isComplete(r.status);
  const s = slip[r.slippage];
  return (
    <li className={`border-l-4 px-3 py-3 ${dirty ? "border-indigo-500 bg-indigo-50/30" : "border-transparent"} ${problem ? "bg-red-50/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span>
          <span className="mr-2 text-xs text-slate-400">{r.wbsCode}</span>
          <span className="font-medium text-slate-900">{r.name}</span>
          {r.type === "milestone" && <span className="ml-2 text-xs text-indigo-600" title="Milestone">◆</span>}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${s.className}`}>{s.label}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Planned {r.plannedStart ?? "—"} to {r.plannedFinish ?? "—"}
        {r.forecastStart && <span className="ml-2 text-indigo-700">Forecast {day(r.forecastStart)} to {day(r.forecastFinish)}</span>}
      </p>

      {!readOnly && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!r.plannedStart || complete}
            onClick={() => onChange({ ...applyStatus(r, "in_progress"), actualStart: r.plannedStart ?? "" })}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >Started on plan</button>
          <button
            type="button"
            disabled={!r.plannedStart || !r.plannedFinish}
            onClick={() => onChange({ status: "completed_as_planned", actualStart: r.plannedStart ?? "", actualFinish: r.plannedFinish ?? "", percentComplete: 100 })}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >Completed as planned</button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[auto_1fr_1fr_6rem]">
        <fieldset className="col-span-2 sm:col-span-1" disabled={readOnly}>
          <legend className="text-xs font-medium text-slate-500">Status</legend>
          <div className="mt-1 inline-flex overflow-hidden rounded border border-slate-300">
            {statusOptions.map((o) => {
              const on = o.value === "complete" ? complete : r.status === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(applyStatus(r, o.value))}
                  className={`whitespace-nowrap px-2.5 py-1.5 text-sm ${on ? o.on : "bg-white text-slate-600 hover:bg-slate-50"} border-r border-slate-300 last:border-r-0`}
                >{o.label}</button>
              );
            })}
          </div>
        </fieldset>
        <Field label="Actual start">
          <input disabled={readOnly || notStarted} type="date" value={r.actualStart} onChange={(e) => onChange({ actualStart: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Actual finish">
          <input disabled={readOnly || !complete} type="date" value={r.actualFinish} onChange={(e) => onChange({ actualFinish: e.target.value })} className={inputClass} />
        </Field>
        <Field label="% complete">
          <input
            disabled={readOnly || notStarted || complete}
            type="number" min={0} max={100} inputMode="numeric"
            value={r.percentComplete ?? ""}
            onChange={(e) => onChange({ percentComplete: e.target.value === "" ? null : Number(e.target.value) })}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Note">
          <input disabled={readOnly} value={r.note} onChange={(e) => onChange({ note: e.target.value })} placeholder="Optional" className={inputClass} />
        </Field>
      </div>
      {problem && <p className="mt-2 text-sm text-red-700">{problem}</p>}
    </li>
  );
}

function ImpactReview({ impacts, adjust, finalize, onToggle, onAdjustAll, onCancel, onConfirm }: {
  impacts: Impact[]; adjust: Set<number>; finalize: boolean;
  onToggle: (uid: number) => void; onAdjustAll: () => void; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="impact-title" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-lg bg-white p-4 shadow-xl sm:rounded-lg sm:p-6">
        <h2 id="impact-title" className="text-lg font-semibold text-slate-900">
          {impacts.length === 1 ? "1 activity moves" : `${impacts.length} activities move`} because of this update
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Adjust an activity to carry its new dates into the schedule and export. Leave it to keep its current dates; the forecast will still show the slip.
        </p>
        <ul className="mt-4 divide-y divide-slate-200 rounded border border-slate-200">
          {impacts.map((i) => {
            const on = adjust.has(i.externalUid);
            return (
              <li key={i.externalUid} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    <span className="mr-2 text-xs text-slate-400">{i.wbsCode}</span>{i.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {i.kind === "push" ? "Pushed later" : "Pulled earlier"}{i.drivenByName && ` by ${i.drivenByName}`}
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="text-slate-500 line-through decoration-slate-300">{day(i.currentStart)} to {day(i.currentFinish)}</span>
                    <span className={`ml-2 font-medium ${i.kind === "push" ? "text-amber-700" : "text-emerald-700"}`}>{day(i.proposedStart)} to {day(i.proposedFinish)}</span>
                  </p>
                </div>
                <div className="inline-flex overflow-hidden rounded border border-slate-300 text-sm">
                  <button type="button" aria-pressed={!on} onClick={() => on && onToggle(i.externalUid)} aria-label={`Leave ${i.name}`}
                    className={`px-3 py-1.5 ${!on ? "bg-slate-700 text-white" : "bg-white text-slate-600"}`}>Leave</button>
                  <button type="button" aria-pressed={on} onClick={() => !on && onToggle(i.externalUid)} aria-label={`Adjust ${i.name}`}
                    className={`border-l border-slate-300 px-3 py-1.5 ${on ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>Adjust</button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onAdjustAll} className="text-sm font-medium text-indigo-700 hover:underline">Adjust all</button>
          <span className="flex gap-2">
            <button type="button" onClick={onCancel} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">Back to editing</button>
            <button type="button" onClick={onConfirm} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
              {finalize ? "Continue and finalize" : "Continue and save draft"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
