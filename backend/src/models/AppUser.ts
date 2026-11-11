/** Stores people allowed to use the app (email, optional username, name and role). */
import { Column, Entity, PrimaryColumn } from "typeorm";

export type AppRole = "superadmin" | "hr" | "manager" | "employee";

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

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  /** Roster employee this login belongs to (managers and employees); null for HR / superadmin-only users. */
  @Column({ name: "employee_id", type: "text", nullable: true })
  employeeId!: string | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}
