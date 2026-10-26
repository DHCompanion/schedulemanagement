import Link from "next/link";
import { notFound } from "next/navigation";
import { appPath } from "@/lib/http";
import { isAdminSession } from "@/lib/adminSession";
import { PROJECT_TYPES, SECTORS, SUBTYPES } from "@/lib/historical";
import { getKnownScopes } from "@/lib/normalize/normalizationService";
import { buildDraft, getChecklist, getDraftGroup, readDraftQuery } from "@/lib/baseline/draftInputs";
import { fmtShortDate } from "@/lib/schedule/weekBuckets";

export const dynamic = "force-dynamic";

// Past projects vary: at 50% an Imaging draft ticked 8 names, at 25% it ticks 27 (decided 2026-10-26).
const TICK_SHARE = 0.25;

const nextMonday = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
};

// Draft baseline generator (roadmap Phase 7, decided 2026-10-26): pick a
// project type (and subtype, where it has them) and start date, tick standard names, preview, download MS
// Project XML. Built from the stored benchmarks; admin only in v1.
export default async function DraftBaselinePage(props: { searchParams: Promise<Record<string, string | string[]>> }) {
  if (!(await isAdminSession())) notFound();
  const raw = await props.searchParams;
  const q = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => [k, x])));
  const { type, subType: picked, start, scopes } = readDraftQuery(q);
  // The form keeps the old subtype when the type changes; drop it here (the download route still rejects one).
  const subTypes = SUBTYPES[type];
  const subType = subTypes?.includes(picked) ? picked : "";
  const startText = q.get("start") || nextMonday();
  const group = type ? await getDraftGroup(type, subType) : null;
  const ready = group && !("error" in group) ? group : null;
  const [checklist, known] = ready ? await Promise.all([getChecklist(ready), getKnownScopes()]) : [[], []];
  const previewing = q.get("preview") === "1";
  // First visit ticks names most past projects of this type had; after that the form says.
  const chosen = previewing ? scopes : checklist.filter((c) => c.share >= TICK_SHARE).map((c) => c.name);
  const draft = ready && previewing && start && chosen.length ? await buildDraft(ready, chosen, start) : null;
  const nameOf = new Map(draft?.activities.map((a) => [a.uid, a.name]));
  const input = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";
  const download = new URLSearchParams([["type", type], ...(subType ? [["sub", subType]] : []), ["start", startText], ...chosen.map((s) => ["scope", s])]);

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link href="/history" className="text-sm text-slate-500">← Historical schedules</Link>
      <h1 className="mt-1 text-xl font-semibold">Draft baseline</h1>
      <p className="mb-4 text-sm text-slate-600">
        One activity per standard name, with the P75 planned duration from past projects, linked where most of them link the pair.
        Download it, refine it in MS Project, then import it into the real project.
      </p>

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <select name="type" defaultValue={type} aria-label="Project type" className={input} required>
          <option value="">Project type…</option>
          {SECTORS.map((s) => (
            <optgroup key={s} label={s}>
              {PROJECT_TYPES[s].map((t) => <option key={t}>{t}</option>)}
            </optgroup>
          ))}
        </select>
        {/* Shows once a type with subtypes is chosen. */}
        {subTypes && (
          <select name="sub" defaultValue={subType} aria-label="Subtype" className={input}>
            <option value="">Any subtype</option>
            {subTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
        )}
        <input type="date" name="start" defaultValue={startText} aria-label="Start date" className={input} required />
        <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Choose names</button>
      </form>

      {group && "error" in group && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{group.error}</p>}

      {ready && (
        <form className="mb-6 rounded border border-slate-200 bg-white p-4">
          <input type="hidden" name="type" value={type} />
          {ready.subType && <input type="hidden" name="sub" value={ready.subType} />}
          <input type="hidden" name="start" value={startText} />
          <input type="hidden" name="preview" value="1" />
          <p className="mb-2 text-sm text-slate-600">
            {ready.sectorProjects} {ready.sector} projects, {ready.typeProjects} of them {type}{ready.subType && `, ${ready.subTypeProjects} ${ready.subType}`}. Ticked: names in at least a quarter of them.
          </p>
          <div className="mb-3 grid max-h-96 grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2">
            {checklist.map((c) => (
              <label key={c.name} className="flex items-center gap-2 py-0.5 text-sm">
                <input type="checkbox" name="scope" value={c.name} defaultChecked={chosen.includes(c.name)} />
                <span>{c.name}</span>
                <span className="text-xs text-slate-400">{Math.round(c.share * 100)}%</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input name="scope" list="known-scopes" placeholder="Add a standard name" aria-label="Add a standard name" className={`${input} w-64`} />
            <datalist id="known-scopes">{known.map((s) => <option key={s} value={s} />)}</datalist>
            <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Preview draft</button>
          </div>
        </form>
      )}

      {draft && (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">
              {draft.activities.length - 2} activities · {draft.workingDays} working days · finish {fmtShortDate(draft.activities.at(-1)!.finish.toISOString())}
            </h2>
            <a href={appPath(`/api/history/draft-baseline?${download}`)} className="rounded bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800">
              Download MS Project XML
            </a>
          </div>
          <p className="mb-2 text-xs text-slate-500">Durations are P75 days worked in past projects. <span className="italic">Italic</span> predecessors are weaker links.</p>
          {draft.warnings.length > 0 && (
            <ul className="mb-3 list-disc rounded border border-amber-200 bg-amber-50 py-2 pl-6 pr-3 text-sm text-amber-800">
              {draft.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr><th className="px-2 py-1">Activity</th><th className="px-2 py-1">Days</th><th className="px-2 py-1">Start</th><th className="px-2 py-1">Finish</th><th className="px-2 py-1">After</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {draft.activities.map((a) => (
                  <tr key={a.uid}>
                    <td className="px-2 py-1">{a.name}{a.lowConfidence && <span className="ml-1 text-xs text-amber-700" title="Fewer than 5 projects of this type">thin</span>}</td>
                    <td className="px-2 py-1">{a.milestone ? "—" : a.days}</td>
                    <td className="px-2 py-1">{fmtShortDate(a.start.toISOString())}</td>
                    <td className="px-2 py-1">{fmtShortDate(a.finish.toISOString())}</td>
                    <td className="px-2 py-1 text-slate-500">
                      {a.preds.map((p, i) => (
                        <span key={p.uid} className={p.weak ? "italic text-slate-400" : undefined} title={p.weak ? "Commonest predecessor, but under half of projects link it" : undefined}>
                          {i > 0 && ", "}{nameOf.get(p.uid)}{p.type === "FS" ? "" : ` ${p.type}`}{p.lagDays ? ` +${p.lagDays}d` : ""}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
