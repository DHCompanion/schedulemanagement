import type { ActivityProcurement, AtRiskItem } from "@/lib/procurement/display";

export type RowStatus = "not_started" | "in_progress" | "complete";

export interface ScheduleRow {
  id: string;
  externalId: number | null;
  /** Stable MSP UID — the key push links (pushedByUid) reference. */
  externalUid: number;
  wbsCode: string | null;
  name: string;
  canonicalScope: string | null;
  disciplineName: string | null;
  partnerName: string | null;
  atRisk: boolean;
  /** The specific late procurement item behind the AT RISK tag, when known. */
  atRiskItem: AtRiskItem | null;
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
  /** The driver activity's UID when this activity was pushed by a predecessor. */
  pushedByUid: number | null;
  /** How many later activities this activity's slip pushes (0 when it drives none). */
  pushesCount: number;
  status: RowStatus;
  percentComplete: number | null;
  totalSlackDays: number | null;
  durationDays: number | null;
  customFields: Record<string, string>;
}
