import { XMLParser } from "fast-xml-parser";
import type {
  ParsedSchedule, ParsedActivity, ParsedRelationship, ParsedFieldDefinition,
  ParsedResource, ParsedAssignment, ParsedCalendar, ParsedProjectHeader, CanonicalActivityType,
} from "./types";
import { parseIsoDurationToMinutes, tenthsOfMinuteToMinutes, minutesToDays } from "./duration";
import { mapRelationshipType } from "./relationshipType";
import { deriveParents } from "./hierarchy";
import { canonicalActivityKey } from "./canonicalKey";

type Any = Record<string, unknown>;

function toArray(v: unknown): Any[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as Any[];
}
function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length ? s : null;
}
function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function bool(v: unknown): boolean {
  return String(v) === "1";
}

export function parseMspXml(xml: string): ParsedSchedule {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
  const doc = parser.parse(xml) as Any;
  const project = doc.Project as Any | undefined;
  if (!project) throw new Error("Not a Microsoft Project XML file (missing <Project> root).");
  const warnings: string[] = [];

  const fieldDefinitions: ParsedFieldDefinition[] = toArray((project.ExtendedAttributes as Any)?.ExtendedAttribute as Any).map((ea: Any) => ({
    fieldId: String(ea.FieldID ?? ""),
    fieldName: String(ea.FieldName ?? ""),
    alias: String(ea.Alias ?? ea.FieldName ?? ""),
  }));
  const aliasByFieldId = new Map(fieldDefinitions.map((f) => [f.fieldId, f.alias]));

  const rawProps: Record<string, string> = {};
  for (const [k, v] of Object.entries(project)) {
    if (typeof v === "string" || typeof v === "number") rawProps[k] = String(v);
  }

  const header: ParsedProjectHeader = {
    titleFromFile: str(project.Title) ?? str(project.Name) ?? "Untitled",
    externalProjectGuid: str(project.GUID),
    statusDate: str(project.StatusDate),
    projectStart: str(project.StartDate),
    projectFinish: str(project.FinishDate),
    minutesPerDay: num(project.MinutesPerDay) ?? 480,
    minutesPerWeek: num(project.MinutesPerWeek),
    daysPerMonth: num(project.DaysPerMonth),
    defaultCalendarUid: num(project.CalendarUID),
    rawProps,
  };
  const minutesPerDay = header.minutesPerDay;

  const rawTasks = toArray((project.Tasks as Any)?.Task as Any).filter((t: Any) => !bool(t.IsNull));
  const outlineNodes = rawTasks.map((t: Any) => ({ externalUid: num(t.UID) ?? -1, outlineLevel: num(t.OutlineLevel) ?? 0 }));
  const parentMap = deriveParents(outlineNodes);

  const activities: ParsedActivity[] = [];
  const relationships: ParsedRelationship[] = [];
  let milestoneCount = 0;

  for (const t of rawTasks) {
    const uid = num(t.UID);
    if (uid === null) { warnings.push("Skipped a task with no UID."); continue; }

    const isMilestone = bool(t.Milestone);
    const isSummary = bool(t.Summary);
    const outlineLevel = num(t.OutlineLevel) ?? 0;
    const isProjectSummary = outlineLevel === 0;
    let type: CanonicalActivityType = "task";
    if (isProjectSummary) type = "project_summary";
    else if (isSummary) type = "summary";
    else if (isMilestone) type = "milestone";
    if (isMilestone) milestoneCount++;

    const customFields: Record<string, string> = {};
    for (const ea of toArray(t.ExtendedAttribute as Any)) {
      const alias = aliasByFieldId.get(String((ea as Any).FieldID)) ?? String((ea as Any).FieldID);
      const val = str((ea as Any).Value);
      if (val !== null) customFields[alias] = val;
    }

    const baselines = toArray(t.Baseline as Any);
    const baseline0 = baselines.find((b: Any) => String(b.Number) === "0") as Any | undefined;
    const durationMinutes = parseIsoDurationToMinutes(str(t.Duration));
    const name = str(t.Name) ?? "(unnamed)";
    const wbsCode = str(t.WBS);

    activities.push({
      externalUid: uid,
      externalGuid: str(t.GUID),
      externalId: num(t.ID),
      name,
      wbsCode,
      outlineNumber: str(t.OutlineNumber),
      outlineLevel,
      parentExternalUid: parentMap.get(uid) ?? null,
      type,
      rawType: str(t.Type),
      isMilestone,
      isSummary,
      isProjectSummary,
      isCritical: bool(t.Critical),
      isActive: t.Active === undefined ? true : bool(t.Active),
      plannedStart: str(t.Start),
      plannedFinish: str(t.Finish),
      earlyStart: str(t.EarlyStart),
      earlyFinish: str(t.EarlyFinish),
      lateStart: str(t.LateStart),
      lateFinish: str(t.LateFinish),
      actualStart: str(t.ActualStart),
      actualFinish: str(t.ActualFinish),
      baselineStart: baseline0 ? str(baseline0.Start) : null,
      baselineFinish: baseline0 ? str(baseline0.Finish) : null,
      baselineDurationMinutes: baseline0 ? parseIsoDurationToMinutes(str(baseline0.Duration)) : null,
      durationMinutes,
      durationDays: minutesToDays(durationMinutes, minutesPerDay),
      remainingDurationMinutes: parseIsoDurationToMinutes(str(t.RemainingDuration)),
      actualDurationMinutes: parseIsoDurationToMinutes(str(t.ActualDuration)),
      percentComplete: num(t.PercentComplete),
      percentWorkComplete: num(t.PercentWorkComplete),
      totalSlackMinutes: tenthsOfMinuteToMinutes(t.TotalSlack as string),
      freeSlackMinutes: tenthsOfMinuteToMinutes(t.FreeSlack as string),
      constraintType: num(t.ConstraintType),
      constraintDate: str(t.ConstraintDate),
      deadline: str(t.Deadline),
      calendarExternalUid: num(t.CalendarUID),
      customFields,
      rawBaselines: baselines,
      canonicalActivityKey: canonicalActivityKey(wbsCode, name),
    });

    for (const link of toArray(t.PredecessorLink as Any)) {
      const predUid = num((link as Any).PredecessorUID);
      if (predUid === null) continue;
      relationships.push({
        predecessorExternalUid: predUid,
        successorExternalUid: uid,
        type: mapRelationshipType(str((link as Any).Type)),
        rawType: str((link as Any).Type) ?? "",
        lagMinutes: tenthsOfMinuteToMinutes((link as Any).LinkLag as string),
        rawLagFormat: str((link as Any).LagFormat),
        crossProject: bool((link as Any).CrossProject),
      });
    }
  }

  const resources: ParsedResource[] = toArray((project.Resources as Any)?.Resource as Any)
    .filter((r: Any) => num(r.UID) !== null)
    .map((r: Any) => {
      const customFields: Record<string, string> = {};
      for (const ea of toArray(r.ExtendedAttribute as Any)) {
        const alias = aliasByFieldId.get(String((ea as Any).FieldID)) ?? String((ea as Any).FieldID);
        const val = str((ea as Any).Value);
        if (val !== null) customFields[alias] = val;
      }
      return { externalUid: num(r.UID) as number, name: str(r.Name), type: str(r.Type), group: str(r.Group), customFields };
    });

  const assignments: ParsedAssignment[] = toArray((project.Assignments as Any)?.Assignment as Any)
    .filter((a: Any) => num(a.TaskUID) !== null && num(a.ResourceUID) !== null)
    .map((a: Any) => ({
      activityExternalUid: num(a.TaskUID) as number,
      resourceExternalUid: num(a.ResourceUID) as number,
      units: num(a.Units),
      workMinutes: parseIsoDurationToMinutes(str(a.Work)),
    }));

  const calendars: ParsedCalendar[] = toArray((project.Calendars as Any)?.Calendar as Any)
    .filter((c: Any) => num(c.UID) !== null)
    .map((c: Any) => ({ externalUid: num(c.UID) as number, name: str(c.Name), raw: c }));

  return {
    header,
    fieldDefinitions,
    activities,
    relationships,
    resources,
    assignments,
    calendars,
    warnings,
    counts: {
      activities: activities.length,
      milestones: milestoneCount,
      relationships: relationships.length,
      resources: resources.length,
    },
  };
}
