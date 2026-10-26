import { buildMspdi } from "@/lib/export/serializeMspdi";
import { toMspdiDate } from "@/lib/export/mspdiDate";
import type { Draft } from "@/lib/baseline/draftBaseline";

// lib/export edits the file a project was imported from; a draft has none, so
// this writes a minimal MSPDI from scratch. Elements follow the schema's order,
// which MS Project enforces. Tasks carry no Manual flag, so they import
// auto-scheduled and MS Project recomputes the dates from the links.

const LINK_TYPE = { FF: 0, FS: 1, SF: 2, SS: 3 } as const;
const MINUTES_PER_DAY = 480;

const weekDay = (dayType: number, working: boolean) => ({
  DayType: dayType,
  DayWorking: working ? 1 : 0,
  ...(working && { WorkingTimes: { WorkingTime: [{ FromTime: "08:00:00", ToTime: "12:00:00" }, { FromTime: "13:00:00", ToTime: "17:00:00" }] } }),
});

export function draftToMspdi(draft: Draft, title: string): string {
  const first = draft.activities[0];
  const last = draft.activities.at(-1)!;
  const tasks = [
    { UID: 0, ID: 0, Name: title, IsNull: 0, OutlineNumber: 0, OutlineLevel: 0, Start: toMspdiDate(first.start), Finish: toMspdiDate(last.finish), Summary: 1 },
    ...draft.activities.map((a, i) => ({
      UID: a.uid,
      ID: i + 1,
      Name: a.name,
      IsNull: 0,
      WBS: i + 1,
      OutlineNumber: i + 1,
      OutlineLevel: 1,
      Start: toMspdiDate(a.start),
      Finish: toMspdiDate(a.finish),
      Duration: `PT${a.days * 8}H0M0S`,
      DurationFormat: 7,
      Milestone: a.milestone ? 1 : 0,
      Summary: 0,
      ConstraintType: 0,
      PredecessorLink: a.preds.map((p) => ({ PredecessorUID: p.uid, Type: LINK_TYPE[p.type], CrossProject: 0, LinkLag: p.lagDays * MINUTES_PER_DAY * 10, LagFormat: 7 })),
    })),
  ];
  return buildMspdi({
    Project: {
      "@_xmlns": "http://schemas.microsoft.com/project",
      Name: `${title}.xml`,
      Title: title,
      ScheduleFromStart: 1,
      StartDate: toMspdiDate(first.start),
      FinishDate: toMspdiDate(last.finish),
      CalendarUID: 1,
      MinutesPerDay: MINUTES_PER_DAY,
      MinutesPerWeek: MINUTES_PER_DAY * 5,
      DaysPerMonth: 20,
      Calendars: { Calendar: { UID: 1, Name: "Standard", IsBaseCalendar: 1, BaseCalendarUID: -1, WeekDays: { WeekDay: [1, 2, 3, 4, 5, 6, 7].map((d) => weekDay(d, d !== 1 && d !== 7)) } } },
      Tasks: { Task: tasks },
    },
  });
}
