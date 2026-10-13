/**
 * A box where the user drags in or picks a CSV/Excel file to upload, with a link to the template.
 * Shows success or error messages.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { downloadFile } from '../api';
import { Notice } from './dashboard/shared';

const OK = /\.(csv|xlsx)$/i;

export default function UploadCard({
  title,
  hint,
  template,
  upload,
  onDone,
}: {
  title: string;
  hint: string;
  template: string;
  upload: (file: File) => Promise<ReactNode>;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReactNode>(null);

  async function send(file: File | undefined) {
    if (!file) return;
    setResult(null);
    if (!OK.test(file.name)) {
      setError('Only .csv and .xlsx files are accepted.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      setResult(await upload(file));
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <button
          type="button"
          onClick={() => downloadFile(`/api/templates/${template}`, `${template}-template.xlsx`).catch((e) => setError(e.message))}
          title="Download template (* = required column, others optional)"
          aria-label={`Download ${title} template`}
          className="shrink-0 rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 16h12" />
          </svg>
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-3">{hint}</p>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          send(e.dataTransfer.files[0]);
        }}
        className={`border-2 border-dashed rounded-md p-6 text-center text-sm cursor-pointer ${
          drag ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:bg-slate-50'
        }`}
      >
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-slate-700 animate-spin" />
            Uploading…
          </span>
        ) : (
          'Drop a .csv / .xlsx here, or click to choose'
        )}
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(e) => send(e.target.files?.[0])}
        />
      </div>
      {error && <Notice tone="error" className="mt-3" onClose={() => setError(null)}>{error}</Notice>}
      {result && (
        <Notice tone="success" className="mt-3" onClose={() => setResult(null)}>{result}</Notice>
      )}
    </div>
  );
}
