/**
 * A pop-up box that asks the user to confirm or cancel an action. Esc closes it.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';

export default function ConfirmModal({ title, children, confirmLabel, busyLabel = 'Working…', tone = 'danger', busy, onConfirm, onCancel }: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !busy && onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title"
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 id="confirm-title" className="font-semibold text-lg mb-2">{title}</h3>
        <div className="text-sm text-slate-600 space-y-2">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy} autoFocus>{busy ? busyLabel : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export type ConfirmOptions = { title: string; message: ReactNode; confirmLabel: string; tone?: 'danger' | 'primary' };

/** `const [ask, modal] = useConfirm();` render `{modal}`, then `ask({...}, () => doIt())` shows the box and runs doIt only on confirm. */
export function useConfirm() {
  const [pending, setPending] = useState<{ opts: ConfirmOptions; action: () => unknown } | null>(null);
  const cancel = useCallback(() => setPending(null), []);
  const ask = useCallback((opts: ConfirmOptions, action: () => unknown) => setPending({ opts, action }), []);
  const modal = pending && (
    <ConfirmModal title={pending.opts.title} confirmLabel={pending.opts.confirmLabel} tone={pending.opts.tone ?? 'primary'}
      onCancel={cancel} onConfirm={() => { const { action } = pending; setPending(null); action(); }}>
      {pending.opts.message}
    </ConfirmModal>
  );
  return [ask, modal] as const;
}
