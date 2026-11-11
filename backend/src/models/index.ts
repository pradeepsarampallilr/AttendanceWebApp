/** Gathers all the data models in one place so other files can import them together. */
import { AppSetting } from "./AppSetting.js";
import { AppUser } from "./AppUser.js";
import { AttendanceVisit } from "./AttendanceVisit.js";
import { AuditIssue } from "./AuditIssue.js";
import { Leave } from "./Leave.js";
import { ManualAdjustment } from "./ManualAdjustment.js";
import { PublicHoliday } from "./PublicHoliday.js";
import { RosterEmployee } from "./RosterEmployee.js";
import { SwipeEvent } from "./SwipeEvent.js";
import { TransportEmployee } from "./TransportEmployee.js";
import { Upload } from "./Upload.js";
import { AnchorDayAttendance } from "./AnchorDayAttendance.js";
import { AnchorDayAdjustment } from "./AnchorDayAdjustment.js";
import { ReportingLine } from "./ReportingLine.js";
import { AuditLog } from "./AuditLog.js";
import { WeeklyCompliance } from "./WeeklyCompliance.js";

export * from "./AppSetting.js";
export * from "./AppUser.js";
export * from "./AttendanceVisit.js";
export * from "./AuditIssue.js";
export * from "./Leave.js";
export * from "./ManualAdjustment.js";
export * from "./PublicHoliday.js";
export * from "./RosterEmployee.js";
export * from "./SwipeEvent.js";
export * from "./TransportEmployee.js";
export * from "./Upload.js";
export * from "./AnchorDayAttendance.js";
export * from "./AnchorDayAdjustment.js";
export * from "./ReportingLine.js";
export * from "./AuditLog.js";
export * from "./WeeklyCompliance.js";

export const entities = [
  Upload, RosterEmployee, SwipeEvent, AttendanceVisit, AnchorDayAttendance, AuditIssue,
  ManualAdjustment, AnchorDayAdjustment, PublicHoliday, TransportEmployee, Leave, AppUser, ReportingLine, AuditLog, WeeklyCompliance, AppSetting,
];
