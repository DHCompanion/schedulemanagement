type Pred = { uid: number; type: "FS" | "SS"; lagDays: number };
type Activity = { uid: number; wbs: string; name: string; level: number; parentUid: number | null; summary: boolean; milestone: boolean; critical: boolean; startOffset: number; durationDays: number; predecessors: Pred[] };
type Story = { project: { name: string; number: string; startOffset: number; finishOffset: number }; activities: Activity[] };

const MIN_PER_DAY = 480;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function dayAt(anchor: Date, offset: number): Date { const d = new Date(anchor); d.setUTCDate(d.getUTCDate() + offset); return d; }
const workDays = (calendarDays: number) => Math.max(1, Math.round(calendarDays * 5 / 7));
const dur = (calendarDays: number) => `PT${workDays(calendarDays) * 8}H0M0S`;

export function buildMspdi(story: Story, anchor: Date, statusOffset: number | null): string {
  const status = statusOffset == null ? null : iso(dayAt(anchor, statusOffset));
  const tasks = story.activities.map((a) => {
    const start = iso(dayAt(anchor, a.startOffset)), finish = iso(dayAt(anchor, a.startOffset + a.durationDays));
    const leaf = !a.summary;
    let pct = 0, actualStart = "", actualFinish = "";
    if (status && leaf) {
      if (finish <= status) { pct = 100; actualStart = start; actualFinish = finish; }
      else if (start < status) { pct = Math.round(100 * (Date.parse(status) - Date.parse(start)) / Math.max(1, Date.parse(finish) - Date.parse(start))); actualStart = start; }
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
<StartDate>${iso(dayAt(anchor, story.project.startOffset))}T08:00:00</StartDate><FinishDate>${iso(dayAt(anchor, story.project.finishOffset))}T17:00:00</FinishDate>
${status ? `<StatusDate>${status}T17:00:00</StatusDate>` : ""}
<MinutesPerDay>${MIN_PER_DAY}</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth><CalendarUID>1</CalendarUID>
<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar></Calendar></Calendars>
<Tasks>${tasks.join("\n")}</Tasks>
</Project>`;
}
