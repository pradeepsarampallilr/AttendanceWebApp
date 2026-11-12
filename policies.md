# Attendance policies and engine rules

Every rule the engine applies, in the order the data flows through it. The file for each rule is named so you can check
it. If you change a rule, update this file too. The same rules are served live to the Welcome page by
[backend/src/engine/rules.ts](backend/src/engine/rules.ts) (`GET /api/rules`), which shows the currently configured values.

## Quick reference

The first five values are **settings**: HR / superadmin change them on the Configuration page (stored in
`app_settings`, loaded at start-up, limits in [backend/src/services/settings.ts](backend/src/services/settings.ts)).
The defaults are shown.

| Rule | Default | Allowed | Setting |
|---|---|---|---|
| Full-day hours threshold | **7 hours** | 1-24 | `compliantMinHours` |
| Office days per week | **3** | 1-5 | `weeklyOfficeDays` |
| Anchor day | **Wednesday** | Monday-Friday | `anchorWeekday` |
| Check-in / check-out buffer (overnight shifts) | **60 minutes** | 0-360 | `dayAttributionBufferMin` |
| Longest check-in to checkout | **20 hours** | 1-48 | `maxShiftHours` |

Fixed rules:

| Rule | Value | Where |
|---|---|---|
| General shift (not evaluated) | starts **9:00 AM**, ends **6:00-6:30 PM** | `isGeneralShift` in `engine/policy.ts` |
| Required office days in a week | **min(office days, office days - off days)**, never more than the weekdays available | `evaluateWeek` in `engine/policy.ts` |
| Month target | **every evaluated week** is compliant | `evaluateMonth` in `engine/policy.ts` |
| Weeks | **calendar weeks**, Monday to Sunday | `weekStart`, `calendarWeek` in `engine/core.ts` |
| Anchor-day hours credit (dashboard) | **8.0 hours** per attended anchor day | `HOURS_PER_DAY` in `frontend/src/lib/anchorAttendance.ts` |

Changing a setting does not alter processed months: reprocess the month to apply it.

---

## 1. Inputs

A month cannot be processed without a roster and that month's movement file.

| Input | Required | How it is used |
|---|---|---|
| **Roster** | yes (latest upload replaces the old one) | Shift, department, manager and email for each employee; also creates the logins |
| **Movement (door swipes)** | yes, one per month (a re-upload for the same month replaces it) | The raw check-in and checkout times |
| **Transport** | no (latest upload replaces the old one) | Transport opt-in flag on each attendance row |
| **Public holidays** | no, set per month on the Upload page, each with a description | Lower everyone's weekly requirement |
| **Leaves** | no, uploaded as a file or set per employee on the calendar | Lower that employee's weekly requirement |

Only HR and superadmin can upload. Downloadable Excel templates for each file are at `GET /api/templates/:kind`.

### 1.1 Roster rules (`engine/roster.ts`, `io/tables.ts`)

- The header must have the expected columns, otherwise the upload is rejected.
- A row without an employee ID or a name is skipped. The employee ID is the number in `Emplid`, decimal part dropped.
- Email is stored in lower case.
- **Shift choice:** the *Current Shift Timing* (override) is used when present, otherwise *Shift Timing*.
- **Shift text** must be two times split by `to`, `-` or `–`, like `9:00 AM - 6:30 PM`. `12:xx AM` is hour 0 and
  `12:xx PM` is hour 12. If it cannot be read, the employee has **no shift**.
- **Manager email** is not in the roster. It is found by matching the manager's *name* (case-insensitive) to an
  employee in the same roster. Managers that cannot be found are left blank and listed in one audit issue
  (*Manager email unresolved*).
- Uploading a roster also rebuilds the reporting lines and the logins (see [authentication.md](authentication.md)).

### 1.2 Movement file rules (`engine/movement.ts`, `io/tables.ts`)

- The header row is found by looking for `EmpCode` in column B within the first 10 rows. Without it the upload is rejected.
- A row counts only if `EmpCode` is a whole number and `TransDate` looks like `DD-MM-YYYY`. Other rows are ignored.
- From column G onward the time cells alternate **In 1, Out 1, In 2, Out 2, ...** (`HH:MM:SS`). Empty or badly formatted
  cells are skipped, but the alternation still follows the column position.
- All swipes of an employee are sorted by time.
- **The month of the file** is the month with the most swipes.
- **Earlier data:** when a month is processed, the swipes stored from before it are loaded back to the day before the
  Monday of its first week. They are used so that week's early days count and a night shift can pair across midnight.

### 1.3 Leaves file rules

- Required columns: Employee ID and Leave Date. Employee Name and Description are optional. Several header names are
  accepted for the ID (`employee id`, `emplid`, `empcode`, `employee code`, `liveramp employee id`) and the date
  (`leave date`, `date`).
- Dates must be `YYYY-MM-DD` or an Excel date, otherwise the row number is reported in the error.
- Leaves and holidays entered by hand must fall on weekdays inside the month.
- Reprocess the month after changing holidays or leaves.

---

## 2. Pairing swipes into visits (`engine/attribution.ts`: `pairSwipeEvents`)

A **visit** is one check-in matched to one checkout. Going through an employee's swipes in time order:

| Situation | What happens | Audit issue |
|---|---|---|
| Check-in, then a checkout on the **same or next day**, no more than the **longest shift window** (20 h) later | Paired into a visit | none |
| Check-in followed by another check-in | The first becomes an **open visit** (no checkout) | *Missing checkout* |
| Checkout with no check-in before it | Ignored | *Missing checkin* |
| Checkout too late (beyond the next day, or over the window) | Ignored, the check-in stays pending | *Missing checkout* |
| A check-in still pending at the end of the data | Becomes an **open visit** | *Missing checkout* |

An open visit has no hours (`null`). It is kept as a row so it can be seen, but adds nothing to the day total.

---

## 3. Which work day a visit belongs to (`attribution.ts`: `assignWorkDate`, `buildWorkDateGroups`)

1. **Normal shifts:** the work date is the check-in date.
2. **Overnight shifts** (end earlier than start): a check-in **after midnight**, up to **shift end + buffer**
   (60 minutes), belongs to the **previous day**, so one night shift is not split across two dates.
3. **No roster shift but an overnight pattern:** if an employee has no shift and more evening check-ins (17:00 or later)
   than morning check-ins (06:00 to 11:59), an overnight shift (18:00 to 06:00) is assumed and *Inferred overnight
   pattern* is logged.
4. Visits whose work date is before the data window (the first week's Monday, or the 1st) or after the month are dropped.
5. **Month boundary:** a visit on the **last day of the month** is skipped and logged as *Skipped - month boundary*,
   because its checkout may be in next month's data. Its hours are not calculated.
6. All visits with the same work date form a **day group** (an employee can have several visits in a day).

---

## 4. Hours (`attribution.ts`, `engine/core.ts`)

- **Visit hours** = checkout minus check-in, in hours, rounded to **2 decimals**. Open visits have none.
- **Daily total** = sum of the hours of the **closed** visits in the day group. If no visit is closed, it is empty (`null`).
- If a day has both closed and open visits, the total is shown but logged as *Daily total is partial*.
- Times are plain UTC wall-clock values from the swipe file, so there are no time-zone shifts.

---

## 5. Eligibility (`engine/policy.ts`)

| Employee's shift | Eligibility | Compliance |
|---|---|---|
| General shift (starts `9:00 AM`, ends `6:00 PM` to `6:30 PM`) | **No** | all `NA` |
| No shift (not in roster, or unreadable shift) | **NA** | all `NA` |
| Any other shift | **Yes** | evaluated |

Compliance results use three values: **Yes**, **No**, **NA** (not applicable).

---

## 6. Daily compliance (`evaluateCompliance`)

| Condition | Result |
|---|---|
| Not eligible, or the daily total is empty | `NA` |
| Daily total **below** the full-day threshold (7 h) | `No` |
| Daily total **at or above** the threshold | `Yes` |

---

## 7. Weekly compliance (`evaluateWeek`)

Weeks are **calendar weeks**, Monday to Sunday; the `week` number counts within the month (week 1 is the first week
with a weekday in the month). Only weekdays count.

An **attended day** is a day with a daily total at or above the threshold. **Off days** for an employee are the public
holidays **and that employee's leave days**. For one week:

- **Required days** = `max(0, min(office days - off days, weekdays available - off days))`. With the defaults that is
  `min(3, 3 - off days)`.
- The **anchor day** must be an attended day, unless it is an off day or falls outside the data window.
  Its state is `present`, `absent` or `off`.
- The week is `Yes` when the anchor is not `absent` **and** attended days >= required days. Not eligible gives `NA`.

**A week that began last month.** When earlier swipes are stored, the first week is judged from its Monday. Without
them (the very first month) it is judged from the 1st, and the requirement never exceeds the weekdays left in the data.
The month's last day is skipped (section 3), so a week running past the month end is judged up to the day before; it is
judged again with all its data when the next month is processed.

Every calendar week of the month is evaluated for every roster employee, including weeks with no swipes at all (stored
in `weekly_compliance`, shown on the Dashboard's *Weekly Compliance* tab).

Examples: a holiday on Friday makes the requirement 2. Leave on Wednesday and Thursday gives 1, and the Wednesday
anchor is not needed. A week with three off days needs 0.

---

## 8. Monthly compliance (`evaluateMonth`)

The month is `Yes` only when **every evaluated week** in it is `Yes`. Weeks that are not evaluated (`NA`) are ignored;
one `No` week makes the month `No`. Not eligible gives `NA`.

---

## 9. Anchor-day attendance

### 9.1 What the engine records (`services/process.ts`)

- For each roster employee and each anchor weekday of the month, one row is saved: **attended** = the employee has a
  work day on that date (any hours, any open visit).
- This is separate from the hours rule: a short anchor-day visit shows as *attended* here, but does not satisfy the
  weekly condition.
- Everyone in the roster gets a row, including those with no swipes.

### 9.2 Manual override (`PUT /api/months/:ym/anchor-day`)

- HR can mark a person present or absent for one anchor day; `attended: null` clears the override.
- Overrides are stored separately, survive reprocessing, and are applied when the page is read.

### 9.3 Dashboard rules (`frontend/src/lib/anchorAttendance.ts`)

- **Public holidays are excluded**: they are neither required nor counted. They are read live, so holiday edits show
  without reprocessing.
- Each attended anchor day is credited as an estimated **8.0 in-office hours**.
- **Tiers** by days attended out of the working anchor days (rate = days / total):

| Tier | Rule |
|---|---|
| **Perfect** | all working anchor days |
| **High** | rate of 75% or more |
| **Moderate** | rate of 50% or more |
| **Low** | above 0 but under 50% |
| **Zero** | no anchor days attended |

---

## 10. Manual adjustments (`services/adjustments.ts`, `PUT /api/months/:ym/hours`)

HR can change one employee's total for one day. The action is worked out automatically:

| The day has engine rows? | Request | Action |
|---|---|---|
| Yes | hours | `edit` |
| Yes | remove | `delete` (total becomes empty) |
| No (employee has other rows that month) | hours | `add` (creates a row with no swipes) |
| No | remove | rejected (nothing to delete) |
| No rows for the employee in the month | any | rejected (404) |

Rules:

- Hours must be between **0 and 24**; the date must be in the month; an optional note is kept.
- One adjustment per employee per day (a new one replaces the old).
- Adjustments are **stored separately**; engine results are never overwritten. Reverting
  (`DELETE /api/months/:ym/hours/:employeeId/:date`) restores the engine value.
- Only the **day total and the daily Compliant flag** are recomputed (same threshold and eligibility).
  **Weekly and monthly compliance stay as the engine computed them.**
- An `add` is ignored if swipes later appear for that date. An adjustment with no matching data is ignored.
- Adjusted rows carry an `adjustment` marker (`add`, `edit` or `delete`).

---

## 11. Audit issues (`GET /api/months/:ym/audit`)

Every data problem is stored per month, so nothing is silently dropped:

| Issue | Meaning |
|---|---|
| *Missing checkout* | A check-in with no matching checkout (including a checkout outside the window) |
| *Missing checkin* | A checkout with no preceding check-in |
| *Daily total is partial* | A day has a closed visit plus an open one, so the total may be too low |
| *Skipped - month boundary* | A last-day visit was not calculated |
| *Inferred overnight pattern* | An employee with no shift looked like a night worker |
| *No roster match* | Swipes for an ID not in the roster |
| *Manager email unresolved* | Manager names not found in the roster |

An employee who is **not in the roster** still gets attendance rows, using the name from the swipe file, with
eligibility `NA` and department, manager and email blank.

Issues not tied to one employee (id `-`) are visible to HR only. Separately, the **Audit Log** (HR) records who did what:
uploads, processing, edits, holidays, leaves, user changes and settings changes.

---

## 12. Who sees what

| Role | Attendance data |
|---|---|
| Superadmin, HR | Everyone; can change data |
| Manager | Themselves and everyone below them in the reporting chain; read-only |
| Employee | Only themselves; read-only |

Details and the sign-in flow are in [authentication.md](authentication.md).

---

## 13. Processing behaviour (`services/process.ts`)

- **Reprocessing replaces** the month's attendance rows, weekly results, audit issues and anchor-day rows. Manual hour
  adjustments, anchor-day overrides, holidays and leaves are kept.
- **Deleting a month** removes its movement upload, computed output and manual edits; holidays and leaves are kept.
- **Transport opt-in** is refreshed on saved rows whenever a transport file is uploaded, so processed months update
  at once.
- **Anchor-day holiday marks** are read live. Daily, weekly and monthly compliance need a reprocess to change.
- Rows are sorted by employee name, then work date, then check-in time.
- The rules are covered by [backend/test/rules.test.ts](backend/test/rules.test.ts) and
  [backend/test/adjustments.test.ts](backend/test/adjustments.test.ts).

---

## 14. Worked example

An employee on a `10:00 AM - 7:00 PM` shift, default settings, a week with no holidays or leave:

| Day | Visits | Daily total | Daily compliant |
|---|---|---|---|
| Mon | 10:05 to 17:20 | 7.25 | Yes |
| Tue | not in office | none | NA |
| Wed | 10:00 to 16:30 | 6.50 | No |
| Thu | 10:10 to 18:00 | 7.83 | Yes |
| Fri | 10:00 to 17:30 | 7.50 | Yes |

Three days reach 7 hours, but the **Wednesday anchor is under 7**, so **the week is `No`**. Had Wednesday reached 7.0,
the week would be `Yes` (anchor attended, 3 attended days >= 3 required). The month is `Yes` only if every other
evaluated week is `Yes` too.
