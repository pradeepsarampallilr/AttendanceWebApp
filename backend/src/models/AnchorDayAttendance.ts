/** Stores whether each employee attended on the anchor day of each week in a month. */
import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("anchor_day_attendance")
export class AnchorDayAttendance {
  @PrimaryColumn({ type: "date", primaryKeyConstraintName: "anchor_day_attendance_pkey" })
  month!: string;

  @PrimaryColumn({ name: "employee_id", type: "text", primaryKeyConstraintName: "anchor_day_attendance_pkey" })
  employeeId!: string;

  @Column({ name: "employee_name", type: "text" })
  employeeName!: string;

  @PrimaryColumn({ name: "anchor_date", type: "date", primaryKeyConstraintName: "anchor_day_attendance_pkey" })
  anchorDate!: string;

  @Column({ type: "boolean" })
  attended!: boolean;
}
