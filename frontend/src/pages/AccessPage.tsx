/**
 * HR and super admins manage who can sign in: search users, switch them active or deactivated, change roles and add HR users.
 * Managers and employees come from the latest roster upload.
 */
import { useEffect, useState } from 'react';
import { accessApi, type AppUserRow, type Role } from '../api';
import { useUser } from '../AuthGate';
import { useAsync } from '../useAsync';
import { Loading, Notice, PageHeader, Toast, Pager } from '../components/dashboard/shared';
import { UsersIcon } from '../components/Icons';
import { useConfirm } from '../components/ConfirmModal';

const ROLE_LABEL: Record<Role, string> = { superadmin: 'Super admin', hr: 'HR', manager: 'Manager', employee: 'Employee' };
const PAGE = 10;

export default function AccessPage() {
  const { role: myRole, email: myEmail } = useUser();
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(0);
  const users = useAsync(() => accessApi.list({ page: page + 1, pageSize: PAGE, q, role: roleFilter }), [page, q, roleFilter]);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [newRole, setNewRole] = useState<Role>('hr');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, modal] = useConfirm();
  useEffect(() => setPage(0), [q, roleFilter]);

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

  const list = users.data?.items ?? [];
  const pages = Math.ceil((users.data?.total ?? 0) / PAGE);
  const mayTouch = (u: AppUserRow) => (u.role !== 'superadmin' || myRole === 'superadmin' || !myRole) && u.email !== myEmail;
  return (
    <div className="space-y-4">
      <PageHeader icon={<UsersIcon className="h-5 w-5" />} title="User management"
        sub="Managers and employees get access from the latest roster upload; a manager sees everyone below them. Add HR users here and switch anyone off with Deactivate." />

      {error && <Toast tone="error" onClose={() => setError(null)}>{error}</Toast>}

      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          ask({ title: 'Add user?', confirmLabel: 'Add user', message: `Give ${email} ${ROLE_LABEL[newRole]} access to the app.` }, () =>
            run(async () => {
              await accessApi.add(email, username, newRole);
              setEmail('');
              setUsername('');
            }));
        }}
      >
        <input type="email" required className="field flex-1 min-w-56" placeholder="person@liveramp.com" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field flex-1 min-w-56" placeholder="Okta username (optional)" aria-label="Okta username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <select className="field" aria-label="Role for the new user" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
          <option value="hr">HR</option>
          {(myRole === 'superadmin' || !myRole) && <option value="superadmin">Super admin</option>}
        </select>
        <button className="btn btn-primary" disabled={busy}>Add user</button>
      </form>

      <div className="filters">
        <input className="field !flex-[3]" placeholder="Search name, email or username" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field" aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <span className="ml-auto text-sm text-slate-500">{users.data?.total ?? 0} users</span>
      </div>

      {users.loading && <Loading />}
      {users.error && <Notice tone="error" onClose={() => {}}>{users.error}</Notice>}
      {!users.loading && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Username</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Status</th><th /></tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.email} className={`border-t border-slate-100 ${u.isActive ? '' : 'bg-slate-50 text-slate-400'}`}>
                  <td className="px-3 py-2">{u.name || '—'}</td>
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">{u.username ?? '—'}</td>
                  <td className="px-3 py-2">
                    {mayTouch(u) ? (
                      <select className="field !h-8 py-0" aria-label={`Role of ${u.email}`} value={u.role} disabled={busy}
                        onChange={(e) => {
                          const role = e.target.value as Role;
                          ask({ title: 'Change role?', confirmLabel: 'Change role', message: `Change ${u.email} from ${ROLE_LABEL[u.role]} to ${ROLE_LABEL[role]}?` },
                            () => run(() => accessApi.update(u.email, { role })));
                        }}>
                        {(Object.keys(ROLE_LABEL) as Role[]).filter((r) => r !== 'superadmin' || myRole === 'superadmin' || !myRole).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : ROLE_LABEL[u.role]}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                      {u.isActive ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap space-x-2">
                    {mayTouch(u) && (
                      <button className={`btn btn-sm ${u.isActive ? 'btn-secondary' : 'btn-success'}`} disabled={busy}
                        onClick={() => ask({
                          title: `${u.isActive ? 'Deactivate' : 'Activate'} user?`, confirmLabel: u.isActive ? 'Deactivate' : 'Activate', tone: u.isActive ? 'danger' : 'primary',
                          message: u.isActive ? `${u.email} will no longer be able to sign in.` : `${u.email} will be able to sign in again.`,
                        }, () => run(() => accessApi.update(u.email, { isActive: !u.isActive })))}>
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                    {mayTouch(u) && (u.role === 'hr' || u.role === 'superadmin') && (
                      <button className="btn btn-danger btn-sm" disabled={busy}
                        onClick={() => ask({ title: 'Remove user?', confirmLabel: 'Remove', tone: 'danger', message: `${u.email} will be removed and lose access.` },
                          () => run(() => accessApi.remove(u.email)))}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No users found — upload a roster to add its managers and employees.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={pages} onPage={setPage} />
      {modal}
    </div>
  );
}
