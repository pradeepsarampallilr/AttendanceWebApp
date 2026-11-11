/**
 * HR and super admins change the rule settings the attendance engine uses (full-day hours, office days per week, anchor day...).
 * Saved values apply the next time a month is processed.
 */
import { useEffect, useState } from 'react';
import { settingsApi, type SettingRow } from '../api';
import { useAsync } from '../useAsync';
import { Loading, Notice, PageHeader, Toast } from '../components/dashboard/shared';
import { useConfirm } from '../components/ConfirmModal';
import { SettingsIcon } from '../components/Icons';

export default function ConfigPage() {
  const settings = useAsync(settingsApi.list, []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ask, modal] = useConfirm();
  const rows = settings.data ?? [];
  const reset = (list: SettingRow[]) => setDraft(Object.fromEntries(list.map((r) => [r.key, String(r.value)])));
  useEffect(() => reset(rows), [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = (r: SettingRow) => {
    const n = Number(draft[r.key]);
    return draft[r.key] !== '' && Number.isInteger(n) && n >= r.min && n <= r.max;
  };
  const dirty = rows.some((r) => draft[r.key] !== String(r.value));

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await settingsApi.save(Object.fromEntries(rows.map((r) => [r.key, Number(draft[r.key])])));
      reset(next);
      settings.reload();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={<SettingsIcon className="h-5 w-5" />} title="Configuration"
        sub="The numbers the attendance rules use. A change applies the next time a month is processed; months already processed keep their results until you process them again." />
      {error && <Toast tone="error" onClose={() => setError(null)}>{error}</Toast>}
      {saved && <Toast tone="success" onClose={() => setSaved(false)}>Settings saved. Process a month again to apply them to its results.</Toast>}
      {settings.error && <Notice tone="error" onClose={() => {}}>{settings.error}</Notice>}
      {settings.loading && <Loading />}
      {!settings.loading && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="px-3 py-2">Setting</th><th className="px-3 py-2">Value</th><th className="px-3 py-2">Allowed</th><th className="px-3 py-2">Default</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <label htmlFor={r.key} className="font-medium">{r.label}</label>
                    <div className="text-slate-500">{r.description}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.options ? (
                      <select id={r.key} className="field" value={draft[r.key] ?? ''} onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })}>
                        {r.options.map((name, i) => <option key={name} value={r.min + i}>{name}</option>)}
                      </select>
                    ) : (
                      <input id={r.key} type="number" step={1} min={r.min} max={r.max} className={`field w-24 ${valid(r) ? '' : '!border-red-400'}`}
                        value={draft[r.key] ?? ''} onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })} />
                    )}
                    <span className="ml-2 text-slate-500">{r.unit}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{r.options ? `${r.options[0]} to ${r.options[r.options.length - 1]}` : `${r.min} to ${r.max}`}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{r.options ? r.options[r.default - r.min] : r.default}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy || !dirty || !rows.every(valid)} onClick={() => ask({ title: 'Save changes?', confirmLabel: 'Save changes', message: 'These rule settings apply to attendance results when months are processed.' }, save)}>Save changes</button>
        <button className="btn btn-secondary" disabled={busy || !dirty} onClick={() => reset(rows)}>Discard</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => setDraft(Object.fromEntries(rows.map((r) => [r.key, String(r.default)])))}>Restore defaults</button>
      </div>
      {modal}
    </div>
  );
}
