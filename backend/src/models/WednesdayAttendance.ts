import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("wednesday_attendance")
export class WednesdayAttendance {
  @PrimaryColumn({ type: "date", primaryKeyConstraintName: "wednesday_attendance_pkey" })
  month!: string;

  @PrimaryColumn({ name: "employee_id", type: "text", primaryKeyConstraintName: "wednesday_attendance_pkey" })
  employeeId!: string;

  @Column({ name: "employee_name", type: "text" })
  employeeName!: string;

  @PrimaryColumn({ type: "date", primaryKeyConstraintName: "wednesday_attendance_pkey" })
  wednesday!: string;

  @Column({ type: "boolean" })
  attended!: boolean;
}
