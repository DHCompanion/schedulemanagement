import { toMspdiDate } from "@/lib/export/mspdiDate";
import { minutesToIsoDuration } from "@/lib/msp/duration";

export interface SplitForExport {
  coarseExternalUid: number;
  coarseWbsCode: string | null;
  coarseOutlineNumber: string | null;
  coarseOutlineLevel: number;
  coarseDurationMinutes: number | null;
  coarseStart: Date | null;
  coarseFinish: Date | null;
  finerScopes: string[];
  mintedUids: number[];
}

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as AnyRec[];
}

function buildNewTask(split: SplitForExport, name: string, uid: number, index: number, predecessors: AnyRec[]): AnyRec {
  const task: AnyRec = {
    UID: String(uid),
    ID: String(uid),
    Name: name,
    OutlineLevel: String(split.coarseOutlineLevel),
    Type: "1",
    Milestone: "0",
    Summary: "0",
    IsNull: "0",
  };
  if (split.coarseWbsCode) task.WBS = `${split.coarseWbsCode}.${index + 1}`;
  if (split.coarseOutlineNumber) task.OutlineNumber = `${split.coarseOutlineNumber}.${index + 1}`;
  if (split.coarseStart) task.Start = toMspdiDate(split.coarseStart);
  if (split.coarseFinish) task.Finish = toMspdiDate(split.coarseFinish);
  const duration = minutesToIsoDuration(split.coarseDurationMinutes);
  if (duration) task.Duration = duration;
  if (predecessors.length === 1) task.PredecessorLink = { ...predecessors[0] };
  else if (predecessors.length > 1) task.PredecessorLink = predecessors.map((p) => ({ ...p }));
  return task;
}

/** Mutate the Tasks list: replace each split's coarse <Task> with N parallel finer <Task> nodes, fanning predecessors out and successors in via <PredecessorLink>. */
export function injectSplits(doc: AnyRec, splits: SplitForExport[]): AnyRec {
  const project = doc.Project as AnyRec | undefined;
  const tasksNode = project?.Tasks as AnyRec | undefined;
  if (!tasksNode) return doc;
  let tasks = asArray(tasksNode.Task);

  for (const split of splits) {
    const coarseIndex = tasks.findIndex((t) => Number(t.UID) === split.coarseExternalUid);
    if (coarseIndex === -1) continue;
    const coarsePredecessors = asArray(tasks[coarseIndex].PredecessorLink);

    const newTasks = split.finerScopes.map((name, i) => buildNewTask(split, name, split.mintedUids[i], i, coarsePredecessors));
    tasks.splice(coarseIndex, 1, ...newTasks);

    for (const t of tasks) {
      const links = asArray(t.PredecessorLink);
      if (!links.some((l) => Number(l.PredecessorUID) === split.coarseExternalUid)) continue;
      const rebuilt: AnyRec[] = [];
      for (const l of links) {
        if (Number(l.PredecessorUID) !== split.coarseExternalUid) {
          rebuilt.push(l);
          continue;
        }
        for (const uid of split.mintedUids) rebuilt.push({ ...l, PredecessorUID: String(uid) });
      }
      t.PredecessorLink = rebuilt.length === 1 ? rebuilt[0] : rebuilt;
    }
  }

  tasksNode.Task = tasks;
  return doc;
}
