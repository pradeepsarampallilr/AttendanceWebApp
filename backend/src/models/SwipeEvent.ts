import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Upload } from "./Upload.js";

/** Raw flattened swipes. Wall-clock times, so timestamp WITHOUT time zone. Duplicates are kept (no natural key). */
@Entity("swipe_events")
@Check("swipe_events_kind_check", "kind IN ('in', 'out')")
@Index("swipe_events_at_idx", ["at"])
export class SwipeEvent {
  @PrimaryGeneratedColumn({ type: "bigint", primaryKeyConstraintName: "swipe_events_pkey" })
  id!: string;

  @Column({ name: "employee_id", type: "text" })
  employeeId!: string;

  @Column({ name: "employee_name", type: "text", nullable: true })
  employeeName!: string | null;

  @Column({ type: "timestamp" })
  at!: Date;

  @Column({ type: "text" })
  kind!: "in" | "out";

  @Column({ name: "upload_id", type: "int", nullable: true })
  uploadId!: number | null;

  @ManyToOne(() => Upload, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "upload_id", foreignKeyConstraintName: "swipe_events_upload_id_fkey" })
  upload?: Upload | null;
}
