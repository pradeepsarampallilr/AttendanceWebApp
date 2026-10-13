/**
 * Shared data shapes for shifts, roster entries, swipes, visits, issues and attendance rows.
 */
import type { DateStr } from "./core.js";

export interface ShiftWindow {
  startMinutes: number;
  endMinutes: number;
  label: string;
}
export const crossesMidnight = (s: ShiftWindow) => s.endMinutes <= s.startMinutes;

export interface RosterEntry {
  employeeId: string;
  name: string;
  email: string;
  department: string;
  managerName: string;
  managerEmail: string;
  shift: ShiftWindow | null;
}

export interface SwipeEvent {
  at: Date;
  kind: "in" | "out";
}
export type EventsByEmployee = Map<string, SwipeEvent[]>;

export interface Visit {
  employeeId: string;
  checkIn: Date;
  checkOut: Date | null;
  fromPreviousMonth: boolean;
}

export interface AuditIssue {
  employeeId: string;
  issueType: string;
  at: Date;
  detail: string;
}

export interface WorkDateGroup {
  employeeId: string;
  workDate: DateStr;
  visits: Visit[];
}

export interface AttendanceRow {
  employeeId: string;
  name: string;
  email: string;
  department: string;
  managerName: string;
  managerEmail: string;
  week: number;
  weekAttendedDays: number;
  workDate: DateStr;
  checkIn: Date;
  checkOut: Date | null;
  visitHours: number | null;
  dailyTotalHours: number | null;
  shiftLabel: string;
  eligibility: "Yes" | "No";
  compliant: "Yes" | "No" | "NA";
  weekCompliant: "Yes" | "No" | "NA";
  monthCompliant: "Yes" | "No" | "NA";
  isFirstRowOfDayGroup: boolean;
  rowsInDayGroup: number;
}
