import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { computeLookahead, type LookaheadActivity } from "@/lib/lookahead/computeLookahead";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries, overlayEntries } from "@/lib/updates/updateService";
import { LookaheadUpdateForm, type LookaheadFormRow } from "@/components/LookaheadUpdateForm";
import { deriveSectionInfo } from "@/lib/schedule/wbsGrouping";

export const dynamic = "force-dynamic";

function isoDay(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function UpdateEditorPage(props: { params: Promise<{ id: string; updateId: string }> }) {
  const params = await props.params;
  const update = await prisma.progressUpdate.findUnique({
    where: { id: params.updateId },
    include: { entries: true, scheduleImport: { include: { activities: true } } },
  });
  if (!update || update.projectId !== params.id) notFound();

  // Document order, so each WBS section's rows stay together under its header.
  const ordered = [...update.scheduleImport.activities].sort((a, b) =>
    (a.outlineNumber ?? "").localeCompare(b.outlineNumber ?? "", undefined, { numeric: true }),
  );
  const byId = new Map(ordered.map((a) => [a.id, a]));
  const sections = deriveSectionInfo(ordered);
  const wbsPathByUid = new Map(ordered.map((a) => [
    a.externalUid,
    (sections.get(a.id)?.ancestorIds ?? [])
      .map((id) => byId.get(id)!)
      .filter((anc) => anc.type !== "project_summary")
      .map((anc) => anc.name),
  ]));

  const activities: LookaheadActivity[] = ordered.map((a) => ({
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
  const effective = overlayEntries(resolveCurrentProgress(await getFinalizedEntries(params.id)), update.entries);

  const lookahead = computeLookahead(
    activities, effective, update.asOfDate, update.lookaheadWeeks,
    // Every activity this draft touched stays in the form, so a re-save never drops its entry.
    new Set(update.entries.map((e) => e.canonicalActivityKey)),
  );
  const rows: LookaheadFormRow[] = lookahead.map((r) => ({
    externalUid: r.externalUid,
    canonicalActivityKey: r.canonicalActivityKey,
    wbsCode: r.wbsCode,
    wbsPath: wbsPathByUid.get(r.externalUid) ?? [],
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
    forecastStart: r.progress.forecastStart?.toISOString() ?? null,
    forecastFinish: r.progress.forecastFinish?.toISOString() ?? null,
    dueByDataDate: r.dueByDataDate,
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
