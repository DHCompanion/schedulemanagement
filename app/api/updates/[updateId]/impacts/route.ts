import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { denyIfOutOfScope } from "@/lib/scope";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { computeImpacts } from "@/lib/updates/computeImpacts";
import { getFinalizedEntries, overlayEntries, storedShape, type EntryInput } from "@/lib/updates/updateService";

/** Dry run for the update review screen: which not-started activities the unsaved entries would push or pull. */
export async function POST(req: Request, props: { params: Promise<{ updateId: string }> }) {
  const params = await props.params;
  const body = (await req.json()) as { entries?: EntryInput[] };

  const update = await prisma.progressUpdate.findUnique({
    where: { id: params.updateId },
    include: { entries: true, scheduleImport: { include: { activities: true, relationships: true } } },
  });
  if (!update) return NextResponse.json({ error: { message: "Update not found." } }, { status: 404 });
  const denied = await denyIfOutOfScope(req, update.projectId);
  if (denied) return denied;

  const carry = resolveCurrentProgress(await getFinalizedEntries(update.projectId));
  const { activities, relationships, minutesPerDay } = update.scheduleImport;
  const impacts = computeImpacts({
    activities,
    relationships,
    before: overlayEntries(carry, update.entries),
    after: overlayEntries(carry, storedShape(body.entries ?? [])),
    statusDate: update.asOfDate,
    minutesPerDay,
  });
  const byUid = new Map(activities.map((a) => [a.externalUid, a]));
  return NextResponse.json({
    impacts: impacts.map((i) => ({
      ...i,
      name: byUid.get(i.externalUid)?.name ?? "",
      wbsCode: byUid.get(i.externalUid)?.wbsCode ?? null,
      drivenByName: i.drivenByUid == null ? null : byUid.get(i.drivenByUid)?.name ?? null,
    })),
  });
}
