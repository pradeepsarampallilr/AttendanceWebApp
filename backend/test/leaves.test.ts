import { describe, expect, it } from "vitest";
import { ValidationError, leavesFromTable } from "../src/io/tables.js";

describe("leavesFromTable", () => {
  it("reads by header name, normalises ids and dedupes", () => {
    const rows = [
      ["Employee ID", "Employee Name", "Leave Date", "Description"],
      ["101.0", "Asha", new Date("2026-08-12T00:00:00Z"), "Sick"],
      [101, "Asha", "2026-08-12", "Sick again"],
      ["", "", "", ""],
    ];
    expect(leavesFromTable(rows)).toEqual([
      { employeeId: "101", employeeName: "Asha", leaveDate: "2026-08-12", leaveDescription: "Sick again" }]);
  });
  it("rejects missing columns and bad dates", () => {
    expect(() => leavesFromTable([["Name"], ["x"]])).toThrow(ValidationError);
    expect(() => leavesFromTable([["Employee ID", "Date"], ["1", "12/08/2026"]])).toThrow(/row 2/);
  });
});
