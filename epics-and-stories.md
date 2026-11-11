# Epics and User Stories: Attendance Management System

Version 1 was a standalone Python script ([Attendace-Reconciliation-Engine](https://github.com/pradeepsarampallilr/Attendace-Reconciliation-Engine.git)).
This project continues it as a web application. Rules are in [policies.md](policies.md), flows in [flow.md](flow.md), sign-in in
[authentication.md](authentication.md).

**Stack:** React 19 + Vite + Tailwind + React Router (frontend), Express 5 + TypeORM + PostgreSQL (backend), Okta OIDC (sign-in), ExcelJS and
csv-parse (files), Vitest (tests).

**Format:** each epic has a description, benefits and acceptance criteria. Each story has a description, an architecture review and subtasks.
**Status:** Done = built in the code today. Planned = a gap taken from the known limitations. Check the Planned items against your own backlog.

| # | Epic | Status |
|---|---|---|
| E1 | Web application foundation | Done |
| E2 | Attendance engine (port of the Python script) | Done |
| E3 | Data ingestion (uploads) | Done |
| E4 | Policy and compliance rules | Done |
| E5 | Data quality and audit | Done |
| E6 | Holidays and leaves | Done |
| E7 | Wednesday in-office tracking | Done |
| E8 | Manual adjustments and overrides | Done |
| E9 | Dashboard and reporting | Done |
| E10 | Excel export | Done |
| E11 | Authentication and access control (Okta) | Done, not tested on a real tenant |
| E12 | Quality, deployment and operations | Partly done |
| E13 | Enhancements (backlog) | Planned |

---

## E1. Web application foundation

**Description:** The single-page web application that replaces running a script by hand. It covers the React frontend (pages, navigation,
month selector, shared components), the Express REST API, the PostgreSQL database, and how they are built and served together.

**Benefits**
- HR no longer needs Python or the command line: everything is done in the browser.
- One shared source of truth (database) instead of files on someone's laptop.
- Results are repeatable and viewable by many people at once.
- A clean API and UI split lets either side change without breaking the other.

**Acceptance criteria**
- The app opens in a browser with pages Upload, Dashboard, Wednesday, Audit Log and (for superadmin) Access.
- A month selector, kept in the URL, applies to every page.
- The frontend talks to the backend only through `/api`.
- Data is stored in PostgreSQL through migrations.
- Every page shows loading, empty and error states.
- The built frontend is served by the Express server as one deployable.

### E1-S1 Frontend shell and navigation
**Description:** As a user, I want a header with page links, the current month selector and my account, so that I can move around the app easily.

**Architecture review**
- React Router with routes `/upload`, `/dashboard`, `/wednesday`, `/audit`, `/access`; unknown paths redirect to `/upload`.
- The selected month is held in the URL query string and passed down as a prop, so links are shareable and pages stay in sync.
- The Access route is registered only for superadmin (UI hiding is cosmetic; the real check is on the API).
- Risk: month state in the URL must be kept on every `NavLink`.

**Subtasks**
1. Create the Vite + React + Tailwind project and base layout.
2. Add routes and `NavLink`s that carry the month query string.
3. Build the month selector fed by `GET /api/months` with status labels.
4. Show email, role badge and Sign out in the header.
5. Hide the Access link for non-superadmin roles.

### E1-S2 API client and shared UI helpers
**Description:** As a developer, I want one API client, an async-data hook and shared components, so that pages are consistent and short.

**Architecture review**
- `api.ts` wraps `fetch`, adds the Bearer token, and throws `ApiError` with the HTTP status.
- `useAsync` gives `loading / error / data / reload` so pages do not repeat that logic.
- `ConfirmModal` is the single pattern for destructive actions.
- Authenticated file downloads go through `downloadFile` because a plain link cannot send headers.

**Subtasks**
1. Write `authFetch` and `ApiError`.
2. Write the `useAsync` hook.
3. Build `ConfirmModal`, `UploadCard`, and the calendar components.
4. Add `downloadFile` for authenticated downloads.
5. Add a global error banner pattern.

### E1-S3 Express API skeleton
**Description:** As a developer, I want a structured REST API with validation and central error handling, so that routes are predictable.

**Architecture review**
- `app.ts` builds the app (testable without a port); `index.ts` starts it.
- Routers: `uploads`, `months`, `leaves`, `admin`. Business logic lives in `services/` and `engine/`, not in routes.
- JSON error responses with the codes 400 (bad input), 401, 403, 404; one `onError` middleware.
- `/api/health` is public and returns the database time.

**Subtasks**
1. Create `app.ts` with JSON, CORS and the router mounts.
2. Add the `/api/health` endpoint.
3. Add `onError` and consistent error shape.
4. Add `/api/me` and template download endpoints.
5. Document the endpoint map in flow.md.

### E1-S4 Database schema and migrations
**Description:** As a developer, I want the schema created by versioned migrations, so that every environment has the same tables.

**Architecture review**
- TypeORM entities in `models/`: uploads, roster, transport, swipe events, attendance visits, audit issues, Wednesday attendance and overrides, public
  holidays, leaves, manual adjustments, app users.
- Migrations: initial schema, leaves, app users, username column.
- Engine output is separate from user edits (adjustments, overrides, holidays, leaves), so reprocessing is safe.
- Swipe inserts are chunked to stay inside PostgreSQL parameter limits.

**Subtasks**
1. Define the entities.
2. Write the four migrations and the migration index.
3. Configure the data source from environment variables.
4. Add the store helpers used by the routes.
5. Add indexes on month, employee and work date.

### E1-S5 Build, configuration and serving
**Description:** As ops, I want the build and environment settings to be simple, so that deploying is one step.

**Architecture review**
- Frontend env vars (`VITE_*`) are read at **build time**; backend env vars at start. `.env.example` files document both.
- Express serves `frontend/dist` and falls back to `index.html` for non-API GETs.
- Placeholder values (`<...>`) make the app refuse to start, which prevents silent misconfiguration.

**Subtasks**
1. Provide `.env.example` for frontend and backend.
2. Add the static serving and SPA fallback.
3. Add start-up validation of placeholder values.
4. Write the run and build steps in the README.

---

## E2. Attendance engine (port of the Python script)

**Description:** The core logic that turns raw door swipes and the roster into visits, work days, hours and compliance rows. It is a faithful
TypeScript port of the version-1 Python script.

**Benefits**
- Same numbers as the Python script, but now automated and testable.
- Night shifts, missing checkouts and month boundaries are handled consistently.
- Engine code is pure (no database), so it is easy to test and reason about.

**Acceptance criteria**
- Results for the July and August data match the Python output (golden tests).
- A check-in is paired with a checkout up to 20 hours later, no later than the next day.
- Overnight shifts are not split across two dates.
- Open visits are kept as rows with no hours.
- Visits from the previous month are never counted; the last day of the month is skipped and logged.

### E2-S1 Pair swipes into visits
**Description:** As HR, I want check-ins and checkouts paired into visits, so that hours can be calculated.

**Architecture review**
- `pairSwipeEvents` runs per employee over time-sorted swipes; a small state machine (pending check-in).
- Rules: valid checkout within 20 hours and today or tomorrow; check-in after check-in gives an open visit; stray checkout is ignored and logged.
- Pure function with typed input and output (`engine/types.ts`).

**Subtasks**
1. Parse movement files into alternating In/Out events (column G onward).
2. Implement the pairing state machine.
3. Emit audit issues for missing and orphan checkouts.
4. Unit test the edge cases (21 hours, next-day checkout, two check-ins).

### E2-S2 Attribute visits to work days
**Description:** As HR, I want each visit assigned to the right work day, so that night shifts count once.

**Architecture review**
- `assignWorkDate`: check-in date for normal shifts; for overnight shifts a check-in after midnight up to shift end + 60 minutes belongs to the previous day.
- Inferred overnight pattern when no shift is known (evening check-ins outnumber morning ones).
- Day groups combine several visits on one work date.
- All times are UTC clock values from the file, so there are no time-zone shifts.

**Subtasks**
1. Implement `assignWorkDate` with the 60-minute buffer.
2. Implement the inferred overnight pattern and its audit issue.
3. Implement `buildWorkDateGroups`.
4. Add tests for midnight and buffer boundaries.

### E2-S3 Calculate hours
**Description:** As HR, I want visit and daily hours with the same rounding as the Python script, so that totals match.

**Architecture review**
- Visit hours rounded to 2 decimals, ties to even (matches Python `round`); a JavaScript `Math.round` would differ, so a custom function is needed.
- Daily total = sum of closed visits; null if none; a partial-day issue when closed and open visits mix.
- Month total sums daily totals (null counts as 0).

**Subtasks**
1. Implement the round-half-even helper.
2. Implement daily and month totals.
3. Add the partial-day audit issue.
4. Add rounding tests against known Python values.

### E2-S4 Month boundary and carryover
**Description:** As HR, I want month edges handled safely, so that nothing is double counted or lost.

**Architecture review**
- Only the last day of the previous month's swipes is loaded, and only for pairing.
- Visits that start in the previous month are dropped; a visit on the last day of the month is skipped with an audit issue because its checkout may be in next month's file.
- Trade-off: last-day hours are not counted until a policy decision is made (see E13).

**Subtasks**
1. Load the previous month's last-day swipes in `process.ts`.
2. Drop previous-month and out-of-month visits.
3. Log *Skipped - month boundary*.
4. Test a night shift that starts on the last day.

### E2-S5 Dataset builder and golden tests
**Description:** As a developer, I want one function that builds the full attendance dataset and tests that prove parity with Python.

**Architecture review**
- `buildAttendanceDataset` combines roster, swipes, holidays, leaves and previous-month data into rows, issues and attended dates.
- Golden tests compare against stored July and August outputs; any rule change must update the golden files knowingly.
- Rows are sorted by name, work date, check-in time for stable output.

**Subtasks**
1. Implement `buildAttendanceDataset`.
2. Store the golden fixtures from the Python run.
3. Write `golden.test.ts`.
4. Document the "change a rule, update the golden files" process.

---

## E3. Data ingestion (uploads)

**Description:** Letting HR load the roster, monthly movement (swipe) files, the transport list, leaves and templates, with validation and history.

**Benefits**
- HR can load data themselves in minutes.
- Bad files are rejected with a clear reason, so wrong data never reaches the engine.
- Re-uploading a month safely replaces old data.

**Acceptance criteria**
- Roster, movement and transport files (.csv or .xlsx) can be uploaded; other types are rejected.
- Missing columns, bad dates and empty files give a clear 400 message.
- The latest roster and transport files replace the old ones; a movement re-upload replaces only that month.
- Upload history lists every upload.
- Blank templates can be downloaded.

### E3-S1 Roster upload
**Description:** As HR, I want to upload the roster so that shifts, departments and managers are known.

**Architecture review**
- `POST /api/uploads` multipart (`kind` + `file`) → `readTable` → one database transaction: save the Upload row, replace `roster_employees`, then `syncManagers`.
- The transaction means a failed upload leaves the old roster in place.
- Manager email is resolved by matching the manager's name with another roster employee; unresolved names go to one audit issue.
- Shift text parsing (`9:00 AM - 6:30 PM`, `12:xx` rules) lives in `engine/roster.ts`.

**Subtasks**
1. Validate headers and skip rows without ID or name.
2. Parse employee ID, lower-case email, and shift text.
3. Resolve manager email by name.
4. Replace the table and call `syncManagers` in one transaction.
5. Tests for bad headers and shift formats.

### E3-S2 Movement (swipe) upload
**Description:** As HR, I want to upload a month's swipes so that the month can be processed.

**Architecture review**
- Header row found by `EmpCode` in column B within the first 10 rows; rows count only with a numeric `EmpCode` and `DD-MM-YYYY` date.
- The month is inferred as the month with the most swipes; the older upload for that month is deleted in the same transaction.
- Inserts are chunked for large files.

**Subtasks**
1. Find the header and parse rows.
2. Infer the month.
3. Replace the month's previous upload and swipes in a transaction.
4. Chunked insert of swipe events.
5. Tests for a month that spans two calendar months.

### E3-S3 Transport upload
**Description:** As HR, I want an optional transport list so that opt-in appears on attendance rows.

**Architecture review**
- Replaces `transport_employees`, then `refreshTransportOptIn` updates saved attendance rows, so processed months update without reprocessing.
- Opt-in is display data only; it does not affect compliance.

**Subtasks**
1. Validate and save the transport file.
2. Implement `refreshTransportOptIn`.
3. Call it from both upload and process.
4. Test that a processed month updates immediately.

### E3-S4 Leaves file upload
**Description:** As HR, I want to upload leaves in bulk so that working days are reduced for those employees.

**Architecture review**
- `POST /api/leaves/upload`; accepts several header aliases (`emplid`, `empcode`, `date`) and Excel or ISO dates.
- Errors name the row number.
- Leaves reduce only the monthly working-day count, not the weekly requirement.

**Subtasks**
1. Map header aliases.
2. Parse Excel and ISO dates with row-level errors.
3. Store leaves.
4. Tests for alias headers and bad dates.

### E3-S5 Templates and upload history
**Description:** As HR, I want blank templates and a history of uploads, so that I prepare and trace files correctly.

**Architecture review**
- `GET /api/templates/:kind` builds an .xlsx with the expected headers.
- `GET /api/uploads` lists the uploads; the Upload page shows a card per kind.

**Subtasks**
1. Generate templates with ExcelJS.
2. Add the history endpoint.
3. Build the `UploadCard` UI and history table.
4. Show validation errors in the card.

---

## E4. Policy and compliance rules

**Description:** The attendance policy as code: who is eligible, and how daily, weekly and monthly compliance are decided.

**Benefits**
- The policy is applied the same way for everyone.
- Rules are documented with their values and source file, so audits and changes are easy.
- Holidays and short weeks are handled fairly.

**Acceptance criteria**
- General-shift employees (9:00 AM - 6:30 PM) get NA everywhere.
- Daily: Yes at 7.0 hours or more, No below, NA if no total.
- Weekly: Yes only if every working Wednesday is attended and attended days ≥ the requirement (3, or fewer with holidays or a short week).
- Monthly: Yes only if hours per working day ≥ 7.0 and every evaluated week is Yes.
- [policies.md](policies.md) matches the code.

### E4-S1 Eligibility and daily compliance
**Description:** As HR, I want exempt shifts excluded and each day flagged, so that the policy applies to the right people.

**Architecture review**
- Constants (`COMPLIANT_MIN_HOURS`, `GENERAL_SHIFT_WINDOW`) are exported and used everywhere, so there is one place to change a rule.
- Three-valued result Yes / No / NA keeps "not applicable" distinct from "failed".
- Unknown shift = eligible (conservative choice).

**Subtasks**
1. Implement eligibility from the shift.
2. Implement `evaluateCompliance`.
3. Unit tests for the 7.0 boundary and NA cases.

### E4-S2 Weekly compliance
**Description:** As HR, I want a weekly flag with the 3-day and Wednesday rules, so that the in-office policy is checked.

**Architecture review**
- Week blocks are fixed 7-day blocks (1-7, 8-14, ...), not calendar weeks, via `weekNumberInMonth`.
- Requirement is `min(3, working weekdays − holidays)`.
- A week with no visits has no row and is not evaluated; leaves do not change the weekly requirement (documented limitation).

**Subtasks**
1. Implement the week bucketing.
2. Implement `evaluateWeekCompliance`.
3. Handle holiday Wednesdays and short last blocks.
4. Tests including the worked example in policies.md.

### E4-S3 Monthly compliance
**Description:** As HR, I want a monthly flag so that overall performance is clear.

**Architecture review**
- Working days = weekdays − public holidays − the employee's leaves; zero working days gives No.
- Month is Yes only if the average ≥ 7.0 and all evaluated weeks are Yes.
- Holidays and leaves change this ratio only after reprocessing.

**Subtasks**
1. Compute working days per employee.
2. Implement `evaluateMonthCompliance`.
3. Tests for leave and holiday combinations.

### E4-S4 Policy documentation
**Description:** As a policy owner, I want every rule documented with its value and file, so that changes are reviewed with confidence.

**Architecture review**
- [policies.md](policies.md) holds the quick-reference table and per-rule sections; it must be updated whenever a constant changes.
- Golden tests act as the safety net.

**Subtasks**
1. Keep the quick-reference table in sync with the constants.
2. Add a "change checklist" (update the doc, the golden files, the tests).

---

## E5. Data quality and audit

**Description:** Every data problem the engine finds is stored per month and shown on an Audit page, so nothing is silently dropped.

**Benefits**
- HR can see why a number looks wrong and fix the source data.
- Trust in the results: unexplained gaps disappear.
- Employees missing from the roster still appear.

**Acceptance criteria**
- Seven issue types are stored per month (see policies.md section 11).
- The Audit page can be filtered and searched.
- Employees not in the roster still get rows (manager NA, eligible Yes).
- Reprocessing replaces engine output but keeps manual data.

### E5-S1 Store audit issues
**Description:** As HR, I want every engine issue saved, so that I can review them later.

**Architecture review**
- `audit_issues` table per month, replaced on each processing run.
- The engine returns issues as data; `process.ts` persists them in the same transaction as the attendance rows.

**Subtasks**
1. Define the `AuditIssue` model.
2. Persist the issues in the processing transaction.
3. `GET /api/months/:ym/audit`.

### E5-S2 Audit page
**Description:** As HR, I want to filter and search issues, so that I can find the ones that matter.

**Architecture review**
- Client-side filtering over one month's list (the volume is small enough).
- Filters by issue type; search by employee name or ID.

**Subtasks**
1. Build the table and the type filter.
2. Add the search box.
3. Add the count badges and the empty state.

### E5-S3 Employees missing from the roster
**Description:** As HR, I want unmatched swipe IDs to still appear, so that no attendance is lost.

**Architecture review**
- Fallback names come from the swipe file; shift is "Unassigned", manager NA, eligibility Yes.
- An audit issue *No roster match* is raised so the roster can be fixed.

**Subtasks**
1. Load fallback names in `process.ts`.
2. Apply the defaults in the dataset builder.
3. Add the audit issue and a test.

### E5-S4 Safe reprocessing
**Description:** As HR, I want to reprocess a month without losing my edits.

**Architecture review**
- Processing deletes and re-inserts only engine tables (`attendance_visits`, `audit_issues`, `wednesday_attendance`) in one transaction.
- Adjustments, overrides, holidays and leaves are separate tables and survive.

**Subtasks**
1. Wrap delete + insert in a transaction.
2. Return clear 404s when the roster or the movement upload is missing.
3. Test that adjustments survive a reprocess.

---

## E6. Holidays and leaves

**Description:** Letting HR record public holidays and employee leaves so that working-day counts and weekly requirements are fair.

**Benefits**
- Employees are not penalised for holidays or approved leave.
- HR can maintain this data in the app instead of editing spreadsheets.

**Acceptance criteria**
- Holidays are set for a month on a calendar.
- Leaves can be added or removed per employee, or uploaded in bulk.
- The UI states that reprocessing is needed for the compliance values to change.

### E6-S1 Public holiday calendar
**Description:** As HR, I want to pick holidays for a month, so that the policy is relaxed on those days.

**Architecture review**
- `GET / PUT /api/months/:ym/holidays`; PUT replaces the month's set.
- Holidays affect the weekly requirement and the monthly working days.
- Wednesday page reads holidays live; compliance changes need a reprocess.

**Subtasks**
1. Model and endpoints.
2. `HolidayCalendar` component on the Upload page.
3. Reprocess hint after a change.
4. Tests in `holidays.test.ts`.

### E6-S2 Per-employee leave calendar
**Description:** As HR, I want to add leaves for one employee, so that their working days are correct.

**Architecture review**
- Endpoints for the month's leaves, an employee's leaves (GET/PUT replace), and add/delete by ID.
- `GET /api/leaves/employees` provides a search for the picker.
- Only the monthly ratio is affected, not the weekly count.

**Subtasks**
1. Leave model and migration.
2. Endpoints and employee search.
3. `LeaveCalendar` component.
4. Tests in `leaves.test.ts`.

### E6-S3 Out-of-date indicator
**Description:** As HR, I want to know when holidays or leaves changed after processing.

**Architecture review**
- Currently only a text hint; a stored "processed at" timestamp compared with the last holiday or leave change would allow a badge. (This is also E13-S7.)

**Subtasks**
1. Add the hint text in the UI.
2. Design the timestamp comparison (backlog).

---

## E7. Wednesday in-office tracking

**Description:** A dedicated view of Wednesday attendance, with a 75% target, tiers, and manual overrides.

**Benefits**
- Leadership can see turnout on the policy's key day.
- HR can correct exceptions without touching the swipe data.

**Acceptance criteria**
- One row is saved per employee per Wednesday on processing.
- The Wednesday page shows a matrix, turnout against the 75% target, tiers and statistics.
- A cell can be set present, absent or cleared; overrides survive reprocessing.
- Holiday Wednesdays are excluded.

### E7-S1 Record Wednesday attendance
**Description:** As HR, I want Wednesday attendance saved when a month is processed.

**Architecture review**
- Attended = the employee has any work day on that date (any hours), which is separate from the 7-hour rule.
- Everyone in the roster gets a row, including those with no swipes.

**Subtasks**
1. Generate the Wednesday rows in `process.ts`.
2. Table and migration.
3. Tests for employees with no swipes.

### E7-S2 Wednesday matrix page
**Description:** As HR, I want a matrix of employees against Wednesdays, so that I can see attendance at a glance.

**Architecture review**
- `GET /api/months/:ym/wednesday` returns attendance + overrides + holidays merged by `wednesdayData`.
- Front-end maths (tiers, stats) are in `lib/wednesday.ts` and unit-testable.

**Subtasks**
1. Build the endpoint.
2. Build the matrix and filters.
3. Add the holiday markers.

### E7-S3 Statistics and tiers
**Description:** As leadership, I want turnout against the 75% target and attendance tiers.

**Architecture review**
- Tiers: Perfect, High (≥ 75%), Moderate (≥ 50%), Low, Zero. Each attended Wednesday is credited as 8.0 estimated hours.
- Peak and lowest dates, first one on a tie.
- Constants live in `lib/wednesday.ts` (a frontend rule that is separate from the engine rules; keep them aligned).

**Subtasks**
1. Implement the tier and stat functions.
2. Build the summary cards and the distribution chart.
3. Tests for ties and holiday exclusion.

### E7-S4 Wednesday overrides
**Description:** As HR, I want to mark one person present or absent for a Wednesday.

**Architecture review**
- `PUT /api/months/:ym/wednesday {employeeId, wednesday, attended}`; `null` deletes the override.
- Stored in `wednesday_overrides`, apart from engine data.

**Subtasks**
1. Endpoint with upsert and delete.
2. Cell click UI with confirm.
3. Test that an override survives reprocessing.

---

## E8. Manual adjustments and overrides

**Description:** Letting HR correct a day's hours (add, edit, delete) without overwriting engine results.

**Benefits**
- Missed swipes and approved corrections can be reflected quickly.
- The original engine value is never lost and can be restored.

**Acceptance criteria**
- Hours must be 0-24 and the date in the month.
- One adjustment per employee per day.
- Adjusted rows are marked `add`, `edit` or `delete`.
- Undo restores the engine value.
- Only the day total and the daily flag are recomputed.

### E8-S1 Adjust a day's hours
**Description:** As HR, I want to change one employee's hours for a day.

**Architecture review**
- The action (`add`, `edit`, `delete`) is derived from whether engine rows exist, which prevents invalid combinations.
- Stored in `manual_adjustments` and applied on read by `applyAdjustments`; the engine tables are not touched.

**Subtasks**
1. `PUT /api/months/:ym/hours` with validation.
2. Action derivation and the 404 / 400 cases.
3. UI to edit hours in the ledger.
4. Tests in `adjustments.test.ts`.

### E8-S2 Undo an adjustment
**Description:** As HR, I want to remove an adjustment and get the engine value back.

**Architecture review**
- `DELETE /api/months/:ym/hours/:employeeId/:date` removes the row; reads then show engine data.

**Subtasks**
1. Endpoint.
2. Undo button with a confirm modal.
3. Test.

### E8-S3 Visible markers and limits
**Description:** As HR, I want adjusted rows marked and the limits explained.

**Architecture review**
- Daily flag recomputed with the same 7.0 rule and eligibility; weekly and monthly stay as the engine computed (documented in policies.md; see E13-S5).
- An `add` is ignored if swipes later appear for that date.

**Subtasks**
1. Show the `adjustment` marker in the ledger and the export.
2. Show an info note about the weekly/monthly limit.
3. Test the "swipes appear later" case.

---

## E9. Dashboard and reporting

**Description:** The main page for viewing a processed month by employee, manager, ledger and directory.

**Benefits**
- Managers and HR answer "who is compliant?" in seconds.
- One place for totals, details and the employee list.

**Acceptance criteria**
- Four tabs: Employee, Manager, Ledger, Directory.
- Data comes from `GET /api/months/:ym/attendance` with adjustments applied.
- Filters and search work on each tab.
- Month status and a process button are available.

### E9-S1 Month status and processing
**Description:** As HR, I want to see which months are ready and run the processing.

**Architecture review**
- `GET /api/months` lists months and status; `POST /api/months/:ym/process`; `DELETE /api/months/:ym` with a confirm modal.
- Processing is synchronous inside one transaction; fine at the current data size, could need a job queue for much larger data.

**Subtasks**
1. Months endpoint and status.
2. Process and delete buttons.
3. Result summary after processing.

### E9-S2 Employee tab
**Description:** As a viewer, I want an employee's daily hours and compliance flags.

**Architecture review**
- Client-side grouping from the attendance rows; shared helpers in `lib/attendance.ts` and `dashboard/shared.tsx`.

**Subtasks**
1. Employee picker and search.
2. Day table with flags and open-visit marks.
3. Week and month summary.

### E9-S3 Manager tab
**Description:** As a manager, I want team totals and compliance counts.

**Architecture review**
- Grouping by manager email from the roster. Currently every user can see every manager (see E13-S1).

**Subtasks**
1. Group rows by manager.
2. Compliance counts and percentages.
3. Drill-down to employees.

### E9-S4 Ledger and Directory tabs
**Description:** As HR, I want a full row list and an employee directory.

**Architecture review**
- Ledger renders all visit rows with filters; at large sizes, pagination or virtualisation may be needed.
- Directory lists department, shift, manager and transport opt-in.

**Subtasks**
1. Ledger table with filters.
2. Directory table.
3. Pagination or virtual list if rows grow.

---

## E10. Excel export

**Description:** Downloading a month's attendance as an Excel file.

**Benefits**
- Results can be shared with people who do not use the app, and archived.

**Acceptance criteria**
- The .xlsx includes adjustments with their markers.
- The download works while signed in and shows a clear error when not.
- The file name includes the month.

### E10-S1 Export endpoint
**Description:** As HR, I want `GET /api/months/:ym/export.xlsx`.

**Architecture review**
- `services/export.ts` uses ExcelJS over the same `attendanceRows` as the dashboard, so the file and the screen always agree.
- Built in memory; fine for the current size, switch to streaming for very large months.

**Subtasks**
1. Build the workbook (columns, formats).
2. Set the response headers and file name.
3. Test the content.

### E10-S2 Authenticated download in the UI
**Description:** As a user, I want an Export button that works behind Okta.

**Architecture review**
- `downloadFile` fetches with the Bearer token, then saves through a temporary object URL (a plain link cannot send headers).

**Subtasks**
1. Implement `downloadFile`.
2. Add the Export button and error toast.

---

## E11. Authentication and access control (Okta)

**Description:** Okta proves who the user is; the `app_users` table decides if they may use the app. Roles: superadmin, HR, manager.

**Benefits**
- Single sign-on and MFA from the company identity provider.
- Access is controlled in the app and takes effect immediately.
- Managers get access automatically from the roster.

**Acceptance criteria**
- Not signed in: redirected to Okta (OIDC Authorization Code + PKCE).
- Signed in but not in `app_users`: Access denied (403).
- No or invalid token on `/api`: 401.
- Managers follow the roster; HR are added by the superadmin; the superadmin is a database row.
- Sign-out ends both the app and the Okta session.
- Demo mode works when Okta is not configured.

### E11-S1 Okta sign-in (frontend)
**Description:** As a user, I want to sign in with Okta.

**Architecture review**
- `auth.ts` builds the Okta client (PKCE, scopes `openid profile email`, redirect `/login/callback`, `sessionStorage`).
- `AuthGate` handles the callback, the redirect and `/api/me`; screens: loading, ready, denied, error. Tokens in `sessionStorage` carry the usual XSS trade-off.

**Subtasks**
1. Okta client and config checks.
2. `AuthGate` states and the callback.
3. 401 handling with redirect (at most once a minute).
4. `useUser()` hook.

### E11-S2 API token verification
**Description:** As a security owner, I want every API call verified.

**Architecture review**
- `oktaAuth` middleware with `jose`: signature (cached JWKS), issuer, audience, RS256, expiry.
- Supports the custom/default server (access token, audience `api://default`) and the org server (ID token, audience = client ID).
- Identifier claims: `preferred_username`, `email`, `sub` with `@`, or one set by `OKTA_IDENTITY_CLAIM`.
- Lookup is `email IN ids OR username IN ids`, highest role wins; checked on every request.

**Subtasks**
1. Middleware and token verification.
2. Server-type detection.
3. Identity claim handling.
4. Tests for missing and malformed tokens.

### E11-S3 User roles and the Access page
**Description:** As a superadmin, I want to add and remove HR users.

**Architecture review**
- `app_users` (email, username, role). `GET/POST /api/admin/users`, `DELETE /api/admin/users/:email`; superadmin only; only the HR role can be added or removed.
- `syncManagers` replaces the manager rows on each roster upload, in the upload's transaction; HR and superadmin are untouched.

**Subtasks**
1. Model, migration and manager backfill.
2. Admin endpoints with validation.
3. `AccessPage` UI.
4. `syncManagers` and tests.

### E11-S4 Sign-out
**Description:** As a user, I want to end my session fully.

**Architecture review**
- Clear local tokens first, then `signOut` with the ID token hint and a post-logout redirect; fall back to `/` on failure. Both steps are required so Okta does not sign the user straight back in.

**Subtasks**
1. Implement the sign-out sequence.
2. Add the fallback.
3. Test in a browser.

### E11-S5 Superadmin bootstrap and go-live
**Description:** As the project owner, I want a documented way to create the superadmin and go live.

**Architecture review**
- Superadmin is a manual SQL insert (see authentication.md section 6); the database write access must be restricted.
- Go-live checklist and the Okta team handover are in [OKTA_INTEGRATION.md](OKTA_INTEGRATION.md).

**Subtasks**
1. SQL snippet and instructions.
2. Checklist with test steps.
3. **Planned:** run it against a real Okta tenant and fix any findings.

---

## E12. Quality, deployment and operations

**Description:** Tests, build pipeline, deployment and monitoring so the app can run reliably.

**Benefits**
- Fewer regressions; faster, safer releases.
- Known behaviour in production.

**Acceptance criteria**
- Tests cover the engine, API and auth middleware.
- CI runs the tests and the build on every pull request.
- The app is deployed with documented configuration, backups and a health check.

### E12-S1 Automated tests (Done)
**Description:** As a developer, I want a test suite so that changes are safe.

**Architecture review**
- Vitest in the backend: auth, adjustments, holidays, leaves, API and golden tests. API tests need a local PostgreSQL.
- Gap: no signed-token test and no frontend tests.

**Subtasks**
1. Keep the existing suites green.
2. Add a signed-token test with a test signing key.
3. Add frontend tests for `lib/` maths.

### E12-S2 CI pipeline (Planned)
**Description:** As a developer, I want tests and the build run on every pull request.

**Architecture review**
- Pipeline with a PostgreSQL service container; steps: install, type-check, test, build frontend.

**Subtasks**
1. Choose the CI tool and write the workflow.
2. Add the database service and env variables.
3. Require it to pass before merge.

### E12-S3 Deployment and operations (Planned)
**Description:** As ops, I want a production deployment with backups and monitoring.

**Architecture review**
- Single container (Express serving the built frontend) + managed PostgreSQL; `/api/health` for the load balancer; secrets from the environment.
- Needs: migration run on deploy, backup schedule, log retention.

**Subtasks**
1. Dockerfile and environment documentation.
2. Migration step on release.
3. Database backups and a restore test.
4. Basic logs and alerts.

---

## E13. Enhancements (backlog)

**Description:** Improvements identified from the known limitations. Not built yet.

**Benefits:** better privacy, traceability and resilience, and less manual work.

**Acceptance criteria:** each story is accepted on its own; none should change the policy results without an update to policies.md and the golden tests.

### E13-S1 Per-manager data scoping
**Description:** As a manager, I want to see only my team, because today any signed-in user sees everyone.

**Architecture review**
- Filter in the API (never only in the UI) using `req.userEmail` and the roster manager email; HR and superadmin remain unscoped.
- Consider multi-level hierarchies and a delegate.

**Subtasks**
1. Define the scoping rules with HR.
2. Apply them in the attendance, Wednesday, audit and export queries.
3. Tests per role.

### E13-S2 Audit trail
**Description:** As compliance, I want a record of who uploaded, adjusted, overrode or deleted what.

**Architecture review**
- Append-only `activity_log` written by a shared helper in routes or services (user, action, target, before/after, time).
- A read-only page for HR/superadmin.

**Subtasks**
1. Table and the helper.
2. Hook it into uploads, adjustments, overrides, deletes and admin changes.
3. Viewer page and filters.

### E13-S3 Break-glass access
**Description:** As an admin, I want a process for when Okta is down.

**Architecture review**
- Any non-Okta login weakens security; prefer a documented procedure (temporary demo mode behind the network, or a rotation-protected local account).

**Subtasks**
1. Decide the approach with security.
2. Implement and document it.

### E13-S4 Session renewal
**Description:** As a user, I want sessions to renew without a redirect.

**Architecture review**
- Enable refresh tokens in Okta and in the client; handle third-party-cookie limits.

**Subtasks**
1. Ask Okta to enable refresh tokens.
2. Configure the client and test.

### E13-S5 Recompute weekly and monthly after an adjustment
**Description:** As HR, I want all three flags to reflect my adjustments.

**Architecture review**
- Move the week and month evaluation so it can run over adjusted rows on read, or run a targeted recompute for one employee.
- Must keep parity with the engine for unadjusted rows (golden tests).

**Subtasks**
1. Refactor the policy functions to take rows as input.
2. Apply them after `applyAdjustments`.
3. Update policies.md and the tests.

### E13-S6 Email alias matching
**Description:** As a manager, I want sign-in to work when my roster email differs from my Okta login.

**Architecture review**
- Add an alias list or use the `username` column systematically; keep exact matching as the default for safety.

**Subtasks**
1. Decide where aliases are managed.
2. Extend the lookup and the Access page.

### E13-S7 Automatic reprocess or out-of-date badge
**Description:** As HR, I want to know, or not have to care, when holidays and leaves change a processed month.

**Architecture review**
- Store `processed_at` on a month and compare it with the latest holiday or leave change; show a badge, or trigger a background reprocess.

**Subtasks**
1. Add `processed_at` and a "last input change" timestamp.
2. Badge and one-click reprocess.

### E13-S8 Last-day-of-month handling
**Description:** As HR, I want the last day of the month counted once the next month's data exists.

**Architecture review**
- Today the last-day visit is skipped (Python parity). Option: on processing, if the next month's movement exists, use it to pair the checkout. Needs a policy decision and golden file updates.

**Subtasks**
1. Agree the rule with the policy owner.
2. Implement and update the golden tests.

### E13-S9 Notifications and trends
**Description:** As HR, I want monthly summaries sent to managers, and trends across months.

**Architecture review**
- A scheduled job (or an external scheduler) plus an email service; trends are queries across months by department, manager and shift.

**Subtasks**
1. Choose the email service.
2. Summary template and schedule.
3. Trend queries and a dashboard tab.
