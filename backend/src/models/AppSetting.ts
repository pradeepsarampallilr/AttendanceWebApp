/** Stores the rule settings HR and superadmin can change (one row per setting). */
import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("app_settings")
export class AppSetting {
  @PrimaryColumn({ type: "text", primaryKeyConstraintName: "app_settings_pkey" })
  key!: string;

  @Column({ type: "int" })
  value!: number;

  @Column({ name: "updated_by", type: "text", default: "" })
  updatedBy!: string;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}
