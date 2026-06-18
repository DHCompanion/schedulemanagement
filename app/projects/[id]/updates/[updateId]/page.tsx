import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { computeLookahead, type LookaheadActivity, type ActivityProgress } from "@/lib/lookahead/computeLookahead";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { LookaheadUpdateForm, type LookaheadFormRow } from "@/components/LookaheadUpdateForm";

export const dynamic = "force-dynamic";

function isoDay(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function UpdateEditorPage({ params }: { params: { id: string; updateId: string } }) {
  const update = await prisma.progressUpdate.findUnique({
    where: { id: params.updateId },
    include: { entries: true, scheduleImport: { include: { activities: true } } },
  });
  if (!update || update.projectId !== params.id) notFound();

  const activities: LookaheadActivity[] = update.scheduleImport.activities.map((a) => ({
    externalUid: a.externalUid,
    canonicalActivityKey: a.canonicalActivityKey,
    wbsCode: a.wbsCode,
    name: a.name,
    type: a.type,
    isActive: a.isActive,
    plannedStart: a.plannedStart,
    plannedFinish: a.plannedFinish,
    actualStart: a.actualStart,
    actualFinish: a.actualFinish,
    percentComplete: a.percentComplete,
  }));

  // Effective progress = carry-forward from finalized updates, overridden by this draft's own entries.
  const carry = resolveCurrentProgress(await getFinalizedEntries(params.id));
  const effective = new Map<string, ActivityProgress>(carry);
  for (const e of update.entries) {
    effective.set(e.canonicalActivityKey, {
      status: e.status as ActivityProgress["status"],
      actualStart: e.actualStart,
      actualFinish: e.actualFinish,
      percentComplete: e.percentComplete,
      note: e.note,
    });
  }

  const lookahead = computeLookahead(activities, effective, update.asOfDate, update.lookaheadWeeks);
  const rows: LookaheadFormRow[] = lookahead.map((r) => ({
    externalUid: r.externalUid,
    canonicalActivityKey: r.canonicalActivityKey,
    wbsCode: r.wbsCode,
    name: r.name,
    type: r.type,
    plannedStart: isoDay(r.plannedStart) || null,
    plannedFinish: isoDay(r.plannedFinish) || null,
    slippage: r.slippage,
    status: r.progress.status,
    actualStart: isoDay(r.progress.actualStart),
    actualFinish: isoDay(r.progress.actualFinish),
    percentComplete: r.progress.percentComplete,
    note: r.progress.note ?? "",
  }));

  const finalized = update.state === "finalized";
  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link href={`/projects/${params.id}/updates`} className="text-sm text-slate-500">← Updates</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Weekly update — {isoDay(update.asOfDate)}</h1>
      <p className="mb-4 text-sm text-slate-500">
        {update.lookaheadWeeks}-week lookahead · {finalized ? "finalized" : "draft"} · {rows.length} activities
      </p>
      <LookaheadUpdateForm updateId={update.id} projectId={params.id} rows={rows} readOnly={finalized} />
    </main>
  );
}
