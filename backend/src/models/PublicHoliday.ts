/** Stores the public holiday dates picked for each month. */
import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("public_holidays")
@Index("public_holidays_month_idx", ["month"])
export class PublicHoliday {
  @PrimaryColumn({ name: "holiday_date", type: "date", primaryKeyConstraintName: "public_holidays_pkey" })
  holidayDate!: string;

  @Column({ type: "date" })
  month!: string;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}
