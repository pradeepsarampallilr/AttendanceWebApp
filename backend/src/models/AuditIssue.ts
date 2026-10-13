/** Stores problems found in the swipe data for a month, such as odd or missing swipes. */
import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("audit_issues")
@Index("audit_issues_month_idx", ["month"])
export class AuditIssue {
  @PrimaryGeneratedColumn({ type: "bigint", primaryKeyConstraintName: "audit_issues_pkey" })
  id!: string;

  @Column({ type: "date" })
  month!: string;

  @Column({ name: "employee_id", type: "text" })
  employeeId!: string;

  @Column({ name: "issue_type", type: "text" })
  issueType!: string;

  @Column({ type: "timestamp" })
  at!: Date;

  @Column({ type: "text" })
  detail!: string;
}
