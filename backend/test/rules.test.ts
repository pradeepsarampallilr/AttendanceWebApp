/** Checks the weekly / monthly office-day rules: calendar weeks, holidays, leaves and the Wednesday anchor. */
import { describe, expect, it } from "vitest";
import { calendarWeek, weekStart } from "../src/engine/core.js";
import { buildAttendanceDataset } from "../src/engine/dataset.js";
import { evaluateCompliance, evaluateEligibility, evaluateMonth, evaluateWeek } from "../src/engine/policy.js";
import type { EventsByEmployee, RosterEntry } from "../src/engine/types.js";

// Week of Mon 2026-08-03 .. Fri 2026-08-07 (Wed = 5th)
const week = (attended: string[], off: string[] = [], from = "2026-08-03", to = "2026-08-30") =>
  evaluateWeek("Yes", "2026-08-03", from, to, new Set(attended), new Set(off));

describe("calendar weeks", () => {
  it("start on Monday and use ISO numbers", () => {
    expect(weekStart("2026-08-05")).toBe("2026-08-03");
    expect(weekStart("2026-08-02")).toBe("2026-07-27");
    expect(calendarWeek("2026-08-03")).toBe(1); // Aug 1-2 is a weekend, so Aug 3 starts week 1
    expect(calendarWeek("2026-01-01")).toBe(1);
  });
});

describe("weekly requirement = min(3, 3 - holidays - leaves)", () => {
  it("is 3 with no off days and needs the Wednesday", () => {
    expect(week(["2026-08-03", "2026-08-04", "2026-08-06"])).toMatchObject({ required: 3, anchorOk: false, status: "No" });
    expect(week(["2026-08-03", "2026-08-05", "2026-08-06"]).status).toBe("Yes");
  });
  it("drops by one per holiday or leave", () => {
    expect(week(["2026-08-05", "2026-08-06"], ["2026-08-03"]).required).toBe(2);
    expect(week(["2026-08-05"], ["2026-08-03", "2026-08-04"]).required).toBe(1);
    expect(week([], ["2026-08-03", "2026-08-04", "2026-08-06"]).required).toBe(0);
  });
  it("skips a Wednesday that is a holiday or a leave day", () => {
    expect(week(["2026-08-03", "2026-08-04"], ["2026-08-05"])).toMatchObject({ required: 2, anchorOk: true, status: "Yes" });
  });
});

describe("partial weeks", () => {
  it("never asks for more days than the data window holds", () => {
    // Data starts on Thu the 6th: only Thu + Fri available
    expect(week(["2026-08-06", "2026-08-07"], [], "2026-08-06")).toMatchObject({ required: 2, anchorOk: true, status: "Yes" });
  });
});

describe("eligibility and month", () => {
  const shift = (s: number, e: number) => ({ startMinutes: s, endMinutes: e, label: "" });
  it("is NA without a shift, No for the general shift, Yes otherwise", () => {
    expect(evaluateEligibility(null)).toBe("NA");
    expect(evaluateEligibility(shift(540, 1080))).toBe("No");
    expect(evaluateEligibility(shift(540, 1110))).toBe("No");
    expect(evaluateEligibility(shift(600, 1140))).toBe("Yes");
    expect(evaluateCompliance("NA", 8)).toBe("NA");
    expect(evaluateCompliance("Yes", 6.99)).toBe("No");
    expect(evaluateCompliance("Yes", 7)).toBe("Yes");
  });
  it("is compliant only when every evaluated week is compliant", () => {
    const w = (status: "Yes" | "No" | "NA") => ({ weekStart: "", required: 3, attended: 3, anchor: "present" as const, anchorOk: true, status });
    expect(evaluateMonth("Yes", [w("Yes"), w("Yes"), w("NA")])).toBe("Yes");
    expect(evaluateMonth("Yes", [w("Yes"), w("No"), w("Yes")])).toBe("No");
    expect(evaluateMonth("NA", [w("Yes")])).toBe("NA");
  });
});

describe("dataset", () => {
  const emp: RosterEntry = { employeeId: "1", name: "A", email: "a@x.com", department: "Engineering", managerName: "", managerEmail: "",
    shift: { startMinutes: 600, endMinutes: 1140, label: "10:00 AM - 7:00 PM" } };
  const at = (d: string, hm: string) => new Date(`${d}T${hm}:00Z`);
  const day = (d: string) => [{ at: at(d, "10:00"), kind: "in" as const }, { at: at(d, "18:00"), kind: "out" as const }];
  const build = (cur: string[], prev: string[], extra: object = {}) => {
    const mk = (days: string[]): EventsByEmployee => new Map(days.length ? [["1", days.flatMap(day)]] : []);
    return buildAttendanceDataset({ currentEvents: mk(cur), previousEvents: mk(prev), roster: new Map([["1", emp]]),
      year: 2026, month: 8, fallbackNames: new Map(), ...extra });
  };

  it("counts the previous month's days in a week that straddles the boundary", () => {
    // Aug 1 is a Saturday, so the first week of August has no weekdays; use September instead.
    const mk = (days: string[]): EventsByEmployee => new Map(days.length ? [["1", days.flatMap(day)]] : []);
    const run = (prev: string[]) => buildAttendanceDataset({ currentEvents: mk(["2026-09-02", "2026-09-03"]), previousEvents: mk(prev),
      roster: new Map([["1", emp]]), year: 2026, month: 9, fallbackNames: new Map() });
    // Week Mon Aug 31: Mon (prev) + Wed + Thu = 3 days, Wednesday attended
    expect(run(["2026-08-31"]).rows.find((r) => r.workDate === "2026-09-02")?.weekCompliant).toBe("Yes");
    // No earlier data: only Tue-Fri of Sept 1-4 is known (4 weekdays) and 3 are needed
    expect(run([]).rows.find((r) => r.workDate === "2026-09-02")?.weekCompliant).toBe("No");
  });

  it("reports every week, also for staff with no swipes", () => {
    const r = buildAttendanceDataset({ currentEvents: new Map([["9", day("2026-08-04")]]), previousEvents: new Map(),
      roster: new Map([["1", emp], ["9", { ...emp, employeeId: "9", name: "Z" }]]), year: 2026, month: 8, fallbackNames: new Map() });
    const mine = r.weekly.filter((w) => w.employeeId === "1");
    expect(mine.map((w) => w.week)).toEqual([1, 2, 3, 4]); // Mondays Aug 3 .. Aug 24
    expect(mine.every((w) => w.status === "No" && w.required === 3 && w.anchor === "absent")).toBe(true);
  });

  it("is NA for staff without a shift", () => {
    const r = buildAttendanceDataset({ currentEvents: new Map([["1", day("2026-08-04")]]), previousEvents: new Map(),
      roster: new Map([["1", { ...emp, shift: null }]]), year: 2026, month: 8, fallbackNames: new Map() });
    expect(r.rows[0]).toMatchObject({ eligibility: "NA", compliant: "NA", weekCompliant: "NA", monthCompliant: "NA" });
  });

  it("rewards three 7h days including Wednesday, and lowers the bar for a leave", () => {
    const days = ["2026-08-03", "2026-08-05", "2026-08-06"];
    const r = build(days, []);
    expect(r.rows.every((x) => x.compliant === "Yes" && x.weekCompliant === "Yes")).toBe(true);
    const withLeave = build(["2026-08-05", "2026-08-06"], [], { leaves: new Map([["1", new Set(["2026-08-04"])]]) });
    expect(withLeave.rows[0].weekCompliant).toBe("Yes");
  });
});

describe("reporting lines", () => {
  it("lets every manager see everyone below them, and no one above", async () => {
    const { buildReportingLines } = await import("../src/engine/hierarchy.js");
    const lines = buildReportingLines([
      { employeeId: "x", name: "X", managerName: "" },
      { employeeId: "y", name: "Y", managerName: "x" },
      { employeeId: "z", name: "Z", managerName: "Y" },
    ]);
    const under = (m: string) => lines.filter((l) => l.managerId === m).map((l) => l.employeeId).sort();
    expect(under("x")).toEqual(["y", "z"]);
    expect(under("y")).toEqual(["z"]);
    expect(under("z")).toEqual([]);
    expect(lines.find((l) => l.managerId === "x" && l.employeeId === "z")?.depth).toBe(2);
  });
  it("survives a manager loop and ambiguous names", async () => {
    const { buildReportingLines } = await import("../src/engine/hierarchy.js");
    expect(buildReportingLines([
      { employeeId: "a", name: "A", managerName: "B" }, { employeeId: "b", name: "B", managerName: "A" },
    ]).length).toBe(2);
    expect(buildReportingLines([
      { employeeId: "a", name: "Sam", managerName: "" }, { employeeId: "b", name: "Sam", managerName: "" },
      { employeeId: "c", name: "C", managerName: "Sam" },
    ])).toEqual([]);
  });
});
