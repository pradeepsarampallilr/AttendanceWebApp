/**
 * Infers who reports to whom from the roster's manager names, at every level.
 * If X manages Y and Y manages Z, X sees Y (depth 1) and Z (depth 2), while Y sees only Z.
 */
export interface ReportingLine { managerId: string; employeeId: string; depth: number }

export function buildReportingLines(people: { employeeId: string; name: string; managerName: string }[]): ReportingLine[] {
  const key = (s: string) => s.trim().toLowerCase();
  const idByName = new Map<string, string | null>(); // null = the name is shared by several people, so it cannot be resolved
  for (const p of people) idByName.set(key(p.name), idByName.has(key(p.name)) ? null : p.employeeId);

  const parent = new Map<string, string>();
  for (const p of people) {
    const m = p.managerName && idByName.get(key(p.managerName));
    if (m && m !== p.employeeId) parent.set(p.employeeId, m);
  }

  const lines: ReportingLine[] = [];
  for (const employeeId of parent.keys()) {
    const seen = new Set([employeeId]); // stops a manager loop (A manages B manages A)
    for (let up = parent.get(employeeId), depth = 1; up && !seen.has(up); up = parent.get(up), depth++) {
      seen.add(up);
      lines.push({ managerId: up, employeeId, depth });
    }
  }
  return lines;
}
