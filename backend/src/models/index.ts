/** Gathers all the data models in one place so other files can import them together. */
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
import { WednesdayAttendance } from "./WednesdayAttendance.js";
import { WednesdayOverride } from "./WednesdayOverride.js";

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
export * from "./WednesdayAttendance.js";
export * from "./WednesdayOverride.js";

export const entities = [
  Upload, RosterEmployee, SwipeEvent, AttendanceVisit, WednesdayAttendance, AuditIssue,
  ManualAdjustment, WednesdayOverride, PublicHoliday, TransportEmployee, Leave, AppUser,
];
