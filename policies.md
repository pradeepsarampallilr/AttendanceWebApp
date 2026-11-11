# Attendance policies and engine rules

Every rule the engine applies, in the order the data flows through it. The values come from the code, and the file for
each rule is named so you can check it. If you change a rule, update this file too.

**Quick reference**

| Rule | Value | Where |
|---|---|---|
| Full-day hours threshold | **7.0 hours** | `COMPLIANT_MIN_HOURS` in `engine/core.ts` |
| General shift (not evaluated) | starts **9:00 AM**, ends **6:00-6:30 PM** | `isGeneralShift` in `engine/policy.ts` |
| Required office days per week | **min(3, 3 - public holidays - leaves)** days of 7+ hours, plus the Wednesday anchor | `evaluateWeek` in `engine/policy.ts` |
| Month target | office days attended >= the **sum of every week's requirement** | `evaluateMonth` in `engine/policy.ts` |
| Longest check-in to checkout | **20 hours** | `MAX_SHIFT_DURATION_MS` in `engine/core.ts` |
| Overnight work-day buffer | shift end + **60 minutes** | `DAY_ATTRIBUTION_BUFFER_MIN` in `engine/core.ts` |
| Weeks | **calendar weeks**, Monday to Sunday, ISO week numbers | `weekStart`, `calendarWeek` in `engine/core.ts` |
| Wednesday target (dashboard) | **75%** of staff | `TARGET_RATE` in `frontend/src/lib/wednesday.ts` |
| Wednesday hours credit | **8.0 hours** per attended Wednesday | `HOURS_PER_DAY` in `frontend/src/lib/wednesday.ts` |

---

## 1. Inputs

The engine uses three required files and two optional sources. A month cannot be processed without a roster and that
month's movement file.

| Input | Required | How it is used |
|---|---|---|
| **Roster** | yes (latest upload replaces the old one) | Shift, department, manager and email for each employee |
| **Movement (door swipes)** | yes, one per month (a re-upload for the same month replaces it) | The raw check-in and checkout times |
| **Transport** | no (latest upload replaces the old one) | Transport opt-in flag on each attendance row |
| **Public holidays** | no, picked on the Upload page, each with a description | Lower the weekly requirement for everyone |
| **Leaves** | no, uploaded or picked per employee | Lower that employee's weekly requirement |

### 1.1 Roster rules (`engine/roster.ts`, `io/tables.ts`)
- The header must have the expected columns, otherwise the upload is rejected.
- A row without an employee ID or a name is skipped.
- The employee ID is the number in `Emplid`, with any decimal part dropped.
- Email is stored in lower case.
- **Shift choice:** the *override* shift is used when present, otherwise the *base* shift.
- **Shift text** must be two times split by `to`, `-` or `–`, like `9:00 AM - 6:30 PM`. `12:xx AM` is treated as hour 0 and
  `12:xx PM` as hour 12. If the text cannot be read, the employee has **no shift** (treated as unassigned).
- **Manager email** is not in the roster. It is found by matching the manager's *name* (case-insensitive) with an
  employee in the same roster. Managers that cannot be found are left blank and listed in one audit issue
  (*Manager email unresolved*).
- Uploading a roster also refreshes the list of allowed manager users (the Okta access rules).

### 1.2 Movement file rules (`engine/movement.ts`, `io/tables.ts`)
- The header row is found by looking for `EmpCode` in column B within the first 10 rows. Without it the upload is rejected.
- A row counts only if `EmpCode` is a whole number and `TransDate` looks like `DD-MM-YYYY`. Other rows are ignored.
- From column G onward, the time cells alternate **In 1, Out 1, In 2, Out 2, ...** (`HH:MM:SS`). Empty or badly formatted cells
  are skipped, but the alternation still follows the column position.
- All swipes of an employee are sorted by time.
- **The month of the file** is the month with the most swipes. Uploading another file for the same month replaces it.
- **Previous-month carryover:** only the **last day** of swipes from the stored earlier data is added in front, and only for pairing
  (so a night shift that started on the last day of the previous month can still find its checkout). Visits that
  start in the previous month are never counted as attendance.

### 1.3 Leaves file rules
- Required columns: Employee ID and Leave Date. Name and Description are optional. Several header names are accepted
  (for example `emplid`, `empcode`, `date`).
- Dates must be `YYYY-MM-DD` or an Excel date, otherwise the row number is reported in the error.

---

## 2. Pairing swipes into visits (`engine/attribution.ts`: `pairSwipeEvents`)

A **visit** is one check-in matched to one checkout. Going through an employee's swipes in time order:

| Situation | What happens | Audit issue |
|---|---|---|
| Check-in, then a checkout on the **same day or the next day**, no more than **20 hours** later | Paired into a visit | none |
| Check-in followed by another check-in | The first becomes an **open visit** (no checkout) | *Missing checkout* |
| Checkout with no check-in before it | Ignored | *Orphan checkout* |
| Checkout too late (different day beyond tomorrow, or over 20 hours) | Ignored, the check-in stays pending | *Orphan checkout* |
| A check-in still pending at the end of the data | Becomes an **open visit** | *Missing checkout* |

An open visit has no hours (`null`). It is kept as a row so it can be seen, but it adds nothing to the day total.

---

## 3. Which work day a visit belongs to (`attribution.ts`: `assignWorkDate`, `buildWorkDateGroups`)

1. **Normal shifts:** the work date is the check-in date.
2. **Overnight shifts** (end time earlier than start time): a check-in **after midnight** up to **shift end + 60 minutes**
   belongs to the **previous day**, so one night shift is not split across two dates. Later check-ins keep their own date.
3. **No roster shift but an overnight pattern:** if an employee has no shift and more evening check-ins (17:00 or later) than
   morning check-ins (06:00 to 11:59), the engine assumes an overnight shift (18:00 to 06:00) and logs *Inferred overnight pattern*.
4. Visits that started in the **previous month** are dropped.
5. Visits whose work date is outside the month are dropped.
6. **Month boundary:** a visit on the **last day of the month** is skipped and logged as *Skipped - month boundary*, because its
   checkout may be in next month's data that is not available. Its hours are not calculated.
7. All visits with the same work date form a **day group** (an employee can have several visits in a day).

---

## 4. Hours (`attribution.ts`, `engine/core.ts`)

- **Visit hours** = checkout minus check-in, in hours, rounded to **2 decimals** (ties round to even, matching the original Python
  engine). Open visits have none.
- **Daily total** = sum of the hours of the **closed** visits in the day group. If no visit is closed, the daily total is empty
  (`null`).
- If a day has both closed and open visits, the total is shown but logged as *Daily total is partial* (the real total may be higher).
- **Month total** = the sum of the daily totals (empty counts as 0).

---

## 5. Eligibility (`engine/policy.ts`)

| Employee's shift | Eligibility | Compliance |
|---|---|---|
| General shift (starts `9:00 AM`, ends `6:00 PM` or `6:30 PM`) | **No** | all `NA` |
| No shift (not in roster, or unreadable shift) | **NA** | all `NA` |
| Any other shift | **Yes** | evaluated |

Compliance results use three values: **Yes**, **No**, **NA** (not applicable).

---

## 6. Daily compliance (`evaluateCompliance`)

| Condition | Result |
|---|---|
| Not eligible (eligibility is not `Yes`), or the daily total is empty | `NA` |
| Daily total **below 7.0** hours | `No` |
| Daily total **7.0 or more** | `Yes` |

---

## 7. Weekly compliance (`evaluateWeek`)

**Weeks are real calendar weeks**, Monday to Sunday, numbered with the ISO week number (`week` column). Only weekdays count.

An **attended day** is a day with a daily total of **7.0 hours or more**. Off days for an employee are the public holidays
**and that employee's leave days** (weekdays only). For one week:

- **Required days** = `max(0, min(3, 3 - off days))`. The working days in a week are therefore always 3 at most.
- The **Wednesday anchor** must be an attended day, unless that Wednesday is a public holiday or the employee's leave day.
- The week is `Yes` when the anchor passes **and** attended days >= required days. Not eligible gives `NA`.

**A week that began last month.** The first week of a month is judged from its Monday when swipes from before the month are stored
(the engine loads them back to that Monday). Without earlier data (the very first month) it is judged from the 1st, and the
requirement never exceeds the working weekdays left in the data: `min(3 - off, weekdays available - off)`. The month's last day is
skipped (section 3), so a week running past the month end is judged up to the day before. Such a week is judged again, with all its
data, when the next month is processed.

Every calendar week of the month is evaluated for every roster employee, including weeks with no swipes at all (stored in
`weekly_compliance`, shown on the Dashboard's *Weekly Compliance* tab).

Examples: a holiday on Friday makes the requirement 2. Leave on Wednesday and Thursday gives 1 and the Wednesday is not needed. A
week with three off days needs 0.

---

## 8. Monthly compliance (`evaluateMonth`)

The month is `Yes` when the **office days attended** in its calendar weeks reach the **sum of every week's required days**
(`sum of max(0, min(3, 3 - off days))`). Not eligible gives `NA`. Weekly results do not have to all be `Yes`; the Wednesday
anchor is a weekly rule. Reprocess the month after changing holidays or leaves.

---

## 9. Wednesday attendance

### 9.1 What the engine records (`services/process.ts`)
- For each employee in the roster and each Wednesday of the month, one row is saved: **attended** = the employee has a
  work day on that date (any hours, any open visit).
- This is separate from the 7-hour rule: a Wednesday with a short visit shows as *attended* here but does not satisfy the weekly
  compliance condition.
- Everyone in the roster gets a row, including those with no swipes.

### 9.2 Manual override (`PUT /api/months/:ym/wednesday`)
- A person can be marked present or absent for one Wednesday. Setting it back to empty removes the override.
- Overrides are kept apart from the engine data and survive reprocessing.

### 9.3 Dashboard rules (`frontend/src/lib/wednesday.ts`)
- **Public holidays are excluded**: they are not required and not counted.
- Each attended Wednesday is credited as an estimated **8.0 in-office hours**.
- **Target:** 75% of staff each Wednesday.
- **Tiers** by days attended out of the working Wednesdays (rate = days / total):

| Tier | Rule |
|---|---|
| **Perfect** | all working Wednesdays |
| **High** | rate of 75% or more |
| **Moderate** | rate of 50% or more |
| **Low** | above 0 but under 50% |
| **Zero** | no Wednesdays |

- Statistics shown: staff count, perfect count, average days, footfall (total attendances), average turnout per Wednesday,
  headcount per date, the peak and lowest date (first one on a tie), and the distribution of days.

---

## 10. Manual adjustments (`services/adjustments.ts`, `PUT /api/months/:ym/hours`)

A user can change one employee's total for one day. The action is worked out automatically:

| The day has engine rows? | Request | Action |
|---|---|---|
| Yes | hours | `edit` |
| Yes | remove | `delete` (total becomes empty) |
| No (employee has other rows that month) | hours | `add` (creates a row with no swipes) |
| No | remove | rejected (nothing to delete) |
| No rows for the employee in the month | any | rejected (404) |

Rules:
- Hours must be between **0 and 24**; the date must be in the month.
- One adjustment per employee per day (a new one replaces the old).
- Adjustments are **stored separately**; engine results are never overwritten. Deleting the adjustment restores the engine value.
- Only the **day total and the daily Compliant flag** are recomputed (using the same 7.0 rule and eligibility).
  **Weekly and monthly compliance stay as the engine computed them.**
- An `add` is ignored if swipes later appear for that date. An adjustment with no matching data is ignored.
- Adjusted rows carry an `adjustment` marker (`add`, `edit` or `delete`) in the attendance data.

---

## 11. Audit issues (`routes/months.ts`: audit)

Every data problem is stored per month, so nothing is silently dropped:

| Issue | Meaning |
|---|---|
| *Missing checkout* | A check-in with no matching checkout |
| *Orphan checkout* | A checkout with no usable check-in |
| *Daily total is partial* | A day has a closed visit plus an open one, so the total may be too low |
| *Skipped - month boundary* | A last-day visit was not calculated |
| *Inferred overnight pattern* | An employee with no shift looked like a night worker |
| *No roster match* | Swipes for an ID not in the roster (department, manager and shift stay blank, shift is "Unassigned", eligibility `NA`) |
| *Manager email unresolved* | Manager names not found in the roster |

An employee who is **not in the roster** still gets attendance rows, using the name from the swipe file, with manager `NA` and
eligibility `NA`.

---

## 12. Processing behaviour

- **Reprocessing replaces** the month's attendance rows, audit issues and Wednesday rows. Manual adjustments, Wednesday
  overrides, holidays and leaves are kept.
- **Transport opt-in** is refreshed on the saved rows whenever a transport file is uploaded, so processed months update at
  once without reprocessing.
- **Wednesday holiday marks** are read live, so holiday edits show on the Wednesday page without reprocessing. The daily,
  weekly and monthly compliance values need a reprocess to change.
- Rows are sorted by employee name, then work date, then check-in time.
- Everything is handled as plain calendar dates and UTC clock times from the swipe file, so there are no time-zone shifts.
- The rules are covered by `backend/test/rules.test.ts`; the old Python-engine golden comparison was retired with the calendar-week rules.

---

## 13. Worked example

An employee on a `10:00 AM - 7:00 PM` shift, in a week with no holidays:

| Day | Visits | Daily total | Daily compliant |
|---|---|---|---|
| Mon | 10:05 to 17:20 | 7.25 | Yes |
| Tue | not in office | none | none |
| Wed | 10:00 to 16:30 | 6.50 | No |
| Thu | 10:10 to 18:00 | 7.83 | Yes |
| Fri | 10:00 to 17:30 | 7.50 | Yes |

Three days reach 7 hours, but the **Wednesday is under 7**, so **the week is `No`**. If the Wednesday had reached 7.0, the week would be `Yes`
(3 attended days and the Wednesday attended). The month is `Yes` when the 7-hour days across all its weeks reach the sum of the weekly requirements.
