/**
 * Works out Wednesday office attendance: days attended, rates, tiers (Perfect to Zero), search and totals.
 * Public holidays are not counted.
 */
import type { WednesdayData } from '../api';

/** Spec: each attended Wednesday is logged as an estimated 8.0 in-office hours. */
export const HOURS_PER_DAY = 8;
/** Org target: 75% of staff in office each Wednesday. */
export const TARGET_RATE = 0.75;

export interface WedEmployee {
  employeeId: string;
  name: string;
  flags: boolean[]; // aligned with the month's Wednesdays
  days: number;
  rate: number; // days / wednesdays, 0..1
}

export type TierName = 'Perfect' | 'High' | 'Moderate' | 'Low' | 'Zero';

export function tierOf(days: number, total: number): TierName {
  if (total > 0 && days >= total) return 'Perfect';
  if (days <= 0) return 'Zero';
  const r = days / total;
  return r >= 0.75 ? 'High' : r >= 0.5 ? 'Moderate' : 'Low';
}

/** One dropdown entry per possible day count, highest first: total..0. */
export function tierOptions(total: number) {
  return Array.from({ length: total + 1 }, (_, i) => {
    const days = total - i;
    const name = tierOf(days, total);
    return { days, label: name === 'Zero' ? `Zero Attendance (0/${total})` : `${name} (${days}/${total} Days)` };
  });
}

/** Wednesdays that count toward the policy (public holidays excluded). */
export const workingWednesdays = (data: WednesdayData) => data.wednesdays.filter((w) => !data.holidays.includes(w));

/** Flags/days/rate cover working Wednesdays only; public holidays are neither required nor counted. */
export function summarize(data: WednesdayData): WedEmployee[] {
  const working = workingWednesdays(data);
  const n = working.length;
  return data.employees.map((e) => {
    const flags = working.map((w) => e.attended[w] === true);
    const days = flags.filter(Boolean).length;
    return { employeeId: e.employeeId, name: e.name, flags, days, rate: n ? days / n : 0 };
  });
}

/** Free-text match on name or ID; days = null means all tiers. */
export function filterWed(emps: WedEmployee[], q: string, days: number | null): WedEmployee[] {
  const s = q.trim().toLowerCase();
  return emps.filter(
    (e) => (days === null || e.days === days) && (!s || e.name.toLowerCase().includes(s) || e.employeeId.toLowerCase().includes(s)),
  );
}

export interface WedStats {
  staff: number;
  perfect: number;
  avgDays: number;
  footfall: number;
  avgTurnout: number;
  perDate: number[]; // headcount per Wednesday
  distribution: number[]; // index = days attended, value = headcount
}

export function stats(emps: WedEmployee[], total: number): WedStats {
  const perDate = Array.from({ length: total }, (_, i) => emps.filter((e) => e.flags[i]).length);
  const footfall = emps.reduce((s, e) => s + e.days, 0);
  const distribution = Array.from({ length: total + 1 }, (_, d) => emps.filter((e) => e.days === d).length);
  return {
    staff: emps.length,
    perfect: total ? distribution[total] : 0,
    avgDays: emps.length ? footfall / emps.length : 0,
    footfall,
    avgTurnout: total ? footfall / total : 0,
    perDate,
    distribution,
  };
}

/** Index of the max / min turnout date (first on ties); -1 when there are no dates. */
export const peakIndex = (perDate: number[]) => (perDate.length ? perDate.indexOf(Math.max(...perDate)) : -1);
export const lowIndex = (perDate: number[]) => (perDate.length ? perDate.indexOf(Math.min(...perDate)) : -1);
