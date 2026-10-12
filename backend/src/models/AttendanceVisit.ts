import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

type Tri = "Yes" | "No" | "NA";

/** Computed output: one row per visit, same columns as the Attendance sheet. */
@Entity("attendance_visits")
@Check("attendance_visits_eligibility_check", "eligibility IN ('Yes','No')")
@Check("attendance_visits_compliant_check", "compliant IN ('Yes','No','NA')")
@Check("attendance_visits_week_compliant_check", "week_compliant IN ('Yes','No','NA')")
@Check("attendance_visits_month_compliant_check", "month_compliant IN ('Yes','No','NA')")
@Check("attendance_visits_transport_opt_in_check", "transport_opt_in IN ('Yes','No','NA')")
@Index("attendance_visits_month_emp_idx", ["month", "employeeId", "workDate"])
export class AttendanceVisit {
  @PrimaryGeneratedColumn({ type: "bigint", primaryKeyConstraintName: "attendance_visits_pkey" })
  id!: string;

  @Column({ type: "date" })
  month!: string;

  @Column({ name: "employee_id", type: "text" })
  employeeId!: string;

  @Column({ name: "employee_name", type: "text" })
  employeeName!: string;

  @Column({ type: "text", default: "" })
  email!: string;

  @Column({ type: "text", default: "" })
  department!: string;

  @Column({ name: "manager_name", type: "text", default: "NA" })
  managerName!: string;

  @Column({ name: "manager_email", type: "text", default: "NA" })
  managerEmail!: string;

  @Column({ type: "int" })
  week!: number;

  @Column({ name: "week_attended_days", type: "int" })
  weekAttendedDays!: number;

  @Column({ name: "work_date", type: "date" })
  workDate!: string;

  @Column({ name: "check_in", type: "timestamp" })
  checkIn!: Date;

  @Column({ name: "check_out", type: "timestamp", nullable: true })
  checkOut!: Date | null;

  @Column({ name: "visit_hours", type: "numeric", precision: 6, scale: 2, nullable: true })
  visitHours!: number | null;

  /** Repeated on every leg of the day; see isFirstRow. */
  @Column({ name: "daily_total_hours", type: "numeric", precision: 6, scale: 2, nullable: true })
  dailyTotalHours!: number | null;

  @Column({ name: "is_first_row", type: "boolean" })
  isFirstRow!: boolean;

  @Column({ name: "rows_in_day_group", type: "int" })
  rowsInDayGroup!: number;

  @Column({ name: "shift_label", type: "text" })
  shiftLabel!: string;

  @Column({ type: "text" })
  eligibility!: "Yes" | "No";

  @Column({ type: "text" })
  compliant!: Tri;

  @Column({ name: "week_compliant", type: "text" })
  weekCompliant!: Tri;

  @Column({ name: "month_compliant", type: "text" })
  monthCompliant!: Tri;

  /** 'NA' = general shift (not eligible); otherwise 'Yes' if listed in transport_employees, else 'No'. */
  @Column({ name: "transport_opt_in", type: "text", default: "NA" })
  transportOptIn!: Tri;
}
