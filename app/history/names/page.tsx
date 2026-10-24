import Link from "next/link";
import { notFound } from "next/navigation";
import { appPath } from "@/lib/http";
import { isAdminSession } from "@/lib/adminSession";
import { getKnownScopes } from "@/lib/normalize/normalizationService";
import { getNameReview } from "@/lib/normalize/nameReview";

export const dynamic = "force-dynamic";

const SHOWN = 100;

// Activity names no standard scope covers yet, across every project (plan
// Q61–Q63). Mapped and ignored names drop off, so the next one is always on top.
export default async function NameReviewPage(props: { searchParams: Promise<{ min?: string }> }) {
  if (!(await isAdminSession())) notFound();
  const { min: rawMin } = await props.searchParams;
  const min = Math.max(1, Number(rawMin) || 3);
  const [rows, scopes] = await Promise.all([getNameReview(min), getKnownScopes()]);
  const action = appPath("/api/history/names");
  const input = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link href="/history" className="text-sm text-slate-500">← Historical schedules</Link>
      <h1 className="mt-1 text-xl font-semibold">Name review</h1>
      <p className="mb-4 text-sm text-slate-600">
        {rows.length} activity name(s) used in {min}+ projects have no standard scope. Map each to a scope — pick one, or type a
        new one to add it to the standard list — or ignore names that aren&apos;t real work.
      </p>
      <form className="mb-4 flex items-end gap-2 text-sm">
        <label className="flex flex-col text-xs text-slate-600">Used in at least
          <input name="min" type="number" min={1} defaultValue={min} className={`${input} w-24`} />
        </label>
        <button className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white">Show</button>
      </form>
      <datalist id="scopes">
        {scopes.map((s) => <option key={s} value={s} />)}
      </datalist>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {rows.slice(0, SHOWN).map((r) => (
          <li key={r.normalizedName} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span className="break-words font-medium">{r.sampleName}</span>
              <span className="text-xs text-slate-500">{r.projects} projects · {r.sampleProjects.join(", ")}</span>
            </div>
            <form action={action} method="post" className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="name" value={r.sampleName} />
              <input type="hidden" name="min" value={min} />
              <input name="scope" list="scopes" defaultValue={r.suggestion} placeholder="Standard scope" aria-label={`Standard scope for ${r.sampleName}`} className={`${input} min-w-0 flex-1`} />
              <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Map</button>
              <button name="ignore" value="1" className="rounded border border-slate-300 px-3 py-1.5 text-sm">Ignore</button>
            </form>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN && <p className="mt-2 text-xs text-slate-500">Showing the first {SHOWN}; the rest move up as these are cleared.</p>}
    </main>
  );
}
