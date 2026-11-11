/** Stores each employee's weekly compliance for every calendar week of a processed month. */
import { Check, Column, Entity, PrimaryColumn } from "typeorm";

@Entity("weekly_compliance")
@Check("weekly_compliance_anchor_check", "anchor IN ('present', 'absent', 'off')")
@Check("weekly_compliance_status_check", "status IN ('Yes', 'No', 'NA')")
export class WeeklyCompliance {
  @PrimaryColumn({ type: "date", primaryKeyConstraintName: "weekly_compliance_pkey" })
  month!: string;

  @PrimaryColumn({ name: "employee_id", type: "text", primaryKeyConstraintName: "weekly_compliance_pkey" })
  employeeId!: string;

  @PrimaryColumn({ name: "week_start", type: "date", primaryKeyConstraintName: "weekly_compliance_pkey" })
  weekStart!: string;

  @Column({ name: "employee_name", type: "text" })
  employeeName!: string;

  @Column({ type: "text", default: "" })
  department!: string;

  @Column({ type: "int" })
  week!: number;

  /** Office days needed that week: min(3, 3 - holidays - leaves). */
  @Column({ type: "int" })
  required!: number;

  @Column({ type: "int" })
  attended!: number;

  /** The Wednesday: present, absent, or off (holiday / leave / outside the data). */
  @Column({ type: "text" })
  anchor!: "present" | "absent" | "off";

  @Column({ type: "text" })
  status!: "Yes" | "No" | "NA";
}
