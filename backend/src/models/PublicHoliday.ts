import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/** Public holidays picked on the Upload page's calendar. One row per date; month is the first day of its month. */
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
