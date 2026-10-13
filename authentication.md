# Authentication & Access Control (Okta OIDC)

How sign-in and access control work in the Attendance Management System. For the checklist to hand to the Okta team,
see [OKTA_INTEGRATION.md](OKTA_INTEGRATION.md).


## 1. Overview

Two separate checks:
- **Authentication**: Okta proves who the user is (OIDC Authorization Code + PKCE).
- **Authorization**: our `app_users` table decides whether that person may use the app.

```
 Browser (React SPA)                 Okta                         Express API            Postgres
 ───────────────────                 ────                         ───────────            ────────
 1. open app
 2. AuthGate: signed in? no ───────► /authorize (PKCE)
                                     user logs in (SSO/MFA)
 3. ◄──────── redirect /login/callback?code=…
 4. exchange code + verifier ──────► /token
    ◄──────── access token + id token
    (kept in sessionStorage)
 5. GET /api/me + Bearer token ────────────────────────────────────► verify JWT (Okta JWKS)
                                                                      look up email ───────► app_users
 6. ◄───────────── 200 {email, role}  |  403 Access denied  |  401
 7. app renders; every API call carries the Bearer token
```

## 2. Who is allowed (`app_users` table)

| Role | How they get in | Can do |
|---|---|---|
| **superadmin** | A row you insert directly in the database | Everything, plus add/remove HR users |
| **manager** | Appears as a manager email in the latest **roster upload** | Use the app |
| **hr** | Added by the superadmin on the **Access** page | Use the app |

- Anyone not in the table gets **403 Access denied**, even with a valid Okta login.
- A roster upload replaces all `manager` rows with the distinct, normalised manager emails from that file (same
  transaction as the upload). A manager who disappears from the roster loses access on the next upload.
- HR and superadmin rows are never touched by a roster upload.
- Emails are stored lower-case and matched exactly.
- Changes take effect immediately: the API checks the table on every request.

## 3. Frontend

| File | Responsibility |
|---|---|
| [frontend/src/auth.ts](frontend/src/auth.ts) | Builds the Okta client (PKCE, scopes `openid profile email`, redirect `<origin>/login/callback`, tokens in `sessionStorage` with auto-renew). `null` when Okta isn't configured; throws a clear error if placeholders (`<...>`) are left in. |
| [frontend/src/AuthGate.tsx](frontend/src/AuthGate.tsx) | Wraps the whole app. Handles the callback, starts the Okta redirect if signed out, then calls `/api/me`. Screens: loading, ready, **Access denied** (403), **Sign-in failed**. Exposes `useUser()` (`email`, `role`). |
| [frontend/src/api.ts](frontend/src/api.ts) | `authFetch` adds `Authorization: Bearer <token>`; on 401 it clears tokens and redirects to Okta. `downloadFile` does authenticated downloads (plain `<a href>` can't send headers). `ApiError` carries the HTTP status. |
| [frontend/src/App.tsx](frontend/src/App.tsx) | Header shows email, role badge and Sign out (when Okta is on). The **Access** nav link and route appear only for the superadmin. |
| [frontend/src/pages/AccessPage.tsx](frontend/src/pages/AccessPage.tsx) | Superadmin screen: list users, add or remove HR users. Managers are read-only (they follow the roster). |

Login flow in `AuthGate`:
1. URL is `/login/callback` → `handleRedirect()` swaps the code for tokens (using the saved PKCE verifier), then returns
   to the originally requested page.
2. Not authenticated → remember the current URL, `signInWithRedirect()`.
3. Authenticated → `GET /api/me`. 403 shows the Access denied screen with the refused email.

## 4. Backend

| File | Responsibility |
|---|---|
| [backend/src/auth.ts](backend/src/auth.ts) | Middleware on all `/api` routes except `/api/health`. |
| [backend/src/services/users.ts](backend/src/services/users.ts) | `syncManagers` (roster → managers), `roleOf`, email helpers. |
| [backend/src/routes/admin.ts](backend/src/routes/admin.ts) | `GET/POST /api/admin/users`, `DELETE /api/admin/users/:email`. Superadmin only; add HR only; rejects duplicates and invalid emails. |
| [backend/src/models/AppUser.ts](backend/src/models/AppUser.ts), [migration 1700000000002](backend/src/migrations/1700000000002-CreateAppUsers.ts) | The `app_users` table. The migration also backfills managers from an already-uploaded roster. |
| [backend/src/app.ts](backend/src/app.ts) | Wires the middleware, `/api/me` (returns `{email, role}`) and `/api/admin`. |
| [backend/src/routes/uploads.ts](backend/src/routes/uploads.ts) | Roster upload calls `syncManagers` in its transaction. |

What the middleware does per request:
1. `OKTA_ISSUER` empty → let everything through and log a warning (demo mode).
2. Invalid issuer (e.g. placeholder) → refuse to start with a clear error.
3. No `Bearer` token → **401**.
4. Verify the token with `jose`: signature via Okta's keys at `{issuer}/v1/keys` (cached), plus issuer, audience
   (`OKTA_AUDIENCE`, default `api://default`) and RS256. Failure → **401**.
5. Identifiers = `preferred_username` (the Okta login), the `email` claim, and `sub` if it contains `@`, lower-cased.
   Set `OKTA_IDENTITY_CLAIM` (`preferred_username`, `email` or `sub`) in `backend/.env` to use exactly one claim instead.
   Login and email can differ (e.g. `@liveramp.com` login vs `@liveramptest.com` email in a preview org).
6. Look it up with OR logic: `app_users.email IN (ids) OR app_users.username IN (ids)` (highest role wins). No row → **403** `{error, email}`. Otherwise set `req.userEmail` / `req.userRole`.

## 5. Configuration

`backend/.env`
```
OKTA_ISSUER=https://<org>.okta.com/oauth2/default   # empty = Okta off (demo mode)
OKTA_AUDIENCE=api://default
```

`frontend/.env` (read at **build time**; rebuild after changing)
```
VITE_OKTA_ISSUER=https://<org>.okta.com/oauth2/default
VITE_OKTA_CLIENT_ID=<spa client id>
```

Leave all Okta values **empty** to run without Okta. Never leave the `<...>` placeholders from `.env.example` in
place: the backend and frontend will refuse to start. Vite only reads `.env` at startup, so restart `npm run dev`
after editing (and check for `.env.local`, which overrides `.env`).

### Org authorization server vs custom/default server

| `OKTA_ISSUER` looks like | Server type | Token the SPA sends | Backend verifies | Extra setting |
|---|---|---|---|---|
| `https://x.okta.com/oauth2/default` (or `/oauth2/<id>`) | custom / default | **access token** | `aud` = `OKTA_AUDIENCE`, keys at `/oauth2/<id>/v1/keys` | none |
| `https://x.okta.com` (no `/oauth2/...`) | **org** | **ID token** | `aud` = `OKTA_CLIENT_ID`, keys at `/oauth2/v1/keys` | `OKTA_CLIENT_ID` in `backend/.env` |

Detected automatically on both sides. Org-server access tokens are meant for Okta's own APIs (their `aud` is the org
URL), so third-party APIs shouldn't validate them; the ID token (audience = our client id, carries `email`) is the
verifiable alternative. A custom/default server is still the recommended setup for an API.

## 6. Creating the superadmin

The superadmin is a row inserted directly in the database (nothing in the app creates or overwrites it):

```sql
INSERT INTO app_users (email, name, role)
VALUES ('psaram@liveramp.com', 'Your Name', 'superadmin')
ON CONFLICT (email) DO UPDATE SET role = 'superadmin';
-- optional second identifier: UPDATE app_users SET username = 'psaram@liveramp.com' WHERE email = 'psaram@liveramp.com';
```

A sign-in matches a row on its `email` **or** its `username` against **any** identifier in the token (Okta login or
email claim); lower-case. See [OKTA_README.md](OKTA_README.md) section 3.3. Then sign in with Okta: the **Access** tab
appears and you can add HR users. Full details in [OKTA_README.md](OKTA_README.md).

## 7. Go-live and test checklist

1. Okta team provides the items in [OKTA_INTEGRATION.md](OKTA_INTEGRATION.md).
2. Fill in the Okta values, insert your superadmin row (section 6), rebuild the frontend, restart the backend.
3. Open the app: redirected to Okta, then back in with your email and role in the header.
4. Sign in as someone not in `app_users`: Access denied screen.
5. `curl localhost:3000/api/months` with no token: **401**.
6. Upload a roster, then confirm one of its managers can sign in.
7. As superadmin, add an HR user on the Access page and confirm they can sign in.

Troubleshooting: the usual causes of failure are the audience not matching, the issuer being the *org* authorization
server (use `default` or a custom one), a redirect URI not registered in Okta, or the email claim differing from what
we expect.

## 8. Known limitations

1. **Not verified against a real Okta tenant yet.** The first live login may need small adjustments.
2. **No non-Okta login.** If Okta is down or the superadmin isn't assigned to the Okta app, nobody can sign in.
3. **Roles don't restrict data.** Managers and HR see all employees' data. The role only gates the Access page.
   Per-manager data scoping would be a separate feature.
4. **No audit trail** of who uploaded or changed what.
5. **Token lifetime/renewal.** Access tokens are typically valid for 1 hour. Silent renewal can be blocked by browser
   third-party-cookie settings; a 401 then triggers a fresh login redirect. Ask Okta about enabling refresh tokens.
6. **Tokens live in `sessionStorage`** (cleared when the tab closes). The usual SPA XSS trade-off applies.
7. **The built frontend is served without auth** (only `/api` is protected); it contains no sensitive data.
8. **Email matching is exact.** If a manager's roster email differs from their Okta login (e.g. an alias), they'll see
   Access denied.
9. **`/api/health` is public** by design (for load balancers).
10. **The superadmin row is managed by hand in the database;** restrict database write access.

## 9. Tests

- [backend/test/auth.test.ts](backend/test/auth.test.ts): middleware is open when Okta is off; 401 for a missing or
  malformed token when on.
- [backend/test/api.test.ts](backend/test/api.test.ts) (`access list (app_users)`): roster upload creates managers; HR
  add/remove, duplicates and invalid emails; HR survives a roster re-upload. Needs local Postgres.

Not covered: a real signed Okta token (allowed vs denied email), which needs an Okta tenant or a test signing key.
