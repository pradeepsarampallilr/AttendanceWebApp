/** The configurable rule settings: what each one means, its allowed range, and loading / saving them. */
import { AppDataSource } from "../db.js";
import { DEFAULT_SETTINGS, settings, type Settings } from "../engine/core.js";
import { ValidationError } from "../io/tables.js";
import { AppSetting } from "../models/index.js";

export const SETTING_SPECS: { key: keyof Settings; label: string; description: string; unit: string; min: number; max: number; options?: string[] }[] = [
  { key: "compliantMinHours", label: "Per day mandatory working hours", unit: "hours", min: 1, max: 24, description: "Hours in the office that make a day count as an office day." },
  { key: "weeklyOfficeDays", label: "Office days per week", unit: "days", min: 1, max: 5, description: "Office days required in a full week, before public holidays and leaves are taken off." },
  { key: "anchorWeekday", label: "Anchor day", unit: "", min: 0, max: 4, options: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], description: "The weekday that must be an office day every week." },
  { key: "dayAttributionBufferMin", label: "Check-in / check-out buffer", unit: "minutes", min: 0, max: 360, description: "Minutes around a shift's start (check-in) and end (checkout) when assigning a swipe to a work day." },
  { key: "maxShiftHours", label: "Longest shift window", unit: "hours", min: 1, max: 48, description: "Longest gap between a check-in and the checkout it pairs with." },
];

/** Applies the saved values over the defaults; call at start-up. */
export async function loadSettings() {
  const rows = await AppDataSource.getRepository(AppSetting).find();
  Object.assign(settings, DEFAULT_SETTINGS);
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) settings[r.key as keyof Settings] = r.value;
}

export const listSettings = () => SETTING_SPECS.map((s) => ({ ...s, value: settings[s.key], default: DEFAULT_SETTINGS[s.key] }));

/** Validates {key: number} and saves it; returns a "key: old -> new" line per changed setting. */
export async function saveSettings(patch: Record<string, unknown>, by: string): Promise<string[]> {
  const next: Partial<Settings> = {};
  for (const [key, v] of Object.entries(patch)) {
    const spec = SETTING_SPECS.find((s) => s.key === key);
    if (!spec) throw new ValidationError(`Unknown setting: ${key}`);
    if (typeof v !== "number" || !Number.isInteger(v) || v < spec.min || v > spec.max)
      throw new ValidationError(`${spec.label} must be a whole number from ${spec.min} to ${spec.max}`);
    next[spec.key] = v;
  }
  const changes = SETTING_SPECS.filter((s) => next[s.key] !== undefined && next[s.key] !== settings[s.key]).map((s) => `${s.key}: ${settings[s.key]} -> ${next[s.key]}`);
  if (changes.length) {
    await AppDataSource.getRepository(AppSetting).save(
      (Object.entries(next) as [string, number][]).map(([key, value]) => ({ key, value, updatedBy: by, updatedAt: new Date() })));
    Object.assign(settings, next);
  }
  return changes;
}
