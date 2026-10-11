import type { RosterEntry, ShiftWindow } from "./types.js";

export const GENERAL_SHIFT_LABEL = "9:00 AM - 6:30 PM";
export const GENERAL_SHIFT_WINDOW: ShiftWindow = {
  startMinutes: 9 * 60, endMinutes: 18 * 60 + 30, label: GENERAL_SHIFT_LABEL,
};
export const INFERRED_NIGHT_SHIFT: ShiftWindow = {
  startMinutes: 18 * 60, endMinutes: 6 * 60, label: "Unassigned (inferred overnight pattern)",
};

const TIME_TOKEN_RE = /(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i;

function parseTimeToken(token: string): number {
  const m = TIME_TOKEN_RE.exec(token);
  if (!m) throw new Error(`Unrecognised time token: ${JSON.stringify(token)}`);
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour === 12) hour = 0;
  if (m[3].toLowerCase() === "p") hour += 12;
  return hour * 60 + minute;
}

function minutesToLabel(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mins % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Parses '4:00 pm to 1:30 am' or '6:00 PM - 3:30 AM'. */
export function parseShiftTimingString(raw: string): ShiftWindow {
  const trimmed = raw.trim();
  const m = /\s*(?:to|-|–)\s*/i.exec(trimmed);
  if (!m) throw new Error(`Cannot split shift string into two times: ${JSON.stringify(raw)}`);
  const first = trimmed.slice(0, m.index);
  const second = trimmed.slice(m.index + m[0].length);
  const startMinutes = parseTimeToken(first);
  const endMinutes = parseTimeToken(second);
  return { startMinutes, endMinutes, label: `${minutesToLabel(startMinutes)} - ${minutesToLabel(endMinutes)}` };
}

/** One raw roster sheet row (first 12 columns), already read from xlsx/csv. */
export interface RawRosterRow {
  baseShift: unknown; emplid: unknown; name: unknown; department: unknown;
  email: unknown; manager: unknown; overrideShift: unknown;
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

export interface RosterResult {
  roster: Map<string, RosterEntry>;
  unresolvedManagers: string[];
}

export function buildRoster(rows: RawRosterRow[]): RosterResult {
  const roster = new Map<string, RosterEntry>();
  for (const r of rows) {
    if (r.emplid == null || r.emplid === "" || r.name == null || r.name === "") continue;
    const employeeId = String(Math.trunc(Number(r.emplid)));
    const shiftStr = clean(r.overrideShift) || clean(r.baseShift);
    let shift: ShiftWindow | null = null;
    if (shiftStr) {
      try { shift = parseShiftTimingString(shiftStr); } catch { shift = null; }
    }
    roster.set(employeeId, {
      employeeId, name: clean(r.name), email: clean(r.email).toLowerCase(),
      department: clean(r.department), managerName: clean(r.manager),
      managerEmail: "", shift,
    });
  }
  const nameToEmail = new Map<string, string>();
  for (const e of roster.values()) nameToEmail.set(e.name.trim().toLowerCase(), e.email);
  const unresolved = new Set<string>();
  for (const e of roster.values()) {
    if (!e.managerName) continue;
    const found = nameToEmail.get(e.managerName.trim().toLowerCase());
    if (found) e.managerEmail = found; else unresolved.add(e.managerName);
  }
  return { roster, unresolvedManagers: [...unresolved].sort() };
}
