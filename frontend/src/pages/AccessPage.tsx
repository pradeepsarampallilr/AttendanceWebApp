/**
 * Super admins see who can sign in and can add or remove HR users here.
 */
import { useState } from 'react';
import { accessApi } from '../api';
import { useAsync } from '../useAsync';
import { Loading, Notice } from '../components/dashboard/shared';

const ROLE_LABEL = { superadmin: 'Super admin', hr: 'HR', manager: 'Manager' } as const;

export default function AccessPage() {
  const users = useAsync(accessApi.list, []);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      users.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const list = users.data ?? [];
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="font-semibold text-lg">Access</h1>
        <p className="text-sm text-slate-500">
          Managers get access automatically from the latest roster upload. Add HR users here (email, plus an optional Okta username); a sign-in matches on either. Everyone else is denied.
        </p>
      </div>

      {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await accessApi.addHr(email, username);
            setEmail('');
            setUsername('');
          });
        }}
      >
        <input
          type="email"
          required
          className="field flex-1"
          placeholder="hr.person@liveramp.com"
          aria-label="HR email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="field flex-1"
          placeholder="Okta username (optional)"
          aria-label="Okta username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button className="btn btn-primary" disabled={busy}>Add HR user</button>
      </form>

      {users.loading && <Loading />}
      {users.error && <Notice tone="error" onClose={() => {}}>{users.error}</Notice>}
      {!users.loading && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="px-3 py-2">Email</th><th className="px-3 py-2">Username</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th /></tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.email} className="border-t border-slate-100">
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2 text-slate-500">{u.username ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{u.name}</td>
                  <td className="px-3 py-2">{ROLE_LABEL[u.role]}</td>
                  <td className="px-3 py-2 text-right">
                    {u.role === 'hr' && (
                      <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => run(() => accessApi.remove(u.email))}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No users yet — upload a roster to add its managers.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
