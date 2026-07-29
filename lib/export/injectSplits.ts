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

// MSPDI's Task type is an xsd:sequence, so child element order is significant,
// and fast-xml-parser serializes object keys in insertion order — which makes
// the order of these assignments a wire-format contract rather than a style
// choice. Microsoft's documented sequence is UID, ID, Name, Type, IsNull, …,
// WBS, OutlineNumber, OutlineLevel, …, Start, Finish, Duration, …, Milestone,
// Summary, …, PredecessorLink.
//
// Out-of-order children are tolerated when the file is opened as a new project
// but not when it is merged into an existing one, which is why this survived
// undetected: opening looked perfectly fine.
function buildNewTask(split: SplitForExport, name: string, uid: number, index: number, predecessors: AnyRec[]): AnyRec {
  const task: AnyRec = {
    UID: String(uid),
    ID: String(uid),
    Name: name,
    Type: "1",
    IsNull: "0",
  };
  if (split.coarseWbsCode) task.WBS = `${split.coarseWbsCode}.${index + 1}`;
  if (split.coarseOutlineNumber) task.OutlineNumber = `${split.coarseOutlineNumber}.${index + 1}`;
  task.OutlineLevel = String(split.coarseOutlineLevel);
  if (split.coarseStart) task.Start = toMspdiDate(split.coarseStart);
  if (split.coarseFinish) task.Finish = toMspdiDate(split.coarseFinish);
  const duration = minutesToIsoDuration(split.coarseDurationMinutes);
  if (duration) task.Duration = duration;
  task.Milestone = "0";
  task.Summary = "0";
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
  dropAssignmentsForRemovedTasks(project, new Set(splits.map((s) => s.coarseExternalUid)));
  return doc;
}

/**
 * A split deletes the coarse <Task>, so any <Assignment> still pointing at it is
 * an orphan. MS Project drops orphans silently when the file is opened as a new
 * project — which is why this went unnoticed — but validates them on append and
 * merge, where they are remapped onto the wrong rows and surface as "You cannot
 * have the same resource assigned twice to the same task".
 *
 * The assignments in question carry ResourceUID -65535, MS Project's "no
 * resource" placeholder, so removing them discards no real allocation. Splitting
 * a task that genuinely has resources assigned would need those reassigned
 * across the finer tasks, which is a decision for whoever accepts the split, not
 * something to infer here.
 */
function dropAssignmentsForRemovedTasks(project: AnyRec | undefined, removedUids: Set<number>): void {
  const assignmentsNode = project?.Assignments as AnyRec | undefined;
  if (!assignmentsNode || removedUids.size === 0) return;
  const kept = asArray(assignmentsNode.Assignment).filter((a) => !removedUids.has(Number(a.TaskUID)));
  assignmentsNode.Assignment = kept;
}
