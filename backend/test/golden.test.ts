import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAttendanceDataset } from "../src/engine/dataset.js";
import { carryoverFromEvents, inferMonthBounds } from "../src/engine/movement.js";
import { pyDateTime, fmtDateTime } from "../src/engine/core.js";
import { eventsFromMovementTable, fallbackNamesFromTable, readTable, rosterFromTable } from "../src/io/tables.js";

const FIX = new URL("../../fixtures/", import.meta.url);
const GOLD = new URL("../../golden/", import.meta.url);
const load = async (f: string) => readTable(readFileSync(new URL(f, FIX)), f);

async function run(current: string, previous: string | null) {
  const { roster } = rosterFromTable(await load("roster.xlsx"));
  const curTable = await load(current);
  const currentEvents = eventsFromMovementTable(curTable);
  const previousEvents = previous ? carryoverFromEvents(eventsFromMovementTable(await load(previous))) : new Map();
  const { year, month } = inferMonthBounds(currentEvents);
  return buildAttendanceDataset({ currentEvents, previousEvents, roster, year, month,
    fallbackNames: fallbackNamesFromTable(curTable) });
}

describe.each([
  ["august", "august_movement.xlsx", "july_movement.xlsx"],
  ["july", "july_movement.xlsx", null],
])("golden parity: %s", (name, current, previous) => {
  it("matches the Python engine row-for-row and issue-for-issue", async () => {
    const gold = JSON.parse(readFileSync(new URL(`${name}.json`, GOLD), "utf8"));
    const { rows, issues } = await run(current, previous);

    const mine = rows.map((r) => ({
      employee_id: r.employeeId, name: r.name, email: r.email, department: r.department,
      manager_name: r.managerName, manager_email: r.managerEmail, week: r.week,
      week_attended_days: r.weekAttendedDays, work_date: r.workDate,
      check_in: r.checkIn.toISOString().slice(0, 19), check_out: r.checkOut?.toISOString().slice(0, 19) ?? null,
      visit_hours: r.visitHours, daily_total_hours: r.dailyTotalHours, shift_label: r.shiftLabel,
      eligibility: r.eligibility, compliant: r.compliant, week_compliant: r.weekCompliant,
      month_compliant: r.monthCompliant, is_first_row_of_day_group: r.isFirstRowOfDayGroup,
      rows_in_day_group: r.rowsInDayGroup,
    }));
    expect(mine.length).toBe(gold.rows.length);
    // week_/month_compliant intentionally differ from the Python engine: only days >= 7h count toward the weekly rule.
    const skip = ({ week_compliant, month_compliant, ...rest }: Record<string, unknown>) => rest;
    expect(mine.map(skip)).toEqual(gold.rows.map(skip));

    const myIssues = issues.filter((i) => i.issueType !== "No roster match")
      .map((i) => [i.employeeId, i.issueType, i.at.toISOString().slice(0, 19), i.detail]).sort();
    expect(myIssues).toEqual(gold.issues);
  });
});
