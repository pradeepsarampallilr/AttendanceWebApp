/** Checks that holidays and leaves are handled correctly when counting working days and Wednesdays. */
import { describe, expect, it } from "vitest";
import { workingDaysInMonth } from "../src/engine/core.js";
import { evaluateWeekCompliance } from "../src/engine/policy.js";

// August 2026: Wed = 5, 12, 19, 26. Week 1 bucket = days 1-7 (Mon 3 .. Fri 7).
describe("public holidays in the engine", () => {
  it("drops holidays from the working-days count", () => {
    expect(workingDaysInMonth(2026, 8)).toBe(21);
    expect(workingDaysInMonth(2026, 8, new Set(["2026-08-12", "2026-08-13"]))).toBe(19);
  });

  it("skips a holiday Wednesday in the Wednesday check", () => {
    const attended = new Set(["2026-08-03", "2026-08-04", "2026-08-06"]); // no Wed 5th
    expect(evaluateWeekCompliance("Yes", 2026, 8, 1, attended)).toBe("No");
    expect(evaluateWeekCompliance("Yes", 2026, 8, 1, attended, new Set(["2026-08-05"]))).toBe("Yes");
  });

  it("lowers the 3-day bar when holidays leave fewer than 3 weekdays", () => {
    const hol = new Set(["2026-08-03", "2026-08-04", "2026-08-06"]); // 2 weekdays left (Wed, Fri)
    const attended = new Set(["2026-08-05", "2026-08-07"]);
    expect(evaluateWeekCompliance("Yes", 2026, 8, 1, attended)).toBe("No");
    expect(evaluateWeekCompliance("Yes", 2026, 8, 1, attended, hol)).toBe("Yes");
  });

  it("leaves ineligible staff as NA", () => {
    expect(evaluateWeekCompliance("No", 2026, 8, 1, new Set(), new Set(["2026-08-05"]))).toBe("NA");
  });
});

describe("employee leaves", () => {
  it("are subtracted from the denominator like holidays, without double-counting", () => {
    const off = new Set(["2026-08-12", "2026-08-13", "2026-08-12", "2026-08-15"]); // Sat ignored
    expect(workingDaysInMonth(2026, 8, off)).toBe(19);
  });
});
