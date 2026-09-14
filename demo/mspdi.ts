import { addWorkingDays, workingDaysBetween } from "../lib/forecast/workingDays";

type Pred = { uid: number; type: "FS" | "SS"; lagDays: number };
type Activity = { uid: number; wbs: string; name: string; level: number; parentUid: number | null; summary: boolean; milestone: boolean; critical: boolean; startOffset: number; durationDays: number; predecessors: Pred[] };
type Story = { project: { name: string; number: string; startOffset: number; finishOffset: number }; activities: Activity[] };

const MIN_PER_DAY = 480;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function dayAt(anchor: Date, offset: number): Date { const d = new Date(anchor); d.setUTCDate(d.getUTCDate() + offset); return d; }
const workDays = (calendarDays: number) => Math.max(1, Math.round(calendarDays * 5 / 7));
const dur = (calendarDays: number) => `PT${workDays(calendarDays) * 8}H0M0S`;
const roll = (d: Date) => addWorkingDays(d, 0); // weekend -> next Monday

export function buildMspdi(story: Story, anchor: Date, statusOffset: number | null): string {
  const statusDate = statusOffset == null ? null : dayAt(anchor, statusOffset);
  const status = statusDate == null ? null : iso(statusDate);

  // Forward pass on the working calendar, mirroring computeForecast.forecastOne's
  // basis math so an on-track activity forecasts no push: each activity starts on
  // the later of its author offset (a start-no-earlier-than floor) and, per
  // predecessor, addWorkingDays(FS finish, 1+lag) / SS start + lag. The old
  // calendar placement misaligned every FS pair by a working day, and that drift
  // accumulated down chains into dozens of phantom pushes.
  const byUid = new Map(story.activities.map((a) => [a.uid, a]));
  const startD = new Map<number, Date>(), finishD = new Map<number, Date>();
  const place = (a: Activity): void => {
    if (startD.has(a.uid)) return;
    let s = roll(dayAt(anchor, a.startOffset));
    for (const p of a.predecessors) {
      const pred = byUid.get(p.uid); if (!pred) continue;
      place(pred);
      const basis = p.type === "SS" ? startD.get(p.uid)! : finishD.get(p.uid)!;
      const cand = addWorkingDays(basis, (p.type === "FS" ? 1 : 0) + p.lagDays);
      if (cand > s) s = cand;
    }
    startD.set(a.uid, s);
    finishD.set(a.uid, a.milestone ? s : addWorkingDays(s, workDays(a.durationDays)));
  };
  for (const a of story.activities) if (!a.summary) place(a);
  // Roll summary/project bars up to span their descendants.
  for (const a of story.activities) {
    if (a.summary) continue;
    const s = startD.get(a.uid)!, f = finishD.get(a.uid)!;
    for (let pid = a.parentUid; pid != null; pid = byUid.get(pid)?.parentUid ?? null) {
      if (!startD.has(pid) || s < startD.get(pid)!) startD.set(pid, s);
      if (!finishD.has(pid) || f > finishD.get(pid)!) finishD.set(pid, f);
    }
  }

  const tasks = story.activities.map((a) => {
    const sD = startD.get(a.uid)!, fD = finishD.get(a.uid)!;
    const start = iso(sD), finish = iso(fD);
    const leaf = !a.summary;
    let pct = 0, actualStart = "", actualFinish = "";
    if (statusDate && leaf) {
      if (fD <= statusDate) { pct = 100; actualStart = start; actualFinish = finish; }
      else if (sD < statusDate) {
        // % by working days elapsed, matching how the forecast projects remaining.
        const span = workingDaysBetween(sD, fD) || 1;
        pct = Math.min(99, Math.max(0, Math.round(100 * workingDaysBetween(sD, statusDate) / span)));
        actualStart = start;
      }
    }
    const preds = a.predecessors.map((p) => `<PredecessorLink><PredecessorUID>${p.uid}</PredecessorUID><Type>${p.type === "SS" ? 3 : 1}</Type><LinkLag>${p.lagDays * MIN_PER_DAY * 10}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join("");
    const baseline = status ? `<Baseline><Number>0</Number><Start>${start}T08:00:00</Start><Finish>${finish}T17:00:00</Finish><Duration>${a.milestone ? "PT0H0M0S" : dur(a.durationDays)}</Duration></Baseline>` : "";
    return `<Task><UID>${a.uid}</UID><ID>${a.uid}</ID><Name>${esc(a.name)}</Name><WBS>${a.wbs}</WBS><OutlineNumber>${a.wbs}</OutlineNumber><OutlineLevel>${a.level}</OutlineLevel>` +
      `<Type>1</Type><Milestone>${a.milestone ? 1 : 0}</Milestone><Summary>${a.summary ? 1 : 0}</Summary><Critical>${a.critical ? 1 : 0}</Critical><IsNull>0</IsNull>` +
      `<Start>${start}T08:00:00</Start><Finish>${finish}T17:00:00</Finish><Duration>${a.milestone ? "PT0H0M0S" : dur(a.durationDays)}</Duration>` +
      `<PercentComplete>${pct}</PercentComplete>${actualStart ? `<ActualStart>${actualStart}T08:00:00</ActualStart>` : ""}${actualFinish ? `<ActualFinish>${actualFinish}T17:00:00</ActualFinish>` : ""}` +
      `<TotalSlack>${a.critical ? 0 : 5 * MIN_PER_DAY * 10}</TotalSlack><CalendarUID>1</CalendarUID>${preds}${baseline}</Task>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
<Title>${esc(story.project.name)}</Title><GUID>DEMO-${story.project.number}</GUID>
<StartDate>${iso(new Date(Math.min(...[...startD.values()].map((d) => d.getTime()))))}T08:00:00</StartDate><FinishDate>${iso(new Date(Math.max(...[...finishD.values()].map((d) => d.getTime()))))}T17:00:00</FinishDate>
${status ? `<StatusDate>${status}T17:00:00</StatusDate>` : ""}
<MinutesPerDay>${MIN_PER_DAY}</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth><CalendarUID>1</CalendarUID>
<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar></Calendar></Calendars>
<Tasks>${tasks.join("\n")}</Tasks>
</Project>`;
}
