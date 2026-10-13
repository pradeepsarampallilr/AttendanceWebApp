# Application and API flow

Flow charts for the Attendance Management System. The diagrams are [Mermaid](https://mermaid.js.org/); they render on
GitHub and in VS Code's Markdown preview (with a Mermaid extension).

Contents: [1 Overview](#1-system-overview) · [2 Sign-in](#2-sign-in-okta-oidc--pkce) · [3 Request guard](#3-api-request-guard-every-api-call) ·
[4 Sign-out](#4-sign-out) · [5 Uploads](#5-uploading-files) · [6 Processing](#6-processing-a-month) ·
[7 Viewing](#7-viewing-results) · [8 Edits](#8-manual-edits-wednesdays-hours-holidays-leaves) · [9 Export](#9-excel-export) ·
[10 Access admin](#10-access-management-superadmin) · [11 Endpoints](#11-endpoint-map)

---

## 1. System overview

```mermaid
flowchart LR
  U[User in browser<br/>React app] -->|sign in| O[Okta]
  U -->|"/api + Bearer token"| A[Express API]
  A -->|verify token keys| O
  A --> G{Auth guard<br/>token valid and<br/>user in app_users?}
  G -->|no| X[401 / 403]
  G -->|yes| R[Routes<br/>uploads, months,<br/>leaves, admin]
  R --> E[Engine and services<br/>attendance maths]
  R --> D[(PostgreSQL)]
  E --> D
```

---

## 2. Sign-in (Okta OIDC + PKCE)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (AuthGate)
  participant K as Okta
  participant S as API
  participant DB as Postgres

  B->>B: Open app, no tokens in sessionStorage
  B->>K: Redirect to /authorize (PKCE challenge)
  K->>K: User logs in (SSO / MFA)
  K-->>B: Redirect to /login/callback?code=...
  B->>K: POST /token (code + PKCE verifier)
  K-->>B: ID token + access token (stored in sessionStorage)
  B->>S: GET /api/me (Authorization: Bearer token)
  S->>K: Fetch signing keys (cached)
  S->>S: Verify signature, iss, aud, exp
  S->>DB: app_users WHERE email IN ids OR username IN ids
  alt user found
    DB-->>S: row (email, role)
    S-->>B: 200 {email, role}
    B->>B: Render the app
  else not in app_users
    S-->>B: 403 Access denied (+ identifiers checked)
    B->>B: Access denied screen
  else bad token
    S-->>B: 401 (+ reason)
    B->>B: Sign-in failed screen
  end
```

Which token is sent: org server issuer (no `/oauth2` in the URL) sends the **ID token**; a custom or default server sends the
**access token**.

### AuthGate screen states

```mermaid
stateDiagram-v2
  [*] --> loading
  loading --> loading: callback path, handleRedirect()
  loading --> redirecting: not authenticated
  redirecting --> [*]: browser goes to Okta
  loading --> checking: authenticated
  checking --> ready: /api/me 200
  checking --> denied: /api/me 403
  checking --> error: /api/me 401 or other failure
  denied --> [*]: Sign out / switch account
  error --> loading: Try again
  ready --> [*]
```

---

## 3. API request guard (every `/api` call)

```mermaid
flowchart TD
  A[Request to /api/...] --> H{Path is /api/health?}
  H -->|yes| OK0[200 public]
  H -->|no| OFF{OKTA_ISSUER set?}
  OFF -->|no, demo mode| NEXT[Continue to route]
  OFF -->|yes| T{Bearer token present?}
  T -->|no| E401a[401 Authentication required]
  T -->|yes| V{jwtVerify:<br/>signature, iss, aud,<br/>exp, RS256}
  V -->|fails| E401b[401 Invalid or expired token + reason]
  V -->|ok| I[Collect identifiers from token:<br/>preferred_username, email,<br/>sub if it has @<br/>or the one OKTA_IDENTITY_CLAIM]
  I --> Q[(SELECT app_users<br/>email IN ids OR username IN ids)]
  Q --> F{Row found?}
  F -->|no| E403[403 Access denied]
  F -->|yes| SET[Set req.userEmail and req.userRole<br/>highest role wins]
  SET --> NEXT
  NEXT --> AD{Path is /api/admin?}
  AD -->|yes, not superadmin| E403b[403 Superadmin only]
  AD -->|otherwise| ROUTE[Run the route handler]
```

On the browser side, a 401 on a normal call clears the tokens and sends the user back to Okta, at most once per minute.

---

## 4. Sign-out

```mermaid
flowchart TD
  S[User clicks Sign out] --> A[Read ID token<br/>needed as id_token_hint]
  A --> B[Clear local state first:<br/>tokenManager.clear,<br/>sessionStorage.clear,<br/>okta-token-storage key]
  B --> C[oktaAuth.signOut<br/>idToken, postLogoutRedirectUri = origin]
  C -->|ok| D[Okta session ended,<br/>redirect to app origin]
  C -->|throws| E[window.location.assign '/']
  D --> L[AuthGate: no tokens, redirect to Okta login]
  E --> L
```

Both steps matter: clearing local tokens removes the app's session, and ending the Okta session stops Okta from signing the same
user straight back in.

---

## 5. Uploading files

```mermaid
flowchart TD
  U[Upload page] --> K{File kind}
  K -->|roster| P1
  K -->|movement| P1
  K -->|transport| P1
  P1["POST /api/uploads<br/>multipart: kind + file"] --> V1{kind valid and<br/>file is .csv / .xlsx?}
  V1 -->|no| E400[400 validation error]
  V1 -->|yes| RT[readTable parses the file]
  RT -->|unreadable| E400
  RT --> TX[Database transaction]

  TX --> KT{kind}
  KT -->|transport| T1[Check it has employees]
  T1 --> T2[Save Upload row<br/>replace transport_employees table]
  T2 --> T3[refreshTransportOptIn<br/>processed months pick it up]

  KT -->|roster| R1[Check header and employees]
  R1 --> R2[Save Upload row<br/>replace roster_employees table]
  R2 --> R3[syncManagers:<br/>manager emails become allowed<br/>users, HR and superadmin kept]

  KT -->|movement| M1[Check header and swipe events]
  M1 --> M2[Infer the month from the swipes]
  M2 --> M3[Delete older movement upload<br/>for that month, save new Upload]
  M3 --> M4[Insert swipe_events in chunks]

  T3 --> OK[201 result]
  R3 --> OK
  M4 --> OK
```

Other upload endpoints:

```mermaid
flowchart LR
  A["GET /api/uploads"] --> A1[Upload history list]
  B["GET /api/templates/:kind"] --> B1[Blank .xlsx template]
  C["POST /api/leaves/upload"] --> C1[Parse leaves file,<br/>validate columns and dates,<br/>store leaves]
  D["GET /api/leaves/employees"] --> D1[Search employees<br/>for the leave calendar]
```

---

## 6. Processing a month

```mermaid
flowchart TD
  S["POST /api/months/:ym/process"] --> V{ym looks like 2026-08?}
  V -->|no| E400[400 Month must look like 2026-08]
  V -->|yes| L1[Load this month's swipe events]
  L1 --> C1{Movement upload<br/>exists?}
  C1 -->|no| E404a[404 No movement upload for month]
  C1 -->|yes| L2[Load roster]
  L2 --> C2{Roster uploaded?}
  C2 -->|no| E404b[404 No roster uploaded yet]
  C2 -->|yes| L3[Load previous month's last-day swipes<br/>for pairing only]
  L3 --> L4[Load fallback names,<br/>public holidays, leaves]
  L4 --> ENG["buildAttendanceDataset (engine)"]

  subgraph engine [Attendance engine]
    ENG --> N1[Match check-ins with check-outs<br/>flag stray swipes]
    N1 --> N2[Work out each visit's work day<br/>and hours]
    N2 --> N3[Apply shifts, eligibility,<br/>holidays and leaves]
    N3 --> N4[Daily, weekly and monthly compliance<br/>7 hour minimum]
  end

  N4 --> OUT[rows, issues, attendedDates]
  OUT --> UM{Managers missing<br/>from roster?}
  UM -->|yes| AI[Add 'Manager email unresolved' issue]
  UM -->|no| TXN
  AI --> TXN[Database transaction]
  TXN --> W1[Delete old attendance_visits,<br/>audit_issues, wednesday_attendance<br/>for the month]
  W1 --> W2[Insert attendance rows]
  W2 --> W3[refreshTransportOptIn]
  W3 --> W4[Insert audit issues]
  W4 --> W5[Insert Wednesday attendance<br/>one row per employee per Wednesday]
  W5 --> DONE[200 result]
```

Deleting a month: `DELETE /api/months/:ym` removes its processed data and uploads.

---

## 7. Viewing results

```mermaid
flowchart LR
  subgraph Pages
    D[Dashboard]
    W[Wednesday page]
    AU[Audit page]
    UP[Upload page]
  end
  D -->|"GET /api/months/:ym/attendance"| A1[attendanceRows:<br/>engine rows + manual adjustments]
  W -->|"GET /api/months/:ym/wednesday"| A2[wednesdayData:<br/>attendance + overrides + holidays]
  AU -->|"GET /api/months/:ym/audit"| A3[Audit issues, filter and search]
  UP -->|"GET /api/months"| A4[Months list and status]
  UP -->|"GET /api/uploads"| A5[Upload history]
```

The app loads the month list first, then the selected month's data. The frontend maths (hours, manager totals, Wednesday
tiers) are in `frontend/src/lib/`.

---

## 8. Manual edits (Wednesdays, hours, holidays, leaves)

### Daily hours (add, edit, delete)

```mermaid
flowchart TD
  P["PUT /api/months/:ym/hours<br/>{employeeId, workDate, hours or remove}"] --> V1{Body valid?<br/>date in month, 0 to 24 hours}
  V1 -->|no| E400[400]
  V1 -->|yes| H{Employee-day has<br/>engine rows?}
  H -->|no| H2{Employee has any rows<br/>in the month?}
  H2 -->|no| E404[404]
  H2 -->|yes| H3{remove?}
  H3 -->|yes| E400b[400 Nothing to delete]
  H3 -->|no| ADD[action = add]
  H -->|yes| R{remove?}
  R -->|yes| DEL[action = delete]
  R -->|no| EDIT[action = edit]
  ADD --> U[(Upsert manual_adjustments)]
  DEL --> U
  EDIT --> U
  U --> OK[200 ok, action]
  RV["DELETE /api/months/:ym/hours/:employeeId/:date"] --> RV1[Remove the adjustment,<br/>engine value restored]
```

Adjustments are stored separately and applied on read (`applyAdjustments`), so the engine's own results are never overwritten.

### Wednesday override, holidays, leaves

```mermaid
flowchart LR
  A["PUT /api/months/:ym/wednesday<br/>{employeeId, wednesday, attended}"] --> A1{attended null?}
  A1 -->|yes| A2[Delete override]
  A1 -->|no| A3[Upsert override]

  B["PUT /api/months/:ym/holidays"] --> B1[Replace the month's<br/>public holidays]
  B2["GET /api/months/:ym/holidays"] --> B3[List holidays]

  C["POST /api/months/:ym/leaves"] --> C1[Add a leave]
  C2["DELETE /api/months/:ym/leaves/:id"] --> C3[Remove a leave]
  C4["GET / PUT /api/months/:ym/employees/:id/leaves"] --> C5[Read or replace one employee's<br/>leave days]
```

Holidays and leaves change the working days used the **next time the month is processed**, so reprocess after editing them.

---

## 9. Excel export

```mermaid
flowchart LR
  B[Export button] -->|"downloadFile()<br/>fetch with Bearer token"| E["GET /api/months/:ym/export.xlsx"]
  E --> R[attendanceRows with adjustments]
  R --> X[ExcelJS builds the workbook]
  X --> F[Response with filename header]
  F --> S[Browser saves it from a temporary object URL]
```

A plain link cannot send the Authorization header, which is why downloads and template downloads go through `downloadFile`.

---

## 10. Access management (superadmin)

```mermaid
flowchart TD
  P[Access page<br/>superadmin only] --> L["GET /api/admin/users"]
  L --> L1[List app_users]
  P --> A["POST /api/admin/users {email, username?}"]
  A --> A1{Valid, no spaces,<br/>not already used?}
  A1 -->|no| E400[400]
  A1 -->|yes| A2[Insert row with role hr, 201]
  P --> D["DELETE /api/admin/users/:email"]
  D --> D1{Row is role hr?}
  D1 -->|no| E404[404]
  D1 -->|yes| D2[Delete row, 204]
```

Who is in `app_users`: **superadmin** is inserted by hand in the database, **managers** come from each roster upload, **HR** are added on
this page. A roster upload replaces only the manager rows.

---

## 11. Endpoint map

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | Liveness and DB time |
| `GET /api/me` | allowed user | Email and role of the signed-in user |
| `GET /api/templates/:kind` | allowed user | Blank upload template |
| `POST /api/uploads` | allowed user | Upload roster, movement or transport file |
| `GET /api/uploads` | allowed user | Upload history |
| `GET /api/months` | allowed user | Months and their status |
| `POST /api/months/:ym/process` | allowed user | Run the engine for a month |
| `DELETE /api/months/:ym` | allowed user | Delete a month's data |
| `GET /api/months/:ym/attendance` | allowed user | Attendance rows (with adjustments) |
| `GET /api/months/:ym/audit` | allowed user | Data problems found |
| `GET` / `PUT /api/months/:ym/wednesday` | allowed user | Wednesday matrix, and override one cell |
| `PUT /api/months/:ym/hours` | allowed user | Add, edit or delete a day's hours |
| `DELETE /api/months/:ym/hours/:employeeId/:date` | allowed user | Undo an adjustment |
| `GET /api/months/:ym/export.xlsx` | allowed user | Excel download |
| `GET` / `PUT /api/months/:ym/holidays` | allowed user | Public holidays for the month |
| `GET` / `POST /api/months/:ym/leaves`, `DELETE …/leaves/:id` | allowed user | Leaves for the month |
| `GET` / `PUT /api/months/:ym/employees/:employeeId/leaves` | allowed user | One employee's leaves |
| `POST /api/leaves/upload`, `GET /api/leaves/employees` | allowed user | Leaves file upload, employee search |
| `GET` / `POST /api/admin/users`, `DELETE /api/admin/users/:email` | superadmin | Manage HR users |

Status codes: **401** missing or invalid token, **403** valid token but not in `app_users` (or not superadmin on `/api/admin`),
**400** invalid input, **404** missing data. With `OKTA_ISSUER` empty the guard is skipped (demo mode).
