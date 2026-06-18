import type { RelationshipType } from "./relationshipType";
export type { RelationshipType };

export type CanonicalActivityType = "task" | "milestone" | "summary" | "project_summary";

export interface ParsedProjectHeader {
  titleFromFile: string;
  externalProjectGuid: string | null;
  statusDate: string | null;
  projectStart: string | null;
  projectFinish: string | null;
  minutesPerDay: number;
  minutesPerWeek: number | null;
  daysPerMonth: number | null;
  defaultCalendarUid: number | null;
  rawProps: Record<string, string>;
}

export interface ParsedFieldDefinition {
  fieldId: string;
  fieldName: string;
  alias: string;
}

export interface ParsedActivity {
  externalUid: number;
  externalGuid: string | null;
  externalId: number | null;
  name: string;
  wbsCode: string | null;
  outlineNumber: string | null;
  outlineLevel: number;
  parentExternalUid: number | null;
  type: CanonicalActivityType;
  rawType: string | null;
  isMilestone: boolean;
  isSummary: boolean;
  isProjectSummary: boolean;
  isCritical: boolean;
  isActive: boolean;
  plannedStart: string | null;
  plannedFinish: string | null;
  earlyStart: string | null;
  earlyFinish: string | null;
  lateStart: string | null;
  lateFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  baselineStart: string | null;
  baselineFinish: string | null;
  baselineDurationMinutes: number | null;
  durationMinutes: number | null;
  durationDays: number | null;
  remainingDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  percentComplete: number | null;
  percentWorkComplete: number | null;
  totalSlackMinutes: number | null;
  freeSlackMinutes: number | null;
  constraintType: number | null;
  constraintDate: string | null;
  deadline: string | null;
  calendarExternalUid: number | null;
  customFields: Record<string, string>;
  rawBaselines: unknown[];
  canonicalActivityKey: string;
}

export interface ParsedRelationship {
  predecessorExternalUid: number;
  successorExternalUid: number;
  type: RelationshipType;
  rawType: string;
  lagMinutes: number | null;
  rawLagFormat: string | null;
  crossProject: boolean;
}

export interface ParsedResource {
  externalUid: number;
  name: string | null;
  type: string | null;
  group: string | null;
  customFields: Record<string, string>;
}

export interface ParsedAssignment {
  activityExternalUid: number;
  resourceExternalUid: number;
  units: number | null;
  workMinutes: number | null;
}

export interface ParsedCalendar {
  externalUid: number;
  name: string | null;
  raw: unknown;
}

export interface ParsedSchedule {
  header: ParsedProjectHeader;
  fieldDefinitions: ParsedFieldDefinition[];
  activities: ParsedActivity[];
  relationships: ParsedRelationship[];
  resources: ParsedResource[];
  assignments: ParsedAssignment[];
  calendars: ParsedCalendar[];
  warnings: string[];
  counts: { activities: number; milestones: number; relationships: number; resources: number };
}
