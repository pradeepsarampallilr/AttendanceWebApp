/** Stores hand-made changes to whether someone attended on an anchor day. */
import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("anchor_day_adjustments")
export class AnchorDayAdjustment {
  @Column({ type: "date" })
  month!: string;

  @PrimaryColumn({ name: "employee_id", type: "text", primaryKeyConstraintName: "anchor_day_adjustments_pkey" })
  employeeId!: string;

  @PrimaryColumn({ name: "anchor_date", type: "date", primaryKeyConstraintName: "anchor_day_adjustments_pkey" })
  anchorDate!: string;

  @Column({ type: "boolean" })
  attended!: boolean;
}
