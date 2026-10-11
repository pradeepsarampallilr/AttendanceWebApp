import { describe, expect, it } from "vitest";
import { applyAdjustments, type ApiRow } from "../src/services/adjustments.js";

const row = (o: Partial<ApiRow>): ApiRow => ({
  employeeId: "E1", name: "Emp One", workDate: "2026-08-03", checkIn: "2026-08-03T09:00:00", dailyTotalHours: 8,
  compliant: "Yes", eligibility: "Yes", week: 1, isFirstRowOfDayGroup: true, rowsInDayGroup: 1, ...o,
});
const adj = (o: object) => ({ employeeId: "E1", workDate: "2026-08-03", action: "edit" as const, hours: 5, note: null, ...o });

describe("applyAdjustments", () => {
  it("edit replaces the day total and recomputes per-day compliance", () => {
    const [r] = applyAdjustments([row({})], [adj({})]);
    expect(r).toMatchObject({ dailyTotalHours: 5, compliant: "No", adjustment: "edit" });
  });
  it("delete clears the total", () => {
    const [r] = applyAdjustments([row({})], [adj({ action: "delete", hours: null })]);
    expect(r).toMatchObject({ dailyTotalHours: null, compliant: "NA", adjustment: "delete" });
  });
  it("add synthesizes a sessionless row, sorted in date order", () => {
    const out = applyAdjustments([row({}), row({ workDate: "2026-08-10", week: 2 })], [adj({ action: "add", workDate: "2026-08-05", hours: 7.5 })]);
    expect(out.map((r) => r.workDate)).toEqual(["2026-08-03", "2026-08-05", "2026-08-10"]);
    expect(out[1]).toMatchObject({ dailyTotalHours: 7.5, checkIn: null, week: 1, rowsInDayGroup: 0, compliant: "Yes", adjustment: "add" });
  });
  it("ignores stale or unmatched adjustments and leaves input untouched", () => {
    const input = [row({})];
    const out = applyAdjustments(input, [adj({ action: "add" }), adj({ employeeId: "ZZ", action: "add", workDate: "2026-08-04" })]);
    expect(out).toHaveLength(1);
    expect(out[0].adjustment).toBeNull();
    expect(input[0].dailyTotalHours).toBe(8);
  });
});
