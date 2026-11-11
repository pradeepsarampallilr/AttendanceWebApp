/**
 * Explains how attendance is calculated: the rules version, every policy in plain words, what changed, and the month's public holidays.
 */
import { api } from '../api';
import { useAsync } from '../useAsync';
import { longDateDay } from '../lib/dates';
import { useUser } from '../AuthGate';
import { Loading, PageHeader } from '../components/dashboard/shared';
import { InfoIcon } from '../components/Icons';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const firstName = (email: string | null) =>
  email ? email.split('@')[0].split(/[._-]/)[0].replace(/^./, (c) => c.toUpperCase()) : '';

export default function SummaryPage({ month }: { month: string }) {
  const { email } = useUser();
  const rules = useAsync(api.rules, []);
  const holidays = useAsync(() => (month ? api.holidays(month) : Promise.resolve([])), [month]);
  if (rules.loading) return <Loading />;
  if (rules.error || !rules.data) return <p role="alert" className="text-red-700">{rules.error ?? 'Could not load the rules.'}</p>;
  const r = rules.data;
  const card = 'bg-white border border-slate-200 rounded-lg p-4';
  return (
    <div className="space-y-4">
      <PageHeader icon={<InfoIcon className="h-5 w-5" />} title="Welcome!"
        sub={`${greeting()}${firstName(email) ? `, ${firstName(email)}` : ''}. Here is how every compliance number on this site is worked out.`}
        aside={<span className="rounded-full bg-brand px-3 py-1 text-xs font-medium text-white">Rules v{r.version}</span>} />

      <section className={card}>
        <h2 className="font-semibold mb-2">At a glance</h2>
        <dl className="divide-y divide-slate-100 text-sm">
          {r.summary.map((s) => (
            <div key={s.rule} className="grid grid-cols-[14rem_1fr] gap-3 py-2">
              <dt className="text-slate-500">{s.rule}</dt>
              <dd className="font-medium">{s.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        {r.sections.map((s) => (
          <section key={s.title} className={card}>
            <h2 className="font-semibold mb-2">{s.title}</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700">{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
          </section>
        ))}
      </div>

      <section className={card}>
        <h2 className="font-semibold mb-2">Public holidays{month && <span className="ml-2 text-xs bg-slate-200 rounded-full px-2 py-0.5">{month}</span>}</h2>
        {holidays.data?.length ? (
          <ul className="text-sm divide-y divide-slate-100">
            {holidays.data.map((h) => (
              <li key={h.date} className="py-1.5 flex gap-3"><span className="font-medium w-40">{longDateDay(h.date)}</span><span className="text-slate-600">{h.description || 'Public holiday'}</span></li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No public holidays set for this month.</p>}
      </section>

      <section className={card}>
        <h2 className="font-semibold mb-2">Version history</h2>
        <ol className="space-y-3">
          {r.changelog.map((c) => (
            <li key={c.version}>
              <div className="text-sm font-medium">v{c.version} <span className="text-slate-400 font-normal">· {c.date}</span></div>
              <ul className="list-disc pl-5 text-sm text-slate-600">{c.changes.map((x) => <li key={x}>{x}</li>)}</ul>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
