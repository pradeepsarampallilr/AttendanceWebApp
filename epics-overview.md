# Epics and Stories: Attendance Reconciliation (Script + Web Application)

Built from the current code: the version-1 Python script ([Attendace-Reconciliation-Engine](https://github.com/pradeepsarampallilr/Attendace-Reconciliation-Engine.git),
`attendance_engine.py`) and the web application in `AttendaceWebApp/` (React, Express, PostgreSQL, Okta).
Where the script and the web engine differ, both are described (see "Script vs web engine" at the end).

| # | Epic | Where |
|---|---|---|
| 1 | Attendance Reconciliation Script (version 1) | Python script |
| 2 | Attendance Engine (web version) | `backend/src/engine`, `services/process.ts` |
| 3 | Upload and Data Management Dashboard | `/upload` page |
| 4 | Attendance Dashboard and Reporting | `/dashboard` and `/audit` pages, Excel export |
| 5 | Wednesday Attendance Dashboard | `/wednesday` page |
| 6 | Access Control and Okta Sign-in | `AuthGate`, `auth.ts`, `/access` page |

---

## Epic 1: Attendance Reconciliation Script (version 1)

A command-line Python script (pandas + openpyxl) that reads the raw door-access movement report, pairs every check-in with a checkout, adds
shift and email details from a roster, and writes an Excel workbook with an Attendance sheet and an Audit Log sheet. It was the first
version and the source of the business rules that the web engine now follows.

| # | Story |
|---|---|
| 1.1 | **Read the movement report.** As an HR analyst, I can give the script a CSV or Excel movement report. It finds the real header row by looking for `empcode` in the first 15 rows, so title rows or blank rows at the top of the export do not break it. If the header is missing, it stops with a clear error. |
| 1.2 | **Clean and group swipes.** The script normalises employee IDs (`"158920"`, `158920.0` and `" 158920 "` all become one ID) and combines each date and time into a full timestamp. It then groups every employee's check-ins and check-outs into sorted lists. Duplicate timestamps are removed. |
| 1.3 | **Pair check-ins with checkouts.** Each check-in gets the earliest unused checkout that is later than it, before the next check-in, on the same or the next day, and no more than 18 hours away (`MAX_SHIFT_HOURS`). This is conservative on purpose: a wrong pairing is worse than a blank. |
| 1.4 | **Handle missing and orphan swipes.** A check-in with no valid checkout stays in the report with a blank checkout and hours, and is logged. A checkout that no check-in can use is excluded from Attendance and logged as an orphan checkout. |
| 1.5 | **Enrich with the shift roster.** If a roster file is supplied, each visit gets the employee's name, email and shift timing. Employees who are not in the roster are still reported and logged in the audit sheet. |
| 1.6 | **Overnight work dates.** For an overnight shift such as `4:00 PM - 1:30 AM`, a post-midnight check-in before the shift end belongs to the previous work date, so a night shift is not split over two days. The original check-in time is not changed. |
| 1.7 | **Previous-month carry-over.** I can optionally supply last month's report. Only its final transaction date is loaded, and only to pair a check-in on the last day with a checkout on the first day of the new month. Visits that started last month are left out of the current month's totals. |
| 1.8 | **Month-end fallback checkout.** If the report ends with a check-in that has no checkout, and the employee is on an overnight roster shift, the script uses the next day's roster shift end as an estimated checkout (for example, 31 August check-in for `4:30 PM - 1:30 AM` gets 1 September 1:30 AM). Day shifts and earlier dates are never estimated. |
| 1.9 | **Hours and daily totals.** Each visit's hours are the checkout minus check-in, rounded to 2 decimals. Visits are grouped by employee and work date. The daily total is written on the first row of the group and merged across it in Excel, while every visit row is kept. |
| 1.10 | **Excel report and audit log.** The script writes one workbook. The Attendance sheet has name, ID, email, shift, year, month, week, check-in, checkout, hours, date and daily total, with styled headers. The Audit Log lists every skipped, blank or unresolved item with employee, issue, details and time. |
| 1.11 | **Interactive run.** Running `python3 attendance_engine.py` asks for the current report, the optional previous report, the optional roster and the output name (with a default name from the data). |
| 1.12 | **Developer documentation.** The README gives a one-page mental model, the pairing rules, the safe places to change a rule and a test checklist (same-day, overnight, missing checkout, orphan checkout, month boundary, employee not in roster). |

---

## Epic 2: Attendance Engine (web version)

The same reconciliation logic, rewritten in TypeScript as a pure module of the Express backend and extended with the company attendance policy
(7-hour days, 3 office days a week, every Wednesday, monthly average). It runs on data stored in PostgreSQL and produces attendance rows,
audit issues and Wednesday attendance for a month. Results are checked against the Python script for July and August (golden tests).

| # | Story |
|---|---|
| 2.1 | **Pair swipes into visits.** Per employee, each check-in is matched with a checkout on the same day or the next day, no more than 20 hours later. A check-in followed by another check-in becomes an open visit with no hours. A checkout with no check-in is ignored and logged. |
| 2.2 | **Assign each visit to a work day.** Normal shifts use the check-in date. For overnight shifts, a check-in after midnight up to shift end + 60 minutes belongs to the previous day. With no shift on file, an employee with mostly evening check-ins is treated as 18:00 to 06:00 and the engine logs it. |
| 2.3 | **Calculate hours.** Visit hours are rounded to 2 decimals using round-half-even, to match Python exactly. The daily total sums closed visits only. A day with a closed and an open visit is flagged as partial. The month total sums the daily totals. |
| 2.4 | **Month boundaries.** The last day of the previous month's swipes is loaded for pairing only. Visits that started in the previous month are dropped. A visit on the last day of the month is skipped and logged, because its checkout may be in next month's file. |
| 2.5 | **Parse the roster.** The engine reads the override or base shift, parses shift text (`9:00 AM - 6:30 PM`, `12:xx` handling), and resolves each manager's email by matching the manager's name to another employee in the roster. Unresolved managers are reported in one audit issue. |
| 2.6 | **Eligibility.** Employees on the general shift (9:00 AM - 6:30 PM) are exempt and get NA for all compliance values. Everyone else, including employees with no shift, is evaluated. |
| 2.7 | **Daily, weekly and monthly compliance.** Daily is Yes at 7.0 hours or more. Weekly (fixed 7-day blocks) needs 3 days of 7+ hours and every working Wednesday. The requirement drops when holidays or a short last block leave fewer working days. Monthly needs an average of 7.0 hours per working day (weekdays minus holidays minus the employee's leaves) and every week compliant. |
| 2.8 | **Audit issues.** Seven issue types are stored for each month: missing checkout, orphan checkout, partial daily total, skipped month boundary, inferred overnight pattern, no roster match and manager email unresolved. |
| 2.9 | **Process a month.** `POST /api/months/:ym/process` loads swipes, roster, holidays and leaves, runs the engine, and replaces the month's rows, issues and Wednesday records in one transaction. Manual adjustments, overrides, holidays and leaves are kept. It returns 404 if the movement file or the roster is missing. |
| 2.10 | **Parity and tests.** Golden tests compare the output with the Python results for July and August, so any change to a rule shows up as a test failure that must be reviewed. |

---

## Epic 3: Upload and Data Management Dashboard

The `/upload` page where HR loads and maintains everything the engine needs: the roster, the monthly movement file, the transport list, public
holidays and employee leaves. It also shows which months are ready and lets HR process or delete them.

| # | Story |
|---|---|
| 3.1 | **Upload roster, movement and transport files.** HR can drop a CSV or XLSX on a card for each file kind. The file is validated first (type, header, rows); the latest roster and transport files replace the old ones, and a movement file replaces only its own month. |
| 3.2 | **Clear validation errors.** If a file is wrong (missing columns, no employees, no swipes, bad dates) HR sees a specific message, and nothing is saved. |
| 3.3 | **Download blank templates.** Each upload card offers a template with the expected column headers. |
| 3.4 | **Months list and status.** HR sees every month with its status (uploaded, processed) and can pick one; the choice carries to all pages. |
| 3.5 | **Process or delete a month.** One button runs the engine for the selected month. Deleting a month removes its processed data and uploads, behind a confirmation. |
| 3.6 | **Upload history.** HR sees a list of all uploads with kind, file name and time. |
| 3.7 | **Public holiday calendar.** HR marks holidays for the month on a calendar. They reduce working days and relax the weekly requirement. A note says the month must be reprocessed to update the compliance values. |
| 3.8 | **Leave management.** HR can search an employee and add or remove their leave days on a calendar, or upload a leaves file (flexible column names, Excel or ISO dates, row numbers in errors). Leaves reduce that employee's working days for the month. |
| 3.9 | **Transport opt-in.** After a transport file is uploaded, processed months show the transport flag at once, without reprocessing. |

---

## Epic 4: Attendance Dashboard and Reporting

The `/dashboard` and `/audit` pages. HR and managers use them to review a processed month by employee, manager, full ledger and directory, correct
hours where needed, check data problems and export the result to Excel.

| # | Story |
|---|---|
| 4.1 | **Summary cards and filters.** The dashboard shows total employees, daily hours entries, total hours logged and check-in sessions for the month. It can be filtered by monthly compliance, week, weekly compliance and transport opt-in. |
| 4.2 | **Employee tab.** I can pick an employee and see each day's visits, daily total and compliance flag, with open visits and adjusted rows clearly marked, together with their weekly and monthly compliance. |
| 4.3 | **Manager tab.** I can pick a manager and see their team's hours and compliance, and jump from a team member to that employee's detail. |
| 4.4 | **Ledger tab.** I can see every attendance row of the month in one searchable table. |
| 4.5 | **Directory tab.** I can see the employee list with department, shift, manager and transport opt-in, and jump to an employee's details. |
| 4.6 | **Adjust daily hours.** HR can add, edit or delete one employee's hours for a day (0 to 24). The change is stored separately from the engine result, the daily flag is recomputed, and the row is marked `add`, `edit` or `delete`. HR can undo it to restore the engine value. Weekly and monthly flags stay as the engine computed them. |
| 4.7 | **Audit Log page.** I can see all data issues for the month, filter them by type and search by employee, to find out why a number looks wrong. |
| 4.8 | **Excel export.** I can download the month as an .xlsx file that includes adjustments, using my sign-in (an authenticated download, not a plain link). |
| 4.9 | **Loading, empty and error states.** Every tab and page shows a clear state while data loads, when there is none, and when a call fails. |

---

## Epic 5: Wednesday Attendance Dashboard

The `/wednesday` page for the policy rule that everyone should be in the office on Wednesdays. It shows who attended each Wednesday, how the
turnout compares with the 75% target, and lets HR correct individual entries.

| # | Story |
|---|---|
| 5.1 | **Wednesday matrix.** HR sees every employee against every Wednesday of the month, marked attended or not. Attended means the employee has a work day on that date, with any hours. |
| 5.2 | **Turnout against target.** The page shows the turnout for each Wednesday against the 75% target, the headcount per date, and the peak and lowest dates. |
| 5.3 | **Attendance tiers.** Employees are grouped as Perfect (all Wednesdays), High (75% or more), Moderate (50% or more), Low or Zero, with the average days attended, total footfall and the distribution of days. |
| 5.4 | **Override an entry.** HR can mark one person present or absent for one Wednesday, or clear the override. Overrides are stored apart from the engine data and survive reprocessing. |
| 5.5 | **Holiday handling.** Holiday Wednesdays are not required and not counted. Holiday edits show on this page at once, without reprocessing. |
| 5.6 | **Estimated hours.** Each attended Wednesday is credited as an estimated 8.0 office hours for the summary figures. |

---

## Epic 6: Access Control and Okta Sign-in

Sign-in and authorisation for the whole application. Okta proves who the user is (OIDC with PKCE); the `app_users` table decides whether that
person may use the app and what role they have (superadmin, HR or manager).

| # | Story |
|---|---|
| 6.1 | **Single sign-on.** Users who are not signed in are sent to Okta and returned to the page they asked for. Tokens are kept in the browser session and renewed automatically. |
| 6.2 | **Access denied and sign-in failed screens.** A valid Okta user who is not in `app_users` sees an Access denied screen showing the email that was refused. A bad or expired token shows Sign-in failed with a retry. |
| 6.3 | **Protected API.** Every API call except `/api/health` must carry a valid token (signature, issuer, audience, expiry). The user is looked up on each request, so changes take effect at once. |
| 6.4 | **Managers follow the roster.** Each roster upload rebuilds the manager users from the manager emails in the file. A manager who is no longer in the roster loses access on the next upload. HR and superadmin rows are never touched. |
| 6.5 | **Manage HR users.** The superadmin has an Access page to list users and add or remove HR users (with an optional username). Duplicates and invalid emails are rejected. Managers are read-only here. |
| 6.6 | **Sign out.** Signing out clears the local session and ends the Okta session, so the user is not signed straight back in. |
| 6.7 | **Flexible Okta setup.** The app works with the Okta default or custom server (access token) or the org server (ID token), and can match on the login, the email or both. |
| 6.8 | **Demo mode.** With Okta settings empty, the app runs without sign-in for local use. |
| 6.9 | **Go-live checklist and bootstrap.** The superadmin is created with a documented SQL insert, and the Okta team has a handover checklist. The live test against a real Okta tenant is still to be done. |

---

## Script vs web engine

| Topic | Script (version 1) | Web engine |
|---|---|---|
| Longest check-in to checkout | 18 hours | 20 hours |
| Overnight work date | Check-in after midnight, before the roster shift end | Up to shift end + 60 minutes |
| End of the month | Estimates a checkout from the roster for an overnight shift | Skips the last-day visit and logs it |
| Next-day pairing | Earliest unused checkout before the next check-in | Pairs in time order; a check-in followed by a check-in is an open visit |
| Compliance policy | None (hours only) | Daily, weekly, monthly and Wednesday rules |
| Input and output | Console prompts, Excel file | Browser uploads, database, dashboards, Excel export |
| Excel layout | Daily total merged across the group's rows | Plain rows (merged cells are inconvenient for later editing) |

Confirm these differences are intended before presenting them: the web engine is the one the golden tests and policies.md describe.
