import type { ActivityProcurement } from "@/lib/procurement/display";

export type RowStatus = "not_started" | "in_progress" | "complete";

export interface ScheduleRow {
  id: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
  canonicalScope: string | null;
  disciplineName: string | null;
  partnerName: string | null;
  atRisk: boolean;
  procurement: ActivityProcurement | null;
  type: string;
  isCritical: boolean;
  outlineLevel: number;
  plannedStart: string | null;
  plannedFinish: string | null;
  expectedStart: string | null;
  expectedFinish: string | null;
  driftDays: number;
  pushedByName: string | null;
  status: RowStatus;
  percentComplete: number | null;
  totalSlackDays: number | null;
  durationDays: number | null;
  customFields: Record<string, string>;
}
