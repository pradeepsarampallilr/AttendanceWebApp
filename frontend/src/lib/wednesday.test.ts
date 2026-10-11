import { describe, expect, it } from 'vitest';
import type { WednesdayData } from '../api';
import { filterWed, lowIndex, peakIndex, stats, summarize, tierOf, tierOptions } from './wednesday';

const W = ['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26'];
const emp = (id: string, name: string, bits: number[]) => ({
  employeeId: id, name, attended: Object.fromEntries(W.map((w, i) => [w, bits[i] === 1])),
});
const data: WednesdayData = {
  wednesdays: W,
  holidays: [],
  employees: [emp('A1', 'Alpha Test', [1, 1, 1, 1]), emp('B2', 'Beta Test', [1, 1, 0, 0]), emp('C3', 'Gamma Test', [0, 0, 0, 0]), emp('D4', 'Delta Test', [1, 0, 1, 1])],
};

describe('wednesday', () => {
  const all = summarize(data);
  it('counts days and rates', () => {
    expect(all.map((e) => e.days)).toEqual([4, 2, 0, 3]);
    expect(all[3].rate).toBe(0.75);
  });
  it('tiers for 4 and 5 Wednesdays', () => {
    expect(tierOptions(4).map((o) => o.label)).toEqual(['4/4 Days)', '(3/4 Days)', '(2/4 Days)', '(1/4 Days)', '(0/4)']);
    expect(tierOptions(5)).toHaveLength(6);
    expect(tierOf(5, 5)).toBe('Perfect');
  });
  it('filters by search and tier', () => {
    expect(filterWed(all, 'beta', null).map((e) => e.employeeId)).toEqual(['B2']);
    expect(filterWed(all, 'c3', null)).toHaveLength(1);
    expect(filterWed(all, '', 3).map((e) => e.employeeId)).toEqual(['D4']);
    expect(filterWed(all, 'alpha', 3)).toHaveLength(0);
  });
  it('aggregates', () => {
    const s = stats(all, 4);
    expect(s).toMatchObject({ staff: 4, perfect: 1, footfall: 9, avgDays: 2.25, avgTurnout: 2.25 });
    expect(s.perDate).toEqual([3, 2, 2, 2]);
    expect(s.distribution).toEqual([1, 0, 1, 1, 1]);
    expect(peakIndex(s.perDate)).toBe(0);
    expect(lowIndex(s.perDate)).toBe(1);
  });
  it('handles empty', () => {
    const s = stats([], 0);
    expect(s.avgDays).toBe(0);
    expect(peakIndex(s.perDate)).toBe(-1);
  });
});

describe('wednesday holidays', () => {
  it('excludes holiday Wednesdays from days and totals', () => {
    const h: WednesdayData = { ...data, holidays: ['2026-08-12'] };
    const e = summarize(h);
    expect(e[0].flags).toHaveLength(3);
    expect(e.map((x) => x.days)).toEqual([3, 1, 0, 3]);
  });
});
