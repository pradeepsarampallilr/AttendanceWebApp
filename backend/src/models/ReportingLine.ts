/** Stores every manager above each employee, at any depth (1 = direct report). */
import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("reporting_lines")
@Index("reporting_lines_employee_idx", ["employeeId"])
export class ReportingLine {
  @PrimaryColumn({ name: "manager_id", type: "text", primaryKeyConstraintName: "reporting_lines_pkey" })
  managerId!: string;

  @PrimaryColumn({ name: "employee_id", type: "text", primaryKeyConstraintName: "reporting_lines_pkey" })
  employeeId!: string;

  @Column({ type: "int" })
  depth!: number;
}
