/** Stores people allowed to use the app (email, optional username, name and role). */
import { Column, Entity, PrimaryColumn } from "typeorm";

export type AppRole = "superadmin" | "hr" | "manager";

@Entity("app_users")
export class AppUser {
  @PrimaryColumn({ type: "text", primaryKeyConstraintName: "app_users_pkey" })
  email!: string;

  @Column({ type: "text", nullable: true })
  username!: string | null;

  @Column({ type: "text", default: "" })
  name!: string;

  @Column({ type: "text" })
  role!: AppRole;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}
