/** The rules the engine applies, as data, so the Summary page always shows what the code really uses. */
import { fmtWeekday, settings } from "./core.js";

export const RULES_VERSION = "2.0.0";

export const CHANGELOG = [
  { version: "2.0.0", date: "2026-11-11", changes: [
    "Weeks are real calendar weeks (Monday to Sunday, ISO numbering); a week that began last month is checked from its Monday.",
    "Weekly requirement is min(3, 3 - public holidays - leaves); the monthly requirement is the sum of the weekly ones.",
    "Wednesday is the anchor day, skipped when it is a public holiday or the employee's leave.",
    "Staff with no shift in the roster are not evaluated (eligibility and compliance NA).",
    "Roles: superadmin, HR, manager (sees everyone below them), employee (sees only themselves).",
  ] },
  { version: "1.1.0", date: "2026-08-20", changes: ["Employee leaves added; compliance uses leaves like public holidays."] },
  { version: "1.0.0", date: "2026-08-01", changes: ["First version: 7-hour day, fixed 7-day week blocks, Okta sign-in."] },
];

/** Built on each request, so it shows the values currently configured. */
export const getRules = () => {
  const { compliantMinHours: hours, weeklyOfficeDays: days, dayAttributionBufferMin, maxShiftHours } = settings;
  const anchorDay = fmtWeekday(`2026-11-${String(2 + settings.anchorWeekday).padStart(2, "0")}`); // 2026-11-02 is a Monday
  return {
  version: RULES_VERSION,
  anchorDay,
  summary: [
    { rule: "Full-day threshold", value: `${hours} hours in the office` },
    { rule: "Required office days per week", value: `min(${days}, ${days} - public holidays - leaves)` },
    { rule: "Anchor day", value: `${anchorDay} of every week (not checked on a public holiday or the employee's leave)` },
    { rule: "Month target", value: "Office days attended >= the sum of every week's requirement" },
    { rule: "General shift", value: "9:00 AM start, 6:00-6:30 PM end: eligibility No, compliance NA" },
    { rule: "No shift in the roster", value: "Eligibility NA, compliance NA" },
    { rule: "Check-in / check-out buffer", value: `${dayAttributionBufferMin} minutes around a shift when assigning the work day` },
    { rule: "Longest shift window", value: `${maxShiftHours} hours between a check-in and its checkout` },
    { rule: "Weeks", value: "Calendar weeks, Monday to Sunday (ISO week numbers)" },
  ],
  sections: [
    { title: "Eligibility", points: [
      "Shift in the roster is 9:00 AM to 6:00/6:30 PM (general shift): not covered, shown as No; all compliance is NA.",
      "No shift in the roster: shown as NA; all compliance is NA.",
      "Any other shift: covered, shown as Yes.",
    ] },
    { title: "Daily compliance", points: [
      `A day is compliant when the employee was in the office for at least ${hours} hours in total (all visits that day added up).`,
      "A day with only an open visit (no checkout) has no total and is NA.",
    ] },
    { title: "Weekly compliance", points: [
      "A week runs Monday to Sunday. The first week of a month that started last month is checked from its Monday using last month's swipes when they exist; otherwise only from the 1st, and the requirement never exceeds the working weekdays available.",
      `Required days = min(${days}, ${days} - public holidays - leave days in that week), counting weekdays only.`,
      `The ${anchorDay} must be a ${hours}-hour day, unless it is a public holiday or the employee's leave.`,
      `The week is Yes when the ${anchorDay} check passes and ${hours}-hour days >= required days.`,
    ] },
    { title: "Monthly compliance", points: [
      `Sum the required days of every calendar week in the month and the month is Yes when the ${hours}-hour days attended reach that sum.`,
    ] },
    { title: "Swipes", points: [
      `A check-in pairs with the next checkout on the same or next day within ${maxShiftHours} hours. Otherwise it is logged as an audit issue.`,
      `Night shifts: a check-in after midnight, up to the shift end plus ${dayAttributionBufferMin} minutes, belongs to the previous day.`,
      "The last day of the file is skipped (its checkouts may be in the next file) and logged.",
    ] },
    { title: "Access", points: [
      "Superadmin: everything HR can do, plus user management.",
      `HR: whole dashboard, ${anchorDay} page, edits, audit log, uploads, holidays, user management.`,
      "Manager: attendance of everyone who reports to them, directly or through other managers.",
      "Employee: only their own attendance.",
    ] },
  ],
  changelog: CHANGELOG,
  };
};
