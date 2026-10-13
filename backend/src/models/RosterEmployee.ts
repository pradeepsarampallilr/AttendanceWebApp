/** Stores the employee list: name, email, department, manager and shift. */
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Upload } from "./Upload.js";

@Entity("roster_employees")
export class RosterEmployee {
  @PrimaryColumn({ name: "employee_id", type: "text", primaryKeyConstraintName: "roster_employees_pkey" })
  employeeId!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", default: "" })
  email!: string;

  @Column({ type: "text", default: "" })
  department!: string;

  @Column({ name: "manager_name", type: "text", default: "" })
  managerName!: string;

  @Column({ name: "manager_email", type: "text", default: "" })
  managerEmail!: string;

  /** NULL = unassigned. */
  @Column({ name: "shift_label", type: "text", nullable: true })
  shiftLabel!: string | null;

  @Column({ name: "shift_start_min", type: "int", nullable: true })
  shiftStartMin!: number | null;

  @Column({ name: "shift_end_min", type: "int", nullable: true })
  shiftEndMin!: number | null;

  @Column({ name: "upload_id", type: "int", nullable: true })
  uploadId!: number | null;

  @ManyToOne(() => Upload, { nullable: true })
  @JoinColumn({ name: "upload_id", foreignKeyConstraintName: "roster_employees_upload_id_fkey" })
  upload?: Upload | null;
}
