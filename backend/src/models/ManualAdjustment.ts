/** Stores hours that someone added, edited or deleted by hand for a day. */
import { Check, Column, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

@Entity("manual_adjustments")
@Check("manual_adjustments_action_check", "action IN ('add', 'edit', 'delete')")
@Unique("manual_adjustments_employee_id_work_date_key", ["employeeId", "workDate"])
export class ManualAdjustment {
  @PrimaryGeneratedColumn({ type: "int", primaryKeyConstraintName: "manual_adjustments_pkey" })
  id!: number;

  @Column({ type: "date" })
  month!: string;

  @Column({ name: "employee_id", type: "text" })
  employeeId!: string;

  @Column({ name: "work_date", type: "date" })
  workDate!: string;

  @Column({ type: "text" })
  action!: "add" | "edit" | "delete";

  @Column({ type: "numeric", precision: 6, scale: 2, nullable: true })
  hours!: number | null;

  @Column({ type: "text", nullable: true })
  note!: string | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}
