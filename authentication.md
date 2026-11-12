# Authentication & Access Control (Okta OIDC)

How sign-in and access control work in the Attendance Management System.

## 1. Overview

Two separate checks:

- **Authentication**: Okta proves who the user is (OIDC Authorization Code + PKCE).
- **Authorization**: the `app_users` table decides whether that person may use the app, and with which role.

Okta is mandatory. The backend refuses to start without `OKTA_ISSUER` and `OKTA_CLIENT_ID`, and there is no
development bypass.

```
 Browser (React SPA)                 Okta                         Express API            Postgres
 ───────────────────                 ────                         ───────────            ────────
 1. open app
 2. AuthGate: signed in? no ───────► /authorize (PKCE)
                                     user logs in (SSO/MFA)
 3. ◄──────── redirect /login/callback?code=…
 4. exchange code + verifier ──────► /token
    ◄──────── tokens (kept in sessionStorage)
 5. GET /api/me + Bearer token ────────────────────────────────────► verify JWT (Okta JWKS)
                                                                      look up identity ────► app_users
 6. ◄───── 200 {email, role, employeeId} | 403 Access denied / Account deactivated | 401
 7. app renders; every API call carries the Bearer token
```

## 2. Roles (`app_users` table)

| Role | How the row is created | What they can see and do |
|---|---|---|
| **superadmin** | Inserted directly in the database (or added by another superadmin on the Users page) | Everything HR can do, plus create, change and remove superadmin users |
| **hr** | Added on the **Users** page by HR or a superadmin | Whole dashboard; upload files, process and delete months; edit hours, anchor-day attendance, holidays and leaves; manage users; configuration; audit log; Excel templates and export |
| **manager** | Created automatically from the **roster upload** (anyone with at least one person reporting to them) | Read-only: their own attendance and everyone below them in the reporting chain, at any depth |
| **employee** | Created automatically from the **roster upload** | Read-only: their own attendance only |

Rules:

- Anyone without a row gets **403 Access denied**, even with a valid Okta login. A row with `is_active = false`
  gets **403 Account deactivated**.
- Roles are enforced on the server. Read endpoints are scoped per caller (`visibleEmployees` in
  [backend/src/services/access.ts](backend/src/services/access.ts)); every endpoint that changes data requires HR or
  superadmin (`requireWrite`, answering 403 *HR access required*).
- Changes take effect immediately: the API checks the table on every request.
- Emails are stored lower-case and matched exactly. A row may also carry an optional `username`; a sign-in matches on
  `email` **or** `username` (see section 4).

### How the roster feeds the table

Each roster upload (in the same transaction) calls `syncRosterUsers` in
[backend/src/services/users.ts](backend/src/services/users.ts):

- Every roster employee with a valid email gets a login: `manager` if anyone reports to them, otherwise `employee`,
  linked to their roster `employee_id`.
- `manager` and `employee` rows whose email is no longer in the roster are deleted.
- `hr` and `superadmin` rows keep their role. The `is_active` flag of every existing row is kept.
- A roster employee who already has an HR or superadmin row keeps that role; only `employee_id` is filled in.

### Reporting chain

Who a manager sees comes from the roster (`rosterTree` in `access.ts`): a person's manager is the roster row whose
email matches their manager email, otherwise the one row whose name matches their manager name. A manager name shared
by several people cannot be resolved, and manager loops are guarded against. The `reporting_lines` table is also
rebuilt on every roster upload from manager names.

## 3. Frontend

| File | Responsibility |
|---|---|
| [frontend/src/auth.ts](frontend/src/auth.ts) | Builds the Okta client (PKCE, scopes `openid profile email`, redirect `<origin>/login/callback`, tokens in `sessionStorage` with auto-renew). Sends the **access token** for a custom authorization server and the **ID token** for the org server. `signOut` clears tokens and ends the Okta session. |
| [frontend/src/AuthGate.tsx](frontend/src/AuthGate.tsx) | Wraps the whole app. Handles the callback, redirects to Okta when signed out, then calls `/api/me`. Screens: loading, ready, **Access denied** (403, lists the identifiers checked), **Sign-in failed** (401 or other errors). Exposes `useUser()` (`email`, `role`, `employeeId`) and `useCanEdit()`. |
| [frontend/src/api.ts](frontend/src/api.ts) | `authFetch` adds `Authorization: Bearer <token>`; on 401 it clears tokens and redirects to Okta (at most once a minute). `downloadFile` does authenticated downloads. `ApiError` carries the status, email, reason and identifiers. |
| [frontend/src/App.tsx](frontend/src/App.tsx) | Header shows the role. HR and superadmin see Dashboard (uploads), Audit Log, Users and Configuration; managers see Team; everyone sees Welcome and Attendance. Routes are hidden for roles that may not use them. |
| [frontend/src/pages/AccessPage.tsx](frontend/src/pages/AccessPage.tsx) | The Users page: search and filter users, add HR (or superadmin) users, activate or deactivate, change role, remove. |

The UI hides what a role cannot use, but the server is the real check.

Login flow in `AuthGate`:

1. URL is `/login/callback`: `handleRedirect()` swaps the code for tokens (using the saved PKCE verifier), then returns
   to the originally requested page.
2. Not authenticated: remember the current URL, `signInWithRedirect()`.
3. Authenticated: `GET /api/me`. 403 shows the Access denied screen; 401 shows Sign-in failed with a hint.

## 4. Backend

| File | Responsibility |
|---|---|
| [backend/src/auth.ts](backend/src/auth.ts) | `oktaAuth()` middleware on every `/api` route except `/api/health`. |
| [backend/src/services/users.ts](backend/src/services/users.ts) | `syncRosterUsers`, `findUser`, email helpers. |
| [backend/src/services/access.ts](backend/src/services/access.ts) | `requireWrite`, `visibleEmployees`, `teamLines`, `myEmployeeId`. |
| [backend/src/routes/admin.ts](backend/src/routes/admin.ts) | User management, audit log and settings (HR / superadmin only). |
| [backend/src/services/audit.ts](backend/src/services/audit.ts) | `logAction` writes who did what to `audit_logs`. |

Per-request steps in `oktaAuth`:

1. Take the `Authorization: Bearer` token; none gives **401** `Authentication required`.
2. Verify it with `jose` against Okta's JWKS: RS256 only, issuer and audience must match. Failure gives **401**
   `Invalid or expired token` with a `reason`.
3. On a custom authorization server, `cid` must equal `OKTA_CLIENT_ID`, so tokens issued to other apps in the org are
   refused (reason `wrong_client`).
4. Collect identifiers from the token: `preferred_username`, `email`, and `sub` when it looks like an email. Each is
   trimmed, lower-cased, limited to 320 printable characters. If `OKTA_IDENTITY_CLAIM` is set, only that claim is used.
5. `findUser` looks for a row with `email IN (ids) OR username IN (ids)`; the highest role wins if several match.
   No row: **403** `{error, email, identifiers}`.
6. Inactive row: **403** `Account deactivated`.
7. Otherwise set `req.userEmail`, `req.userRole` and `req.userEmployeeId`.

### User management API (HR / superadmin)

| Endpoint | Behaviour |
|---|---|
| `GET /api/admin/users` | Paged list; `?q=` matches name, email or username; `?role=` filters. |
| `POST /api/admin/users` | Add a user as `hr` (or `superadmin`, superadmin only). Email must be valid; optional `username` without spaces. Rejects an email or username that already has access. |
| `PATCH /api/admin/users/:email` | Change `isActive` and/or `role`. You cannot deactivate yourself or change your own role. |
| `DELETE /api/admin/users/:email` | Remove an HR or superadmin user only (roster users are deactivated instead). You cannot remove yourself. |
| `GET /api/admin/audit-logs` | Paged audit log, newest first; `?q=` searches actor, action, entity and detail. |

Only a superadmin may create, change or remove a superadmin. Every change is written to the audit log.

### Other protections ([backend/src/app.ts](backend/src/app.ts))

- Security headers on every response (CSP limiting `connect-src` to the app and Okta, `X-Frame-Options: DENY`,
  HSTS, `nosniff`, no referrer).
- CORS refuses other origins unless listed in `CORS_ORIGIN`.
- Rate limit per client address on `/api`: `RATE_LIMIT_PER_MIN` (default 600).
- JSON bodies limited to 1 MB; uploads limited to `MAX_UPLOAD_MB` (default 50 MB; roster, movement, transport) or 10 MB (leaves). `GET /api/limits` publishes them, so the Dashboard refuses an oversize file before sending it, and the server answers 400 "File is too large" if one still arrives.
- `createApp(auth)` accepts an injected auth handler only so tests can fix a user; production always uses Okta.

## 5. Configuration

`backend/.env`

```
OKTA_ISSUER=https://<org>.okta.com/oauth2/default   # required
OKTA_CLIENT_ID=<spa client id>                      # required, same value as the frontend
OKTA_AUDIENCE=api://default                         # custom server only (default api://default)
OKTA_IDENTITY_CLAIM=                                # optional: preferred_username | email | sub
CORS_ORIGIN=                                        # optional, comma separated
RATE_LIMIT_PER_MIN=600                              # optional
MAX_UPLOAD_MB=50                                    # optional, roster / movement / transport files
CLIENT_DIST=<path to frontend/dist>                 # optional, serves the built site
PORT=3000
DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
```

`frontend/.env` (read at **build time**; restart `npm run dev` or rebuild after changing, and check `.env.local`,
which overrides `.env`)

```
VITE_OKTA_ISSUER=https://<org>.okta.com/oauth2/default
VITE_OKTA_CLIENT_ID=<spa client id>
```

The SPA needs the redirect URI `<origin>/login/callback` registered in Okta, plus the sign-out redirect `<origin>`.

### Custom/default server vs org server

| `OKTA_ISSUER` looks like | Server type | Token the SPA sends | Backend verifies | Keys fetched from |
|---|---|---|---|---|
| `https://x.okta.com/oauth2/default` (or `/oauth2/<id>`) | custom / default | **access token** | `aud` = `OKTA_AUDIENCE`, `cid` = `OKTA_CLIENT_ID` | `<issuer>/v1/keys` |
| `https://x.okta.com` (no `/oauth2/...`) | **org** | **ID token** | `aud` = `OKTA_CLIENT_ID` | `<issuer>/oauth2/v1/keys` |

Both sides detect the type from the issuer. A custom/default server is the recommended setup for an API.

## 6. Creating the first superadmin

Nothing in the app creates the first superadmin; insert it directly in the database:

```sql
INSERT INTO app_users (email, name, role)
VALUES ('you@liveramp.com', 'Your Name', 'superadmin')
ON CONFLICT (email) DO UPDATE SET role = 'superadmin';
-- optional second identifier, if the Okta login differs from the email:
-- UPDATE app_users SET username = 'login@liveramp.com' WHERE email = 'you@liveramp.com';
```

Sign in with Okta. After that, superadmins and HR can add HR users on the Users page. A roster upload never removes
HR or superadmin rows.

## 7. Go-live and test checklist

1. Register the SPA in Okta (redirect `<origin>/login/callback`) and assign the people who should sign in.
2. Fill in the backend and frontend Okta values, insert your superadmin row, build the frontend, start the backend.
3. Open the app: redirected to Okta, then back in with your role in the header.
4. Sign in as someone not in `app_users`: Access denied screen.
5. `curl localhost:3000/api/months` with no token: **401**.
6. Upload a roster; a manager and an employee from it can sign in, and each sees only their own scope.
7. As HR, add another HR user on the Users page and confirm they can sign in; deactivate them and confirm **Account
   deactivated**.

Common failures: the audience or client id not matching, the issuer being the org server while a custom one was meant,
a redirect URI not registered in Okta, or the Okta login/email differing from the stored email (use `username`).
The backend log prints the exact reason for every rejected token.

## 8. Known limitations

1. **No non-Okta login.** If Okta is down or someone isn't assigned to the Okta app, they cannot sign in.
2. **Email matching is exact.** A roster email that differs from the Okta identity (an alias) gives Access denied
   unless the user's row has a matching `username`.
3. **Manager scope depends on roster quality.** An unresolvable or duplicated manager name means that person's reports
   are not linked to them.
4. **Token lifetime.** Silent renewal can be blocked by browser third-party-cookie settings; a 401 then triggers a fresh
   login redirect.
5. **Tokens live in `sessionStorage`** (cleared when the tab closes), the usual SPA trade-off.
6. **The built frontend is served without auth** (only `/api` is protected); it contains no data.
7. **`/api/health` is public** by design (load balancers).
8. **The first superadmin is created by hand in the database;** restrict database write access.
9. **The rate limiter is in memory,** so it is per server process.

## 9. Tests

- [backend/test/auth.test.ts](backend/test/auth.test.ts): startup refuses without `OKTA_ISSUER` / `OKTA_CLIENT_ID`,
  the old bypass flag has no effect, invalid `OKTA_IDENTITY_CLAIM` is rejected, 401 without or with a bad token.
- [backend/test/manager.test.ts](backend/test/manager.test.ts) and
  [backend/test/security.test.ts](backend/test/security.test.ts): role scoping and request protections.
- [backend/test/upload-limit.test.ts](backend/test/upload-limit.test.ts): oversize files (declared and chunked, slow
  uploads) get a 400 naming the limit, and `/api/limits` reports it.
- [backend/test/api.test.ts](backend/test/api.test.ts): roster upload creating users, user management. Needs local
  Postgres.

Not covered: a real signed Okta token, which needs an Okta tenant or a test signing key.
