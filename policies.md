# Attendance policies and engine rules

Every rule the engine applies, in the order the data flows through it. The values come from the code, and the file for
each rule is named so you can check it. If you change a rule, update this file too.

**Quick reference**

| Rule | Value | Where |
|---|---|---|
| Full-day hours threshold | **7.0 hours** | `COMPLIANT_MIN_HOURS` in `engine/core.ts` |
| General shift (exempt) | **9:00 AM - 6:30 PM** | `GENERAL_SHIFT_WINDOW` in `engine/roster.ts` |
| Required office days per week | **3 days** (each of 7+ hours), including every working Wednesday | `evaluateWeekCompliance` in `engine/policy.ts` |
| Month target | average **7.0 hours per working day** and every week compliant | `evaluateMonthCompliance` in `engine/policy.ts` |
| Longest check-in to checkout | **20 hours** | `MAX_SHIFT_DURATION_MS` in `engine/core.ts` |
| Overnight work-day buffer | shift end + **60 minutes** | `DAY_ATTRIBUTION_BUFFER_MIN` in `engine/core.ts` |
| Week buckets | days 1-7, 8-14, 15-21, 22-28, 29-end | `weekNumberInMonth` in `engine/core.ts` |
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
| **Public holidays** | no, picked on the Upload page | Fewer working days and relaxed weekly requirement |
| **Leaves** | no, uploaded or picked per employee | Fewer working days for that employee's month total |

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

| Employee's shift | Eligible for the policy? |
|---|---|
| General shift `9:00 AM - 6:30 PM` (exactly) | **No**, all compliance values are `NA` |
| Any other shift | **Yes** |
| No shift (not in roster, or unreadable shift) | **Yes** |

Compliance results use three values: **Yes**, **No**, **NA** (not applicable).

---

## 6. Daily compliance (`evaluateCompliance`)

| Condition | Result |
|---|---|
| Not eligible, or the daily total is empty | `NA` |
| Daily total **below 7.0** hours | `No` |
| Daily total **7.0 or more** | `Yes` |

---

## 7. Weekly compliance (`evaluateWeekCompliance`)

**Weeks** are fixed 7-day blocks of the month, not calendar weeks: days 1-7 are week 1, 8-14 week 2, 15-21 week 3, 22-28 week 4, and
29 to the end of the month week 5.

An **attended day** is a day with a daily total of **7.0 hours or more**. A week is `Yes` only if **both** conditions hold:

1. **Every working Wednesday** in the block is an attended day. A Wednesday that is a public holiday is not required.
2. The number of attended days is **at least the required number**:
   - normally **3**;
   - if the block has public holidays on weekdays: `min(3, weekdays in the block minus those holidays)`.

Not eligible gives `NA`. A week in which the employee has swipes but no day of 7+ hours is evaluated and is `No`. A week with no visits at all has no row, so it is not evaluated.
Leaves do **not** change the weekly requirement.

Example: a week with a holiday on Friday has 4 working weekdays, so the requirement stays at 3. A short week of only two
working weekdays (for example the last block of a month) needs only 2.

---

## 8. Monthly compliance (`evaluateMonthCompliance`)

A month is `Yes` only if **both** hold:

1. `total hours / working days >= 7.0`, where working days = the weekdays of the month minus public holidays minus **that
   employee's leave days**. If working days are 0, the result is `No`.
2. **Every evaluated week is `Yes`.**

Not eligible gives `NA`. Weekends never count as working days. Leaves and holidays change only this ratio, so reprocess the month after editing
them.

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
| *No roster match* | Swipes for an ID not in the roster (department, manager and shift stay blank, shift is "Unassigned") |
| *Manager email unresolved* | Manager names not found in the roster |

An employee who is **not in the roster** still gets attendance rows, using the name from the swipe file, with manager `NA` and
eligibility `Yes`.

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
- Results are checked against the original Python engine for July and August (golden files), so a change in these rules should be
  expected to change those test results too.

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
(3 or more attended days and every Wednesday attended). The month is `Yes` only if every week is `Yes` and total hours divided by working days
is at least 7.0.
