import Link from "next/link";
import { notFound } from "next/navigation";
import { appPath } from "@/lib/http";
import { isAdminSession } from "@/lib/adminSession";
import { getKnownScopes } from "@/lib/normalize/normalizationService";
import { getNameRequests, getNameReview } from "@/lib/normalize/nameReview";

export const dynamic = "force-dynamic";

const SHOWN = 100;

// Activity names no standard scope covers yet, across every project (plan
// Q61–Q63), with users' requested new names on top. Settled names drop off, so
// the next one is always first.
export default async function NameReviewPage(props: { searchParams: Promise<{ min?: string }> }) {
  if (!(await isAdminSession())) notFound();
  const { min: rawMin } = await props.searchParams;
  const min = Math.max(1, Number(rawMin) || 3);
  const [rows, scopes, requests] = await Promise.all([getNameReview(min), getKnownScopes(), getNameRequests()]);
  const action = appPath("/api/history/names");
  const input = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link href="/history" className="text-sm text-slate-500">← Historical schedules</Link>
      <h1 className="mt-1 text-xl font-semibold">Name review</h1>
      <p className="mb-4 text-sm text-slate-600">
        {rows.length} activity name(s) used in {min}+ projects have no standard name. Map each to one of the {scopes.length} approved
        names, mark it coarse (bundles several) or procurement (a material or lead-time line), or ignore it if it isn&apos;t work.
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <form className="flex items-end gap-2 text-sm">
          <label className="flex flex-col text-xs text-slate-600">Used in at least
            <input name="min" type="number" min={1} defaultValue={min} className={`${input} w-24`} />
          </label>
          <button className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white">Show</button>
        </form>
        <form action={action} method="post" className="flex items-end gap-2 text-sm">
          <input type="hidden" name="min" value={min} />
          <label className="flex flex-col text-xs text-slate-600">New standard name
            <input name="newScope" required className={`${input} w-56`} />
          </label>
          <button className="rounded border border-slate-300 px-3 py-1.5">Add to list</button>
        </form>
      </div>

      {requests.length > 0 && (
        <>
          <h2 className="mb-2 font-medium">Requested new names ({requests.length})</h2>
          <ul className="mb-6 divide-y divide-slate-200 rounded border border-amber-200 bg-amber-50/40">
            {requests.map((r) => (
              <li key={r.normalizedName} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="break-words font-medium">{r.rawName}</span>
                  <span className="text-xs text-slate-500">{[r.requestedBy, r.projectName].filter(Boolean).join(" · ") || "requested"}</span>
                </div>
                <NameActions action={action} name={r.rawName} min={min} scopes={scopes} input={input} approve />
              </li>
            ))}
          </ul>
        </>
      )}

      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {rows.slice(0, SHOWN).map((r) => (
          <li key={r.normalizedName} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span className="break-words font-medium">{r.sampleName}</span>
              <span className="text-xs text-slate-500">{r.projects} projects · {r.sampleProjects.join(", ")}</span>
            </div>
            <NameActions action={action} name={r.sampleName} min={min} scopes={scopes} input={input} suggestion={r.suggestion} />
          </li>
        ))}
      </ul>
      {rows.length > SHOWN && <p className="mt-2 text-xs text-slate-500">Showing the first {SHOWN}; the rest move up as these are cleared.</p>}
    </main>
  );
}

function NameActions(props: { action: string; name: string; min: number; scopes: string[]; input: string; suggestion?: string; approve?: boolean }) {
  const { action, name, min, scopes, input } = props;
  const small = "rounded border border-slate-300 px-3 py-1.5 text-sm";
  return (
    <form action={action} method="post" className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="min" value={min} />
      <select name="scope" defaultValue={props.suggestion ?? ""} aria-label={`Standard name for ${name}`} className={`${input} min-w-0 flex-1`}>
        <option value="">Standard name…</option>
        {scopes.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Map</button>
      {props.approve && <button name="approve" value="1" className={small}>Approve as new name</button>}
      <button name="class" value="coarse" className={small}>Coarse</button>
      <button name="class" value="procurement" className={small}>Procurement</button>
      <button name="ignore" value="1" className={small}>Ignore</button>
    </form>
  );
}
