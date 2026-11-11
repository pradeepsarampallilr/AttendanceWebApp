/** Stores a record of each uploaded file: type, name, month, rows and status. */
import { Check, Column, Entity, PrimaryGeneratedColumn } from "typeorm";

export type UploadKind = "movement" | "roster" | "transport" | "leaves";

@Entity("uploads")
@Check("uploads_kind_check", "kind IN ('movement', 'roster', 'transport', 'leaves')")
export class Upload {
  @PrimaryGeneratedColumn({ type: "int", primaryKeyConstraintName: "uploads_pkey" })
  id!: number;

  @Column({ type: "text" })
  kind!: UploadKind;

  @Column({ type: "text" })
  filename!: string;

  /** First day of the month (movement uploads only). */
  @Column({ type: "date", nullable: true })
  month!: string | null;

  @Column({ name: "row_count", type: "int", default: 0 })
  rowCount!: number;

  @Column({ type: "text", default: "uploaded" })
  status!: string;

  @Column({ name: "uploaded_by", type: "text", default: "" })
  uploadedBy!: string;

  @Column({ name: "uploaded_at", type: "timestamptz", default: () => "now()" })
  uploadedAt!: Date;
}
