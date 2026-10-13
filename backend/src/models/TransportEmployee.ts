/** Stores the transport details of employees from the transport sheet. */
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Upload } from "./Upload.js";

@Entity("transport_employees")
export class TransportEmployee {
  @PrimaryColumn({ name: "employee_id", type: "text", primaryKeyConstraintName: "transport_employees_pkey" })
  employeeId!: string;

  @Column({ type: "text", default: "" }) department!: string;
  @Column({ name: "full_name", type: "text", default: "" }) fullName!: string;
  @Column({ type: "text", default: "" }) email!: string;
  @Column({ name: "business_title", type: "text", default: "" }) businessTitle!: string;
  @Column({ name: "contact_no", type: "text", default: "" }) contactNo!: string;
  @Column({ type: "text", default: "" }) gender!: string;
  @Column({ name: "manager_name", type: "text", default: "" }) managerName!: string;
  @Column({ name: "manager_email", type: "text", default: "" }) managerEmail!: string;
  @Column({ name: "working_days", type: "text", default: "" }) workingDays!: string;
  @Column({ type: "text", default: "" }) shift!: string;
  @Column({ name: "address_line1", type: "text", default: "" }) addressLine1!: string;
  @Column({ name: "address_line2", type: "text", default: "" }) addressLine2!: string;
  @Column({ type: "text", default: "" }) city!: string;
  @Column({ name: "postal_code", type: "text", default: "" }) postalCode!: string;

  @Column({ name: "upload_id", type: "int", nullable: true })
  uploadId!: number | null;

  @ManyToOne(() => Upload, { nullable: true })
  @JoinColumn({ name: "upload_id", foreignKeyConstraintName: "transport_employees_upload_id_fkey" })
  upload?: Upload | null;
}
