/** Stores who did what in the app: uploads, edits, deletes, holiday and user changes. */
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("audit_logs")
export class AuditLog {
  @PrimaryGeneratedColumn({ type: "bigint", primaryKeyConstraintName: "audit_logs_pkey" })
  id!: string;

  @Column({ type: "timestamptz", default: () => "now()" })
  at!: Date;

  @Column({ name: "actor_email", type: "text" })
  actorEmail!: string;

  @Column({ name: "actor_role", type: "text" })
  actorRole!: string;

  @Column({ type: "text" })
  action!: string;

  @Column({ type: "text" })
  entity!: string;

  @Column({ type: "text", default: "" })
  detail!: string;
}
