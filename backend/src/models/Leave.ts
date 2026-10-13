/** Stores the days each employee was on leave. */
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from "typeorm";

@Entity("leaves")
@Unique("leaves_employee_id_leave_date_key", ["employeeId", "leaveDate"])
@Index("leaves_date_idx", ["leaveDate"])
export class Leave {
  @PrimaryGeneratedColumn({ type: "bigint", primaryKeyConstraintName: "leaves_pkey" })
  id!: string;

  @Column({ name: "employee_id", type: "text" })
  employeeId!: string;

  @Column({ name: "employee_name", type: "text", default: "" })
  employeeName!: string;

  @Column({ name: "leave_date", type: "date" })
  leaveDate!: string;

  @Column({ name: "leave_description", type: "text", default: "" })
  leaveDescription!: string;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}
