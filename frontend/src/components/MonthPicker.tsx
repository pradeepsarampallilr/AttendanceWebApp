/**
 * A month input: shows the chosen YYYY-MM and opens a small calendar with a year stepper and a grid of months.
 * When `available` is given, only those months can be chosen (the rest are greyed out).
 */
import { useEffect, useRef, useState } from 'react';

const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Props = {
  value: string;
  onChange: (ym: string) => void;
  available?: string[];
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  clearable?: boolean;
  ariaLabel?: string;
};

export default function MonthPicker({ value, onChange, available, disabled, id, placeholder = 'Select month', clearable, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(value.slice(0, 4)) || new Date().getFullYear());
  const [draft, setDraft] = useState(String(year));
  const root = useRef<HTMLDivElement>(null);
  const has = (ym: string) => !available || available.includes(ym);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  useEffect(() => setDraft(String(year)), [year]);

  const toggle = () => {
    if (!open) setYear(Number(value.slice(0, 4)) || year);
    setOpen(!open);
  };
  const jump = () => {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 1900 && n <= 2999) setYear(n);
    else setDraft(String(year));
  };

  return (
    <div ref={root} className="relative inline-flex items-center gap-1">
      <button id={id} type="button" className="field inline-flex items-center justify-between gap-2 text-left" disabled={disabled}
        aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <span className={value ? '' : 'text-slate-400'}>{value || placeholder}</span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4.5" width="14" height="12" rx="2" /><path d="M3 8.5h14M7 3v3M13 3v3" />
        </svg>
      </button>
      {clearable && value && (
        <button type="button" className="btn btn-secondary btn-icon" aria-label="Clear month" onClick={() => onChange('')}>×</button>
      )}
      {open && (
        <div role="dialog" aria-label="Choose month" className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button type="button" className="btn btn-secondary btn-sm !min-w-8 w-8 px-0" aria-label="Previous year" onClick={() => setYear(year - 1)}>‹</button>
            <input className="w-16 h-8 rounded border border-slate-300 text-center text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              inputMode="numeric" maxLength={4} aria-label="Year" value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))} onBlur={jump} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
            <button type="button" className="btn btn-secondary btn-sm !min-w-8 w-8 px-0" aria-label="Next year" onClick={() => setYear(year + 1)}>›</button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {NAMES.map((name, i) => {
              const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
              const on = ym === value;
              return (
                <button key={ym} type="button" disabled={!has(ym)} aria-pressed={on}
                  className={`h-9 rounded-md text-sm transition disabled:text-slate-300 disabled:cursor-not-allowed ${
                    on ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
                  }`}
                  onClick={() => { onChange(ym); setOpen(false); }}>
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
