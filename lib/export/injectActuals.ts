import { toMspdiDate } from "@/lib/export/mspdiDate";

export interface ProgressForExport {
  status: string;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
}

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as AnyRec[];
}

/** Mutate matching <Task> nodes with actuals/% from the progress map; leaves everything else untouched. */
export function injectActuals(doc: AnyRec, progressByUid: Map<number, ProgressForExport>): AnyRec {
  const project = doc.Project as AnyRec | undefined;
  const tasksNode = project?.Tasks as AnyRec | undefined;
  for (const task of asArray(tasksNode?.Task)) {
    const p = progressByUid.get(Number(task.UID));
    if (!p || p.status === "not_started") continue;
    const ownStart = task.Start as string | undefined;
    const ownFinish = task.Finish as string | undefined;
    const start = p.actualStart ? toMspdiDate(p.actualStart) : ownStart;
    if (p.status === "complete") {
      task.PercentComplete = "100";
      const finish = p.actualFinish ? toMspdiDate(p.actualFinish) : ownFinish;
      if (finish) task.ActualFinish = finish;
      if (start) task.ActualStart = start;
    } else if (p.status === "in_progress") {
      if (start) task.ActualStart = start;
      if (p.percentComplete != null) task.PercentComplete = String(p.percentComplete);
    }
  }
  return doc;
}
