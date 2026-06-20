// Pure, deterministic date-sanity checks over a schedule's leaf activities.
// No DB, no AI. Computed entirely at read time — imports are never mutated.

export type HealthSeverity = "error" | "warning";
export type HealthCheck = "out_of_envelope" | "future_actual" | "missing_dates" | "percent_contradiction";

export interface HealthActivity {
  id: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
  type: string;
  isActive: boolean;
  isMilestone: boolean;
  plannedStart: Date | null;
  plannedFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
}

export interface HealthIssue {
  activityId: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
  check: HealthCheck;
  severity: HealthSeverity;
  message: string;
  field?: string;
  value?: string | null;
}

export interface DateWindow {
  start: Date;
  end: Date;
}

export interface ImportEnvelope {
  projectStart: Date | null;
  projectFinish: Date | null;
}

export interface HealthSummary {
  errors: number;
  warnings: number;
  byCheck: Record<HealthCheck, number>;
}

const DAY_MS = 86400000;
const BUFFER_MS = 180 * DAY_MS;
// Minimum number of planned-date samples needed before we trust a derived window.
const MIN_DERIVE_SAMPLES = 8;
// Tukey outlier multiplier — dates beyond this many IQRs past the quartiles are suspect.
const IQR_MULTIPLIER = 3;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isLeafActive(a: HealthActivity): boolean {
  return a.type !== "summary" && a.type !== "project_summary" && a.isActive;
}

/** Linear-interpolated percentile of a sorted numeric array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Plausible date window for the schedule. Prefers the import's stored project
 * envelope (buffered); otherwise derives an outlier-robust window from the spread
 * of activity planned dates using Tukey fences, so a handful of mis-dated
 * activities cannot widen the window enough to hide themselves.
 */
export function computeEnvelope(activities: HealthActivity[], env: ImportEnvelope): DateWindow | null {
  if (env.projectStart && env.projectFinish) {
    return { start: new Date(env.projectStart.getTime() - BUFFER_MS), end: new Date(env.projectFinish.getTime() + BUFFER_MS) };
  }
  const samples: number[] = [];
  for (const a of activities) {
    if (a.plannedStart) samples.push(a.plannedStart.getTime());
    if (a.plannedFinish) samples.push(a.plannedFinish.getTime());
  }
  if (samples.length < MIN_DERIVE_SAMPLES) return null;
  samples.sort((x, y) => x - y);
  const q1 = percentile(samples, 0.25);
  const q3 = percentile(samples, 0.75);
  const iqr = q3 - q1;
  return {
    start: new Date(q1 - IQR_MULTIPLIER * iqr - BUFFER_MS),
    end: new Date(q3 + IQR_MULTIPLIER * iqr + BUFFER_MS),
  };
}

const ENVELOPE_FIELDS: { key: string; label: string; get: (a: HealthActivity) => Date | null }[] = [
  { key: "plannedStart", label: "Planned start", get: (a) => a.plannedStart },
  { key: "plannedFinish", label: "Planned finish", get: (a) => a.plannedFinish },
  { key: "actualStart", label: "Actual start", get: (a) => a.actualStart },
  { key: "actualFinish", label: "Actual finish", get: (a) => a.actualFinish },
];

function base(a: HealthActivity): Pick<HealthIssue, "activityId" | "externalId" | "wbsCode" | "name"> {
  return { activityId: a.id, externalId: a.externalId, wbsCode: a.wbsCode, name: a.name };
}

export function checkOutOfEnvelope(a: HealthActivity, window: DateWindow | null): HealthIssue[] {
  if (!window) return [];
  const offenders = ENVELOPE_FIELDS.map((f) => ({ f, date: f.get(a) })).filter(
    (o) => o.date !== null && (o.date.getTime() < window.start.getTime() || o.date.getTime() > window.end.getTime()),
  );
  if (offenders.length === 0) return [];
  const labels = offenders.map((o) => `${o.f.label} ${iso(o.date!)}`).join(", ");
  return [
    {
      ...base(a),
      check: "out_of_envelope",
      severity: "error",
      field: offenders[0].f.key,
      value: iso(offenders[0].date!),
      message: `${labels} falls outside the plausible schedule window (${iso(window.start)} to ${iso(window.end)}).`,
    },
  ];
}

export function checkFutureActuals(a: HealthActivity, asOfDate: Date): HealthIssue[] {
  const offenders: { label: string; key: string; date: Date }[] = [];
  if (a.actualStart && a.actualStart.getTime() > asOfDate.getTime())
    offenders.push({ label: "Actual start", key: "actualStart", date: a.actualStart });
  if (a.actualFinish && a.actualFinish.getTime() > asOfDate.getTime())
    offenders.push({ label: "Actual finish", key: "actualFinish", date: a.actualFinish });
  if (offenders.length === 0) return [];
  const labels = offenders.map((o) => `${o.label} ${iso(o.date)}`).join(", ");
  return [
    {
      ...base(a),
      check: "future_actual",
      severity: "error",
      field: offenders[0].key,
      value: iso(offenders[0].date),
      message: `${labels} is after the data date (${iso(asOfDate)}) — recorded progress cannot be in the future.`,
    },
  ];
}

export function checkMissingDates(a: HealthActivity): HealthIssue[] {
  const missing: string[] = [];
  if (!a.plannedStart) missing.push("planned start");
  if (!a.plannedFinish) missing.push("planned finish");
  if (missing.length === 0) return [];
  return [
    {
      ...base(a),
      check: "missing_dates",
      severity: "warning",
      field: !a.plannedStart ? "plannedStart" : "plannedFinish",
      value: null,
      message: `Missing ${missing.join(" and ")}.`,
    },
  ];
}

export function checkPercentContradictions(a: HealthActivity): HealthIssue[] {
  if (a.percentComplete === 100 && !a.actualFinish) {
    return [
      {
        ...base(a),
        check: "percent_contradiction",
        severity: "warning",
        field: "percentComplete",
        value: "100",
        message: "Marked 100% complete but has no actual finish date.",
      },
    ];
  }
  // Only flag when percent is explicitly recorded — null means "not entered", which is
  // common on imported completed tasks and would otherwise produce noisy false positives.
  if (a.actualFinish && a.percentComplete !== null && a.percentComplete < 100) {
    return [
      {
        ...base(a),
        check: "percent_contradiction",
        severity: "warning",
        field: "actualFinish",
        value: iso(a.actualFinish),
        message: `Has an actual finish date but percent complete is ${a.percentComplete}%.`,
      },
    ];
  }
  return [];
}

const SEVERITY_RANK: Record<HealthSeverity, number> = { error: 0, warning: 1 };

export function runHealthChecks(activities: HealthActivity[], env: ImportEnvelope, asOfDate: Date): HealthIssue[] {
  const leaves = activities.filter(isLeafActive);
  const window = computeEnvelope(leaves, env);
  const issues: HealthIssue[] = [];
  for (const a of leaves) {
    issues.push(
      ...checkOutOfEnvelope(a, window),
      ...checkFutureActuals(a, asOfDate),
      ...checkMissingDates(a),
      ...checkPercentContradictions(a),
    );
  }
  issues.sort((x, y) => {
    const s = SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity];
    if (s !== 0) return s;
    return (x.wbsCode ?? "").localeCompare(y.wbsCode ?? "", undefined, { numeric: true });
  });
  return issues;
}

export function summarizeHealth(issues: HealthIssue[]): HealthSummary {
  const byCheck: Record<HealthCheck, number> = {
    out_of_envelope: 0,
    future_actual: 0,
    missing_dates: 0,
    percent_contradiction: 0,
  };
  let errors = 0;
  let warnings = 0;
  for (const i of issues) {
    byCheck[i.check]++;
    if (i.severity === "error") errors++;
    else warnings++;
  }
  return { errors, warnings, byCheck };
}
