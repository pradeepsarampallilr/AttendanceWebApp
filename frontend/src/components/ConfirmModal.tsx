import { useEffect, type ReactNode } from 'react';

export default function ConfirmModal({ title, children, confirmLabel, busy, onConfirm, onCancel }: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
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
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>{busy ? 'Deleting…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
