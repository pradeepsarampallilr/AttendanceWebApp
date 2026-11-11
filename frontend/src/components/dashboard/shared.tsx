/**
 * Small pieces used across dashboard pages: messages, loading and empty states, sortable table headers, pagers and date/hour formatting.
 */
import { useEffect, useRef, useState } from 'react';
import type { Tri } from '../../api';
import { BENCHMARK_HOURS } from '../../lib/attendance';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Weekday of a 'YYYY-MM-DD' string, computed in UTC so no time-zone shift can occur. */
export const dayName = (d: string) => DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()];
export const time = (ts: string | null) => (ts ? ts.replace('T', ' ').slice(0, 16) : '—');
export const hrs = (h: number | null) => (h === null ? '—' : h.toFixed(2));

const NOTICE_TONE = {
  error: 'border-red-200 bg-red-50 text-red-700',
  success: 'border-green-200 bg-green-50 text-green-800',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function Notice({ tone, onClose, className = '', children }: {
  tone: keyof typeof NOTICE_TONE; onClose: () => void; className?: string; children: React.ReactNode;
}) {
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={`text-sm border rounded p-2 flex items-start gap-2 ${NOTICE_TONE[tone]} ${className}`}>
      <span className="flex-1">{children}</span>
      <button aria-label="Dismiss" onClick={onClose} className="leading-none px-1 hover:bg-black/5 rounded">×</button>
    </div>
  );
}

/** Top-right popup message that dismisses itself after `timeout` ms, or sooner via the × button. */
export function Toast({ tone, onClose, timeout = 5000, children }: {
  tone: keyof typeof NOTICE_TONE; onClose: () => void; timeout?: number; children: React.ReactNode;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const t = setTimeout(() => close.current(), timeout);
    return () => clearTimeout(t);
  }, [timeout]);
  return (
    <div className="fixed top-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] toast-in">
      <Notice tone={tone} onClose={onClose} className="shadow-lg">{children}</Notice>
    </div>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 py-24 text-slate-500">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-700" />
      <span className="text-sm">{text}</span>
    </div>
  );
}

export function Badge({ hours }: { hours: number | null }) {
  if (hours === null) return <span className="text-slate-400">—</span>;
  const ok = hours >= BENCHMARK_HOURS;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
      {hours.toFixed(2)}h
    </span>
  );
}

const COMPLIANCE: Record<Tri, [string, string]> = {
  Yes: ['Compliant', 'bg-emerald-100 text-emerald-800'],
  No: ['Non-Compliant', 'bg-red-100 text-red-800'],
  NA: ['N/A', 'bg-slate-100 text-slate-600'],
};

export function ComplianceBadge({ emp }: { emp: { monthCompliant: Tri; weekStatus?: Tri } }) {
  const status = emp.weekStatus ?? emp.monthCompliant;
  const [label, cls] = COMPLIANCE[status];
  return <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cls}`}>{emp.weekStatus ? 'Week: ' : ''}{label}</span>;
}

const CARD_TONE = {
  brand: 'bg-brand-soft text-brand',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  blue: 'bg-sky-100 text-sky-700',
  slate: 'bg-slate-100 text-slate-600',
};

export function Card({ label, value, sub, icon, tone = 'brand' }: { label: string; value: React.ReactNode; sub?: string; icon?: React.ReactNode; tone?: keyof typeof CARD_TONE }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-2.5 shadow-sm">
      {icon && <span className={`shrink-0 rounded-full p-2 ${CARD_TONE[tone]}`}>{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="text-xl font-semibold leading-tight">{value}</div>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

/** Title block used at the top of every page so headings line up and look the same. */
export function PageHeader({ title, badge, sub, icon, aside }: { title: string; badge?: string; sub?: React.ReactNode; icon?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {icon && <span className="rounded-full bg-brand-soft text-brand p-2">{icon}</span>}
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold">{title}{badge && <span className="ml-2 align-middle text-xs bg-slate-200 rounded-full px-2 py-0.5">{badge}</span>}</h1>
        {sub && <p className="text-sm text-slate-500">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

/** Tab strip shared by the Dashboard and Anchor Day pages. */
export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void }) {
  return (
    <nav className="tabs">
      {tabs.map(([k, label]) => <button key={k} onClick={() => onChange(k)} className={`tab ${value === k ? 'tab-active' : ''}`}>{label}</button>)}
    </nav>
  );
}

export const Empty = ({ text = 'No rows match the current filters.' }: { text?: string }) => (
  <div className="p-8 text-center text-sm text-slate-500 bg-white border border-slate-200 rounded-lg">{text}</div>
);

export const th = 'px-3 py-2 text-left font-medium text-slate-600 bg-slate-50 whitespace-nowrap';
export const td = 'px-3 py-2 border-t border-slate-100 align-top';

export type SortDir = 'asc' | 'desc';
export function useSort<K extends string>(initial: K, dir: SortDir = 'asc') {
  const [state, set] = useState<{ key: K; dir: SortDir }>({ key: initial, dir });
  const toggle = (key: K) =>
    set((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const sort = <T,>(items: T[], get: (t: T, k: K) => string | number) =>
    [...items].sort((a, b) => {
      const x = get(a, state.key), y = get(b, state.key);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return state.dir === 'asc' ? c : -c;
    });
  return { ...state, toggle, sort };
}

export function SortTh<K extends string>({ k, sort, children }: { k: K; sort: ReturnType<typeof useSort<K>>; children: React.ReactNode }) {
  return (
    <th className={`${th} cursor-pointer select-none`} onClick={() => sort.toggle(k)}>
      {children}
      {sort.key === k && (sort.dir === 'asc' ? ' ▲' : ' ▼')}
    </th>
  );
}

/** Previous / next controls. `always` keeps them on screen even when everything fits on one page. */
export function Pager({ page, pages, onPage, always }: { page: number; pages: number; onPage: (p: number) => void; always?: boolean }) {
  const total = Math.max(pages, 1);
  const [draft, setDraft] = useState(String(page + 1));
  useEffect(() => setDraft(String(page + 1)), [page]);
  if (pages <= 1 && !always) return null;
  // Jump only to a whole number inside 1..total; anything else snaps back to the current page.
  const jump = () => {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 1 && n <= total) onPage(n - 1);
    else setDraft(String(page + 1));
  };
  return (
    <div className="flex items-center justify-end gap-2 text-sm mt-3">
      <button className="btn btn-secondary btn-sm" disabled={page <= 0} onClick={() => onPage(page - 1)}>Prev</button>
      <span className="text-slate-600 flex items-center gap-1">Page
        <input className="w-9 h-6 px-1 text-center text-sm rounded border border-slate-300 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50" maxLength={3} inputMode="numeric" aria-label="Go to page" value={draft} disabled={total <= 1}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))} onBlur={jump} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        of {total}</span>
      <button className="btn btn-secondary btn-sm" disabled={page >= pages - 1 || pages <= 1} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}
