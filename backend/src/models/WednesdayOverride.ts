/** Stores hand-made changes to whether someone attended on a Wednesday. */
import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("wednesday_overrides")
export class WednesdayOverride {
  @Column({ type: "date" })
  month!: string;

  @PrimaryColumn({ name: "employee_id", type: "text", primaryKeyConstraintName: "wednesday_overrides_pkey" })
  employeeId!: string;

  @PrimaryColumn({ type: "date", primaryKeyConstraintName: "wednesday_overrides_pkey" })
  wednesday!: string;

  @Column({ type: "boolean" })
  attended!: boolean;
}
