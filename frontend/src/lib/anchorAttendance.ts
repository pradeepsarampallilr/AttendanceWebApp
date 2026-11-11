/**
 * Works out anchor-day office attendance: days attended, rates, tiers (Perfect to Zero), search and totals.
 * Public holidays are not counted.
 */
import type { AnchorDayData } from '../api';

/** Spec: each attended anchor day is logged as an estimated 8.0 in-office hours. */
export const HOURS_PER_DAY = 8;

export interface AnchorEmployee {
  employeeId: string;
  name: string;
  email: string;
  department: string;
  shift: string | null;
  flags: boolean[]; // aligned with the month's anchor days
  days: number;
  rate: number; // days / anchor days, 0..1
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
    return { days, label: `${days}/${total} Days` };
  });
}

/** Anchor days that count toward the policy (public holidays excluded). */
export const workingDates = (data: AnchorDayData) => data.dates.filter((w) => !data.holidays.includes(w));

/** Flags/days/rate cover working anchor days only; public holidays are neither required nor counted. */
export function summarize(data: AnchorDayData): AnchorEmployee[] {
  const working = workingDates(data);
  const n = working.length;
  return data.employees.map((e) => {
    const flags = working.map((w) => e.attended[w] === true);
    const days = flags.filter(Boolean).length;
    return { employeeId: e.employeeId, name: e.name, email: e.email, department: e.department, shift: e.shift, flags, days, rate: n ? days / n : 0 };
  });
}

/** Free-text match on name or ID; days = null means all tiers. */
export function filterAnchor(emps: AnchorEmployee[], q: string, days: number | null): AnchorEmployee[] {
  const s = q.trim().toLowerCase();
  return emps.filter(
    (e) => (days === null || e.days === days) && (!s || e.name.toLowerCase().includes(s) || e.employeeId.toLowerCase().includes(s)),
  );
}

export interface AnchorStats {
  staff: number;
  perfect: number;
  avgDays: number;
  footfall: number;
  avgTurnout: number;
  perDate: number[]; // headcount per anchor day
  distribution: number[]; // index = days attended, value = headcount
}

export function stats(emps: AnchorEmployee[], total: number): AnchorStats {
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
