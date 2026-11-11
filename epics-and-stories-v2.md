# Attendance Reconciliation: Epics and User Stories

| | |
|---|---|
| **Product** | Attendance Management System (web application) and its predecessor, the Attendance Reconciliation script |
| **Source** | `attendance_engine.py` (version 1) and `AttendaceWebApp/` (React, Express, PostgreSQL, Okta) |
| **Rules reference** | [policies.md](policies.md), [flow.md](flow.md), [authentication.md](authentication.md) |
| **Story format** | User story, behaviour and edge cases, acceptance criteria (Given / When / Then), architecture review (Yes / No with focus), subtasks |

**Architecture review key:** **Yes** = the story involves a design decision, data integrity, security or cross-cutting behaviour and must be reviewed
before or during build. **No** = routine implementation.

## Epic summary

| ID | Epic | Component | Stories | Arch reviews |
|---|---|---|:-:|:-:|
| ATT-E1 | Attendance Reconciliation Script (version 1) | Python script | 12 | 5 |
| ATT-E2 | Attendance Engine (web version) | Backend engine | 10 | 8 |
| ATT-E3 | Upload and Data Management Dashboard | `/upload` | 9 | 2 |
| ATT-E4 | Attendance Dashboard and Reporting | `/dashboard`, `/audit` | 9 | 2 |
| ATT-E5 | Wednesday Attendance Dashboard | `/wednesday` | 6 | 2 |
| ATT-E6 | Access Control and Okta Sign-in | Auth | 9 | 5 |

---

# ATT-E1: Attendance Reconciliation Script (version 1)

**Summary:** Command-line tool that turns a raw door-access report into a reconciled Excel attendance workbook and audit log.

**Description:** HR received monthly movement reports from the access-control system, with one row per employee per day and alternating *In* / *Out*
swipe columns. Turning these into hours by hand was slow and error-prone. The script (pandas + openpyxl) reads the report, pairs each check-in with
a valid checkout, adds roster details, assigns work dates for night shifts, and writes an Attendance sheet and an Audit Log sheet.

**Business value**
- Replaces manual matching with a repeatable, explainable process.
- Nothing is silently dropped: every problem appears in the Audit Log.
- Establishes the business rules that the web engine (ATT-E2) later reuses.

**Scope:** movement report (CSV/XLSX), optional previous-month report, optional roster, Excel output. Console only.
**Out of scope:** compliance policy, users, database, web UI, Google Sheets output.

**Epic acceptance criteria**
- A monthly report produces one workbook with an Attendance and an Audit Log sheet.
- Every check-in is either paired, or kept with a blank checkout and logged.
- Every unusable checkout is logged as an orphan.
- Night shifts are reported on the correct work date.
- Results are stable: the same input gives the same output.

**Dependencies:** access-control export format (`EmpCode` header); roster Excel file.

---

### ATT-1.1 Read the movement report
**User story:** As an HR analyst, I want to supply the raw movement report as CSV or Excel, so that I don't have to clean the export first.

**Behaviour and edge cases**
- Reads `.csv` and `.xlsx`.
- The real header is the row where a column equals `empcode` (case-insensitive), searched in the first 15 rows. Rows above it are discarded.
- No such row: the run stops with a clear error. It never treats a title row as the header.

**Acceptance criteria**
- *Given* a report with three title rows above the table, *when* it is loaded, *then* the data starts at the `EmpCode` row.
- *Given* a file with no `EmpCode` column, *when* it is loaded, *then* the script raises a readable error naming the missing header.

**Arch review:** No
**Subtasks:** 1. File loader for CSV and Excel. 2. Header detection (`HEADER_PROBE`, `MAX_HEADER_SCAN_ROWS`). 3. Error message. 4. Test with title rows.

### ATT-1.2 Clean and group swipes
**User story:** As an HR analyst, I want each employee's swipes normalised and grouped, so that the same person is never split into two.

**Behaviour and edge cases**
- Employee IDs are normalised (`"158920"`, `158920.0`, `" 158920 "` all become `158920`).
- Date and time are combined into one timestamp; unreadable dates or times are skipped and logged.
- Each employee gets sorted lists of check-ins and checkouts; duplicate timestamps are removed.

**Acceptance criteria**
- *Given* the same employee as text in one file and a float in another, *when* grouped, *then* there is one employee entry.
- *Given* two identical swipe times, *when* grouped, *then* only one remains.

**Arch review:** No
**Subtasks:** 1. `normalize_id`, `parse_date`, `parse_time`. 2. Column lookup by header name. 3. Per-employee grouping. 4. Tests for formats.

### ATT-1.3 Pair check-ins with checkouts
**User story:** As an HR analyst, I want every check-in matched to the right checkout, so that hours in the office are correct.

**Behaviour and edge cases**
- A check-in takes the earliest unused checkout that is: later than it; before the employee's next check-in; on the same or next calendar day; and within `MAX_SHIFT_HOURS` (18).
- A checkout is used once only.
- The rules are strict on purpose: no match is better than a wrong match.

**Acceptance criteria**
- *Given* check-in 16:10 and checkout 18:11 the same day, *then* one visit of 2.02 hours.
- *Given* a check-in and a checkout 19 hours later, *then* they are not paired.
- *Given* two check-ins before a single checkout, *then* only the second can use it.

**Arch review:** **Yes**. Focus: pairing rules decide every result; changing `MAX_SHIFT_HOURS` or `_find_checkout()` can create false matches across days.
**Subtasks:** 1. `_reconcile_employee`. 2. `_find_checkout` constraints. 3. `MAX_SHIFT_HOURS` setting. 4. Unit tests for the four rules.

### ATT-1.4 Handle missing and orphan swipes
**User story:** As an HR analyst, I want unmatched swipes kept visible, so that I can follow up instead of losing data.

**Behaviour and edge cases**
- Check-in without a valid checkout: visit stays, checkout and hours blank, audit entry *No matching checkout*.
- Checkout not used by any check-in: excluded from Attendance, audit entry *Orphan checkout*.
- No hours are invented.

**Acceptance criteria**
- *Given* a check-in with no later swipe, *then* the row exists with blank hours and an audit entry.
- *Given* a leading checkout with no check-in, *then* it is absent from Attendance and present in the Audit Log.

**Arch review:** **Yes**. Focus: audit completeness; the conservative "leave blank" policy.
**Subtasks:** 1. `AuditEntry` model. 2. Missing and orphan detection. 3. Audit sheet rows. 4. Tests.

### ATT-1.5 Enrich with the shift roster
**User story:** As an HR analyst, I want name, email and shift added to each visit, so that the report can be filtered and shared.

**Behaviour and edge cases**
- Optional roster (Excel) mapped by employee ID into `ShiftRecord`.
- Employee not in the roster: the visit is kept with blank roster fields and an audit entry.

**Acceptance criteria**
- *Given* a roster, *then* each matching visit shows email and shift timing.
- *Given* an ID missing from the roster, *then* an audit entry names that ID.

**Arch review:** No
**Subtasks:** 1. Roster loader. 2. `_enrich_with_roster`. 3. Missing-employee audit entry.

### ATT-1.6 Overnight work dates
**User story:** As an HR analyst, I want night-shift visits reported on the day the shift started, so that one shift is not split over two dates.

**Behaviour and edge cases**
- For an overnight roster shift (e.g. `4:00 PM - 1:30 AM`), a check-in after midnight and before shift end belongs to the previous date.
- The stored check-in timestamp is not changed; only the reporting date is.
- Day shifts and later check-ins keep their own date.

**Acceptance criteria**
- *Given* a `4:00 PM - 1:30 AM` shift, *when* check-in is `2026-08-04 00:52`, *then* the work date is `2026-08-03`.
- *Given* `2026-08-04 15:42`, *then* the work date is `2026-08-04`.

**Arch review:** **Yes**. Focus: the work date drives daily totals and merging; the shift end is the cut-off.
**Subtasks:** 1. Shift parser. 2. `_work_date` rule. 3. Tests around midnight and the shift end.

### ATT-1.7 Previous-month carry-over
**User story:** As an HR analyst, I want last month's final day considered, so that a check-in on the last evening can pair with the checkout on the first morning.

**Behaviour and edge cases**
- Optional previous report: only its last transaction date is loaded, and its events are placed before the current events.
- Used for pairing only; visits that start in the previous month are excluded from current-month output.

**Acceptance criteria**
- *Given* a check-in 31 July 22:00 and checkout 1 August 06:00, *then* they pair, and the visit is not in the August output.

**Arch review:** **Yes**. Focus: double counting and month ownership of hours.
**Subtasks:** 1. `allowed_dates` filter in `_extract_events`. 2. Merge order. 3. Drop previous-month visits. 4. Test.

### ATT-1.8 Month-end fallback checkout
**User story:** As an HR analyst, I want an estimated checkout for an overnight shift on the last day, so that the final night shift isn't left blank.

**Behaviour and edge cases**
- Applies only when: check-in is on the last transaction date, checkout is missing, the roster shift parses, and the shift crosses midnight.
- The roster shift end of the next day is used (31 Aug, `4:30 PM - 1:30 AM` gives 1 Sep 01:30).
- Never applied to day shifts or to earlier dates. The value is an estimate, not a swipe.

**Acceptance criteria**
- *Given* the case above, *then* checkout is 1 Sep 01:30. *Given* a day shift, *then* the checkout stays blank.

**Arch review:** **Yes**. Focus: policy on estimated data; the web engine chose differently (see the comparison table).
**Subtasks:** 1. `_fill_month_end_overnight_checkouts`. 2. Guard conditions. 3. Marking or logging of the estimate. 4. Tests.

### ATT-1.9 Hours and daily totals
**User story:** As an HR analyst, I want hours per visit and a total per day, so that I can see time spent in the office.

**Behaviour and edge cases**
- Visit hours = checkout minus check-in, rounded to 2 decimals.
- Visits are grouped by employee and work date. The total goes on the first row; later rows are blank; Date and Daily Total cells are merged in Excel. All visit rows remain.

**Acceptance criteria**
- *Given* visits of 2.02 and 3.50 hours on one date, *then* the daily total is 5.52 on the first row.

**Arch review:** No
**Subtasks:** 1. `hours_in_office`. 2. Group and sum. 3. Merge ranges. 4. Tests.

### ATT-1.10 Excel report and audit log
**User story:** As an HR analyst, I want one workbook with attendance and issues, so that I can review and share the result.

**Behaviour and edge cases**
- Attendance sheet columns: name, ID, email, shift, year, month, week, check-in, checkout, hours, date, daily total.
- Audit Log columns: employee ID, name, issue, details, timestamp.
- Styled headers and date formats (`openpyxl`).

**Acceptance criteria**
- *Given* a run, *then* the file has both sheets and column order matches `OUTPUT_COLUMNS` and `AUDIT_COLUMNS`.

**Arch review:** No
**Subtasks:** 1. DataFrames from `as_row()`. 2. Writer and styling. 3. Column-order test.

### ATT-1.11 Interactive run
**User story:** As an HR analyst, I want to run the script and answer prompts, so that I don't edit code for each month.

**Behaviour and edge cases**
- Prompts: current report (required), previous report (optional), roster (optional), output name (default derived from the data).

**Acceptance criteria**
- *Given* only the required file, *then* a workbook is produced with no roster fields.

**Arch review:** No
**Subtasks:** 1. `_prompt_path`. 2. Default file name. 3. `main()`.

### ATT-1.12 Developer documentation
**User story:** As a developer, I want a README with the mental model and change points, so that I can change a rule safely.

**Behaviour and edge cases:** covers runtime order, the five key methods, safe customisation points, risky changes and a test checklist.

**Acceptance criteria:** a new developer can find where to change a rule and which tests to run.

**Arch review:** No
**Subtasks:** 1. Write the README. 2. Keep it in sync with the code.

---

# ATT-E2: Attendance Engine (web version)

**Summary:** Pure TypeScript engine that reconciles swipes and applies the attendance policy for a whole month.

**Description:** The version-1 logic was ported to the Express backend as a module with no database access (`backend/src/engine`), and the company policy
was added: a day counts at 7.0 hours, a week needs 3 office days including every working Wednesday, and a month needs an average of 7.0 hours per working
day. A processing service loads the stored data, runs the engine and saves rows, audit issues and Wednesday records in one transaction.

**Business value**
- Consistent policy decisions for every employee.
- Same numbers as the script, proven by golden tests.
- A pure module is easy to test and to change safely.

**Scope:** pairing, work-day assignment, hours, eligibility, compliance, audit issues, month processing.
**Out of scope:** UI (ATT-E3 to ATT-E5), manual edits (ATT-4.6), authentication.

**Epic acceptance criteria**
- July and August outputs match the Python results.
- Compliance follows [policies.md](policies.md) exactly.
- Reprocessing never loses manual data.
- Every data problem becomes an audit issue.

**Dependencies:** roster, movement file, holidays, leaves (ATT-E3).

---

### ATT-2.1 Pair swipes into visits
**User story:** As HR, I want swipes paired into visits, so that hours can be calculated automatically.

**Behaviour and edge cases**
- Per employee, in time order. A checkout on the same or next day, up to 20 hours later, pairs.
- Check-in followed by check-in: the first is an open visit with no hours (*Missing checkout*).
- Checkout with no check-in, or too late: ignored (*Orphan checkout*).
- A check-in still pending at the end becomes an open visit.

**Acceptance criteria**
- *Given* 22:00 and 05:00 the next day, *then* one visit. *Given* a 21-hour gap, *then* no pair and two audit issues.

**Arch review:** **Yes**. Focus: state machine and the 20-hour limit (the script used 18); pure function, typed input and output.
**Subtasks:** 1. `pairSwipeEvents`. 2. Issue emission. 3. Unit tests for edges. 4. Align the limit with the policy owner.

### ATT-2.2 Assign each visit to a work day
**User story:** As HR, I want each visit on the correct work date, so that night shifts count once.

**Behaviour and edge cases**
- Normal shift: check-in date. Overnight shift: a check-in after midnight up to shift end + 60 minutes belongs to the previous day.
- No shift and more evening (17:00+) than morning (06:00 to 11:59) check-ins: treated as 18:00 to 06:00 and logged *Inferred overnight pattern*.
- Visits sharing a work date form a day group.

**Acceptance criteria**
- *Given* a `4:00 PM - 1:30 AM` shift and a 02:15 check-in, *then* it belongs to the previous day (within the 60-minute buffer).

**Arch review:** **Yes**. Focus: buffer value, inference heuristics, UTC clock handling (no time-zone shifts).
**Subtasks:** 1. `assignWorkDate`. 2. `buildWorkDateGroups`. 3. Inference rule. 4. Boundary tests.

### ATT-2.3 Calculate hours
**User story:** As HR, I want hours calculated exactly as the script did, so that totals match.

**Behaviour and edge cases**
- Visit hours to 2 decimals, ties to even (as Python); `Math.round` would differ.
- Daily total = sum of closed visits, empty if none. Closed plus open visit: total shown and flagged *Daily total is partial*.
- Month total sums daily totals; empty counts as 0.

**Acceptance criteria**
- *Given* a 2.005-hour difference, *then* the result equals Python's `round`.

**Arch review:** **Yes**. Focus: rounding parity and the meaning of null versus 0.
**Subtasks:** 1. Round-half-even helper. 2. Daily and month totals. 3. Partial flag. 4. Parity tests.

### ATT-2.4 Month boundaries
**User story:** As HR, I want month edges handled safely, so that hours are never double counted or lost.

**Behaviour and edge cases**
- Previous month's last day loaded for pairing only; previous-month visits dropped.
- A visit on the last day of the month is skipped and logged *Skipped - month boundary* (its checkout may be in next month's file).

**Acceptance criteria**
- *Given* a last-day visit, *then* no hours and one audit issue. *Given* a night shift from the last day of last month, *then* it pairs but is not counted.

**Arch review:** **Yes**. Focus: policy trade-off (see ATT-1.8); candidate for a future change when the next month's data exists.
**Subtasks:** 1. Load previous last-day swipes. 2. Drop out-of-month visits. 3. Boundary issue. 4. Tests.

### ATT-2.5 Parse the roster
**User story:** As HR, I want shift, department, manager and email read from the roster, so that rules and views use the right data.

**Behaviour and edge cases**
- Override shift wins over base shift. Text like `9:00 AM - 6:30 PM` (also `to`, `-`, `–`); `12:xx AM` is hour 0, `12:xx PM` is hour 12. Unreadable: no shift.
- Manager email resolved by matching the manager's name in the same roster; unresolved names are listed in one audit issue.

**Acceptance criteria**
- *Given* `12:30 AM - 9:00 AM`, *then* start hour 0. *Given* an unknown manager name, *then* email is blank and one issue lists it.

**Arch review:** No
**Subtasks:** 1. Shift parser. 2. Manager resolver. 3. Tests.

### ATT-2.6 Eligibility
**User story:** As a policy owner, I want exempt shifts excluded, so that the policy applies only to the right people.

**Behaviour and edge cases**
- General shift `9:00 AM - 6:30 PM` exactly: exempt, all compliance values `NA`.
- Any other shift, or no shift: evaluated.

**Acceptance criteria**
- *Given* the general shift, *then* daily, weekly and monthly are `NA`.

**Arch review:** **Yes**. Focus: unknown shift treated as eligible is a policy choice to confirm.
**Subtasks:** 1. Eligibility function. 2. Constant `GENERAL_SHIFT_WINDOW`. 3. Tests.

### ATT-2.7 Daily, weekly and monthly compliance
**User story:** As HR, I want Yes / No / NA flags at three levels, so that I can see who meets the policy.

**Behaviour and edge cases**
- Daily: `NA` if not eligible or no total; `No` below 7.0; `Yes` at 7.0 or more.
- Weekly (blocks 1-7, 8-14, 15-21, 22-28, 29-end): `Yes` only if every working Wednesday is attended (7+ hours) and attended days are at least `min(3, working weekdays)`. Holiday Wednesdays are not required. Leaves do not change it.
- Monthly: `Yes` only if hours / working days is at least 7.0 (working days = weekdays - holidays - the employee's leaves; 0 gives `No`) and every evaluated week is `Yes`.

**Acceptance criteria**
- *Given* three 7+ hour days but a 6.5-hour Wednesday, *then* the week is `No`.
- *Given* a short last block of two weekdays, *then* two attended days are enough.

**Arch review:** **Yes**. Focus: fixed 7-day blocks (not calendar weeks), single source for constants, behaviour with holidays and leaves.
**Subtasks:** 1. `evaluateCompliance`. 2. `evaluateWeekCompliance`. 3. `evaluateMonthCompliance`. 4. Worked-example tests.

### ATT-2.8 Audit issues
**User story:** As HR, I want every data problem recorded, so that nothing is dropped silently.

**Behaviour and edge cases:** seven types: missing checkout, orphan checkout, partial daily total, month boundary, inferred overnight, no roster match, manager email unresolved. An employee not in the roster still gets rows (name from the swipe file, manager `NA`, eligible).

**Acceptance criteria**
- *Given* swipes for an unknown ID, *then* rows exist and a *No roster match* issue is saved.

**Arch review:** No
**Subtasks:** 1. Issue types. 2. Fallback names. 3. Persist with the month.

### ATT-2.9 Process a month
**User story:** As HR, I want one action to process a month, so that results update from the latest data.

**Behaviour and edge cases**
- `POST /api/months/:ym/process` loads swipes, roster, holidays, leaves, fallback names and previous last-day swipes, then runs the engine.
- In one transaction: delete and re-insert attendance rows, audit issues and Wednesday rows; refresh transport opt-in.
- Manual adjustments, overrides, holidays and leaves are kept.
- 400 for a bad month; 404 if the movement file or roster is missing.

**Acceptance criteria**
- *Given* an adjustment exists, *when* the month is reprocessed, *then* the adjustment is still applied.
- *Given* a failure mid-way, *then* the old results remain.

**Arch review:** **Yes**. Focus: transaction boundary, synchronous run (may need a job queue at larger sizes), chunked inserts.
**Subtasks:** 1. `process.ts` orchestration. 2. Transaction. 3. Error responses. 4. Reprocess test with adjustments.

### ATT-2.10 Parity and tests
**User story:** As a developer, I want golden tests against the Python output, so that a rule change cannot slip in unnoticed.

**Behaviour and edge cases:** stored July and August expectations; any change to a rule must update them deliberately and update [policies.md](policies.md).

**Acceptance criteria:** the golden suite passes in CI; a changed constant makes it fail.

**Arch review:** **Yes**. Focus: fixture strategy and the "change a rule" process.
**Subtasks:** 1. Capture fixtures from Python. 2. `golden.test.ts`. 3. Document the update process.

---

# ATT-E3: Upload and Data Management Dashboard

**Summary:** The `/upload` page for loading and maintaining the engine's inputs.

**Description:** HR needs to supply a roster, a monthly movement file, an optional transport list, public holidays and leaves, then process a month.
The page gives a card per file kind, a months list with status, upload history, a holiday calendar and a leave calendar.

**Business value:** HR works without developers, bad files are rejected before they affect results, and months can be rerun safely.

**Scope:** file upload and validation, templates, months, holidays, leaves, history. **Out of scope:** results display (ATT-E4).

**Epic acceptance criteria**
- Only .csv and .xlsx files are accepted and validated.
- A failed upload changes nothing.
- The selected month is shared by every page.

**Dependencies:** ATT-E2 (processing), ATT-E6 (sign-in).

---

### ATT-3.1 Upload roster, movement and transport files
**User story:** As HR, I want to upload each file type, so that a month can be processed.

**Behaviour and edge cases**
- `POST /api/uploads` (kind + file). Roster and transport: latest replaces old. Movement: replaces only that month (month inferred as the one with most swipes).
- Roster upload also rebuilds manager users (ATT-6.4). Movement inserts are chunked.
- Everything runs in one transaction.

**Acceptance criteria**
- *Given* a second movement upload for the same month, *then* only the newer swipes remain.
- *Given* a corrupt file, *then* the previous data is untouched.

**Arch review:** **Yes**. Focus: replace semantics, transaction, large-file insert limits.
**Subtasks:** 1. Upload route and `readTable`. 2. Roster, movement, transport handlers. 3. Chunked insert. 4. Tests.

### ATT-3.2 Clear validation errors
**User story:** As HR, I want clear errors for a wrong file, so that I can fix it.
**Behaviour:** wrong type, missing header, no employees, no swipes, bad dates (with the row number) each give a 400 message.
**Acceptance criteria:** *Given* a leaves file with a bad date on row 7, *then* the message names row 7 and nothing is saved.
**Arch review:** No
**Subtasks:** 1. Validators per kind. 2. Error display in the card.

### ATT-3.3 Download blank templates
**User story:** As HR, I want a template per file kind, so that I prepare data correctly.
**Behaviour:** `GET /api/templates/:kind` returns an .xlsx with the expected headers.
**Acceptance criteria:** the template uploads without errors.
**Arch review:** No
**Subtasks:** 1. Template generator. 2. Download button.

### ATT-3.4 Months list and status
**User story:** As HR, I want to see each month's status, so that I know what is ready.
**Behaviour:** `GET /api/months`; selection is kept in the URL and shared by all pages.
**Acceptance criteria:** *Given* a month is picked, *then* every page opens on it.
**Arch review:** No
**Subtasks:** 1. Endpoint. 2. Selector and URL state.

### ATT-3.5 Process or delete a month
**User story:** As HR, I want to run or remove a month, so that I control results.
**Behaviour:** Process calls ATT-2.9. Delete removes the month's processed data and uploads, after a confirmation.
**Acceptance criteria:** *Given* Delete is confirmed, *then* the month disappears; *given* Cancel, nothing changes.
**Arch review:** No
**Subtasks:** 1. Buttons. 2. `ConfirmModal`. 3. Delete endpoint.

### ATT-3.6 Upload history
**User story:** As HR, I want to see past uploads, so that I can trace what was loaded.
**Behaviour:** `GET /api/uploads` lists kind, file name and time.
**Acceptance criteria:** a new upload appears at once.
**Arch review:** No
**Subtasks:** 1. Endpoint. 2. History table.

### ATT-3.7 Public holiday calendar
**User story:** As HR, I want to set holidays for a month, so that policy is relaxed on those days.
**Behaviour:** `GET/PUT /api/months/:ym/holidays` (PUT replaces the set). Holidays reduce working days and the weekly requirement; a note says to reprocess.
**Acceptance criteria:** *Given* a holiday on a Wednesday, *then* that Wednesday is not required after reprocessing.
**Arch review:** No
**Subtasks:** 1. Endpoints. 2. `HolidayCalendar`. 3. Reprocess note. 4. Tests.

### ATT-3.8 Leave management
**User story:** As HR, I want to record employee leaves, so that working days are fair.
**Behaviour:** add, remove or replace per employee, with employee search; or upload a file (aliases like `emplid`, `empcode`, `date`; Excel or ISO dates). Leaves change only the monthly ratio.
**Acceptance criteria:** *Given* 2 leave days, *then* that employee's working days drop by 2 after reprocessing.
**Arch review:** No
**Subtasks:** 1. Endpoints. 2. `LeaveCalendar`. 3. File upload. 4. Tests.

### ATT-3.9 Transport opt-in
**User story:** As HR, I want transport opt-in shown without reprocessing, so that changes appear at once.
**Behaviour:** after a transport upload, `refreshTransportOptIn` updates saved rows of processed months. It is display data only.
**Acceptance criteria:** *Given* a processed month, *when* a transport file is uploaded, *then* the dashboard flag updates immediately.
**Arch review:** **Yes**. Focus: write path outside the normal processing transaction.
**Subtasks:** 1. `refreshTransportOptIn`. 2. Call from upload and process. 3. Test.

---

# ATT-E4: Attendance Dashboard and Reporting

**Summary:** The `/dashboard` and `/audit` pages for reviewing, correcting and exporting a month.

**Description:** After processing, HR and managers use four tabs (Employee, Manager, Ledger, Directory) with summary cards and filters, correct a day's
hours when swipes are wrong, check the Audit Log, and export to Excel.

**Business value:** quick answers about compliance, visible manual changes and a shareable export.

**Scope:** viewing, adjustments, audit page, export. **Out of scope:** per-manager data restriction (backlog).

**Epic acceptance criteria**
- Dashboard data equals the export (same rows, adjustments applied).
- Manual changes are marked and reversible.
- Every page has loading, empty and error states.

**Dependencies:** ATT-E2, ATT-E3.

---

### ATT-4.1 Summary cards and filters
**User story:** As HR, I want totals and filters, so that I can narrow to what matters.
**Behaviour:** cards: total employees, daily hours entries, total hours, check-in sessions. Filters: monthly compliance, week, weekly compliance, transport.
**Acceptance criteria:** *Given* a filter, *then* cards and tabs reflect it.
**Arch review:** No
**Subtasks:** 1. `GET /api/months/:ym/attendance`. 2. Cards and filter bar. 3. Shared helpers in `lib/attendance.ts`.

### ATT-4.2 Employee tab
**User story:** As a viewer, I want one employee's days and flags, so that I can explain their result.
**Behaviour:** daily visits, daily total and flag, open and adjusted rows marked, weekly and monthly compliance.
**Acceptance criteria:** *Given* an open visit, *then* it is marked with no hours.
**Arch review:** No
**Subtasks:** 1. Picker. 2. Day table. 3. Summary.

### ATT-4.3 Manager tab
**User story:** As a manager, I want my team's hours and compliance, so that I can follow up.
**Behaviour:** grouping by manager email; click through to an employee. Currently every signed-in user sees every manager (see backlog).
**Acceptance criteria:** totals equal the sum of the team's rows.
**Arch review:** No
**Subtasks:** 1. Group by manager. 2. Counts. 3. Drill-down.

### ATT-4.4 Ledger tab
**User story:** As HR, I want all rows in one searchable table.
**Behaviour:** all visit rows of the month, with search; pagination if the volume grows.
**Acceptance criteria:** the row count equals the export.
**Arch review:** No
**Subtasks:** 1. Table. 2. Search.

### ATT-4.5 Directory tab
**User story:** As HR, I want an employee directory with department, shift, manager and transport opt-in.
**Behaviour:** list with jump to details.
**Acceptance criteria:** an employee missing from the roster appears with *Unassigned* shift.
**Arch review:** No
**Subtasks:** 1. Table. 2. Jump link.

### ATT-4.6 Adjust daily hours
**User story:** As HR, I want to add, edit or delete a day's hours, so that missed swipes and approved corrections are reflected.
**Behaviour and edge cases**
- `PUT /api/months/:ym/hours`. Action derived: engine rows exist: `edit` or `delete`; no rows but the employee has others that month: `add`; no rows at all: 404.
- Hours 0 to 24; date in the month; one adjustment per employee per day.
- Stored in `manual_adjustments`, applied on read; engine output untouched. Daily flag recomputed; weekly and monthly flags are not.
- An `add` is ignored if swipes later appear for that date. `DELETE .../hours/:employeeId/:date` restores the engine value.

**Acceptance criteria**
- *Given* an edit to 7.5 hours, *then* the daily flag is `Yes` and the row is marked `edit`.
- *Given* the adjustment is undone, *then* the engine value returns.

**Arch review:** **Yes**. Focus: separation from engine data, inconsistency between daily and weekly/monthly flags (known gap), audit trail (backlog).
**Subtasks:** 1. Endpoint and validation. 2. `applyAdjustments`. 3. Edit UI and undo. 4. Marker display. 5. Tests (`adjustments.test.ts`).

### ATT-4.7 Audit Log page
**User story:** As HR, I want to see and filter all issues, so that I can find the cause of a bad number.
**Behaviour:** `GET /api/months/:ym/audit`; filter by type, search by employee.
**Acceptance criteria:** filtering by *Missing checkout* shows only those.
**Arch review:** No
**Subtasks:** 1. Endpoint. 2. Table, filter, search.

### ATT-4.8 Excel export
**User story:** As HR, I want to download the month as Excel, so that I can share or archive it.
**Behaviour and edge cases**
- `GET /api/months/:ym/export.xlsx` built with ExcelJS from the same rows as the dashboard, adjustments included.
- The browser uses `downloadFile` (fetch with Bearer token, then a temporary object URL), because a link cannot send headers.

**Acceptance criteria**
- *Given* a signed-in user, *then* the file downloads with the month in its name. *Given* an expired token, *then* the user is sent to sign in.

**Arch review:** **Yes**. Focus: authenticated download pattern; in-memory build (streaming for very large months).
**Subtasks:** 1. Export service. 2. Headers. 3. `downloadFile`. 4. Test.

### ATT-4.9 Loading, empty and error states
**User story:** As a user, I want clear states, so that I know what is happening.
**Behaviour:** the `useAsync` hook and shared components on every page.
**Acceptance criteria:** a failed call shows an error with a retry.
**Arch review:** No
**Subtasks:** 1. `useAsync`. 2. Empty and error components.

---

# ATT-E5: Wednesday Attendance Dashboard

**Summary:** The `/wednesday` page for Wednesday in-office attendance, turnout against the 75% target and manual overrides.

**Description:** Policy requires Wednesday attendance. On processing, one record per employee per Wednesday is saved. The page shows a matrix, summary
statistics and tiers, and lets HR override a single entry.

**Business value:** leadership sees turnout on the key day; HR records exceptions without changing swipe data.

**Scope:** Wednesday matrix, stats, tiers, overrides, holidays. **Out of scope:** the 7-hour weekly rule (ATT-2.7).

**Epic acceptance criteria**
- Holiday Wednesdays are excluded everywhere on the page.
- Overrides survive reprocessing.
- Figures match the rules in policies.md section 9.

**Dependencies:** ATT-E2, ATT-3.7.

---

### ATT-5.1 Wednesday matrix
**User story:** As HR, I want each employee against each Wednesday, so that I can see attendance at a glance.
**Behaviour:** attended = a work day on that date, any hours (separate from the 7-hour rule). Everyone in the roster has a row, including those with no swipes. `GET /api/months/:ym/wednesday`.
**Acceptance criteria:** *Given* a 3-hour visit on a Wednesday, *then* it shows as attended.
**Arch review:** No
**Subtasks:** 1. Generate rows at processing. 2. Endpoint. 3. Matrix UI.

### ATT-5.2 Turnout against target
**User story:** As leadership, I want turnout against 75%, so that I see whether the target is met.
**Behaviour:** turnout per date, headcount per date, peak and lowest date (first on a tie).
**Acceptance criteria:** *Given* 60 of 80 staff attended, *then* turnout is 75% and the target is met.
**Arch review:** No
**Subtasks:** 1. Stats in `lib/wednesday.ts`. 2. Summary cards.

### ATT-5.3 Attendance tiers
**User story:** As leadership, I want employees grouped by Wednesday attendance.
**Behaviour:** Perfect (all), High (75%+), Moderate (50%+), Low (above 0, under 50%), Zero; average days, footfall, distribution.
**Acceptance criteria:** *Given* 3 of 4 Wednesdays, *then* High.
**Arch review:** No
**Subtasks:** 1. Tier function. 2. Distribution chart. 3. Tests.

### ATT-5.4 Override an entry
**User story:** As HR, I want to set one person present or absent for a Wednesday.
**Behaviour:** `PUT /api/months/:ym/wednesday {employeeId, wednesday, attended}`; `null` removes it. Stored in a separate table and kept on reprocessing.
**Acceptance criteria:** *Given* an override, *when* the month is reprocessed, *then* the override still applies.
**Arch review:** **Yes**. Focus: separation from engine data, precedence rules, audit trail (backlog).
**Subtasks:** 1. Endpoint (upsert and delete). 2. Cell UI. 3. Reprocess test.

### ATT-5.5 Holiday handling
**User story:** As HR, I want holiday Wednesdays excluded, so that nobody is penalised.
**Behaviour:** holidays are read live, so holiday edits show without reprocessing (unlike compliance values).
**Acceptance criteria:** *Given* a Wednesday is marked a holiday, *then* it vanishes from the target maths immediately.
**Arch review:** **Yes**. Focus: live read versus stored results; consistency with the weekly rule until reprocessed.
**Subtasks:** 1. Merge holidays in `wednesdayData`. 2. Exclude in stats. 3. Test.

### ATT-5.6 Estimated hours
**User story:** As leadership, I want an hours estimate, so that summaries show effort.
**Behaviour:** each attended Wednesday credits 8.0 hours (`HOURS_PER_DAY`).
**Acceptance criteria:** 3 attended Wednesdays show 24 estimated hours.
**Arch review:** No
**Subtasks:** 1. Constant. 2. Summary display.

---

# ATT-E6: Access Control and Okta Sign-in

**Summary:** Okta single sign-on plus role-based access held in the `app_users` table.

**Description:** Authentication uses Okta (OIDC Authorization Code with PKCE). Authorisation is separate: an Okta user can enter only if listed in
`app_users` as superadmin, HR or manager. Managers are created from each roster upload, HR are added by the superadmin, and the superadmin is a
database row.

**Business value:** company SSO and MFA, immediate access changes, and no separate passwords.

**Scope:** sign-in, token verification, roles, Access page, sign-out, demo mode. **Out of scope:** per-manager data restrictions (backlog).

**Epic acceptance criteria**
- Not signed in: redirected to Okta. Not in `app_users`: Access denied (403). No or bad token on `/api`: 401.
- Role changes apply on the next request.
- The app runs without Okta when it is not configured.
- Live test on a real Okta tenant is completed (open item).

**Dependencies:** Okta team inputs ([OKTA_INTEGRATION.md](OKTA_INTEGRATION.md)).

---

### ATT-6.1 Single sign-on
**User story:** As a user, I want to sign in through Okta, so that I use my company login.
**Behaviour:** `AuthGate` handles `/login/callback`, redirects when signed out and returns to the requested page. Tokens in `sessionStorage` with auto-renew (blocked renewal falls back to a fresh login).
**Acceptance criteria:** *Given* a signed-out user opening `/dashboard`, *then* after Okta they land on `/dashboard`.
**Arch review:** **Yes**. Focus: PKCE flow, token storage in `sessionStorage` (XSS trade-off), renewal.
**Subtasks:** 1. Okta client config. 2. `AuthGate` states. 3. Callback and return URL. 4. 401 redirect limited to once a minute.

### ATT-6.2 Access denied and sign-in failed screens
**User story:** As a user, I want a clear message when I can't get in.
**Behaviour:** 403 shows Access denied with the refused email and a switch-account option; 401 shows Sign-in failed with a retry.
**Acceptance criteria:** a user not in `app_users` sees the screen with their email.
**Arch review:** No
**Subtasks:** 1. Screens. 2. Retry and sign-out actions.

### ATT-6.3 Protected API
**User story:** As a security owner, I want every API call verified, so that only authorised users get data.
**Behaviour and edge cases**
- Middleware on `/api` except `/api/health`: verify the token with `jose` (signature via cached JWKS, issuer, audience, RS256, expiry).
- Identifiers: `preferred_username`, `email`, `sub` if it has `@`, or the single claim in `OKTA_IDENTITY_CLAIM`.
- Lookup `email IN ids OR username IN ids`, highest role wins; checked on every request.
- Missing token: 401. Not found: 403. Invalid issuer configuration: refuse to start.

**Acceptance criteria**
- *Given* no token, *then* 401. *Given* a valid token for an unlisted user, *then* 403.

**Arch review:** **Yes**. Focus: claim choice, audience, per-request database lookup, caching of keys.
**Subtasks:** 1. Middleware. 2. Identity claim handling. 3. Role lookup. 4. Tests (`auth.test.ts`) plus a signed-token test (open).

### ATT-6.4 Managers follow the roster
**User story:** As HR, I want manager access to come from the roster, so that I don't maintain it twice.
**Behaviour and edge cases**
- Each roster upload replaces all `manager` rows with the distinct, lower-cased manager emails, in the upload's transaction.
- HR and superadmin rows are never touched. A manager removed from the roster loses access after the next upload.
- Exact email matching: an alias will be denied.

**Acceptance criteria:** *Given* a roster with manager `a@x.com`, *then* `a@x.com` can sign in. *Given* a re-upload without them, *then* they get 403.

**Arch review:** **Yes**. Focus: derived access, transaction, alias mismatch risk.
**Subtasks:** 1. `syncManagers`. 2. Call in the roster upload. 3. Migration backfill. 4. Tests.

### ATT-6.5 Manage HR users
**User story:** As a superadmin, I want to add and remove HR users, so that I control who can use the app.
**Behaviour:** Access page (superadmin only), `GET/POST /api/admin/users`, `DELETE /api/admin/users/:email`; only the HR role can be added or removed; duplicates and invalid emails rejected; managers read-only.
**Acceptance criteria:** an HR user added can sign in immediately; a non-superadmin gets 403 on `/api/admin`.
**Arch review:** No
**Subtasks:** 1. Endpoints. 2. `AccessPage`. 3. Validation. 4. Tests.

### ATT-6.6 Sign out
**User story:** As a user, I want to sign out fully, so that nobody reuses my session.
**Behaviour:** clear local tokens first, then end the Okta session with the ID token hint; fall back to `/` on failure.
**Acceptance criteria:** after sign-out, opening the app requires a new login.
**Arch review:** No
**Subtasks:** 1. Sequence. 2. Fallback. 3. Manual test.

### ATT-6.7 Flexible Okta setup
**User story:** As an administrator, I want the app to work with different Okta server types.
**Behaviour:** custom or default server uses the access token (audience `OKTA_AUDIENCE`); the org server uses the ID token (audience = client ID). Detected from the issuer URL on both sides.
**Acceptance criteria:** both setups verify a valid token and reject a wrong audience.
**Arch review:** **Yes**. Focus: org-server access tokens are not meant for third-party APIs; custom server is recommended.
**Subtasks:** 1. Issuer detection. 2. Audience and keys URL per type. 3. Docs.

### ATT-6.8 Demo mode
**User story:** As a developer, I want to run without Okta, so that I can work locally.
**Behaviour:** empty `OKTA_ISSUER` skips the guard with a warning; placeholder values refuse to start.
**Acceptance criteria:** the API answers without a token when Okta is off.
**Arch review:** **Yes**. Focus: the production risk of an accidentally empty setting.
**Subtasks:** 1. Switch logic. 2. Warning log. 3. Startup validation.

### ATT-6.9 Go-live checklist and bootstrap
**User story:** As the project owner, I want a documented go-live path.
**Behaviour:** superadmin by manual SQL insert; checklist: sign in, denied user, no-token 401, roster manager, HR add. Open item: run it against a real Okta tenant.
**Acceptance criteria:** every checklist step passes in the target environment.
**Arch review:** No
**Subtasks:** 1. SQL and steps. 2. Okta handover. 3. Live test and fixes.

---

# Appendix: script versus web engine

| Topic | Script (version 1) | Web engine |
|---|---|---|
| Longest check-in to checkout | 18 hours | 20 hours |
| Overnight work date | After midnight, before the roster shift end | Up to shift end + 60 minutes |
| End of the month | Estimates a checkout from the roster (overnight shifts) | Skips the last-day visit and logs it |
| Compliance policy | None (hours only) | Daily, weekly, monthly, Wednesday |
| Input and output | Console prompts, Excel file | Browser uploads, database, dashboards, Excel export |
| Excel layout | Daily total merged across rows | Plain rows (not verified in `export.ts`) |

# Appendix: backlog (not built)

Per-manager data scoping; audit trail of changes; break-glass sign-in when Okta is down; refresh tokens; recompute weekly and monthly flags after an
adjustment; email alias matching; out-of-date badge or automatic reprocess after holiday and leave edits; counting the last day of the month when
the next month's data exists; CI pipeline and production deployment; notifications and trends.
