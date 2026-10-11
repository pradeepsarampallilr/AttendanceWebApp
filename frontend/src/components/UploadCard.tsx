import { useRef, useState } from 'react';
import { Notice } from './dashboard/shared';
import { api, type UploadKind, type UploadResult } from '../api';

const OK = /\.(csv|xlsx)$/i;

export default function UploadCard({
  kind,
  title,
  hint,
  onDone,
}: {
  kind: UploadKind;
  title: string;
  hint: string;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

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
      setResult(await api.upload(kind, file));
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
      <h2 className="font-semibold">{title}</h2>
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
        <Notice tone="success" className="mt-3" onClose={() => setResult(null)}>
          Uploaded <b>{result.filename}</b>:{' '}
          {result.kind !== 'movement'
            ? `${result.employees} employees`
            : `${result.month?.slice(0, 7)} — ${result.events} events`}
        </Notice>
      )}
    </div>
  );
}
