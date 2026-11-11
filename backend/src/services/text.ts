/** Small checks for text that arrives from outside: only real strings, no control characters, bounded length. */

/** Trimmed text of at most `max` characters; anything that is not a string (numbers, arrays, objects) becomes "". */
export const cleanText = (v: unknown, max = 200) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";

/** An employee id as it appears in URLs and bodies: a printable string of 1 to 64 characters. */
export const isEmployeeId = (v: unknown): v is string => typeof v === "string" && /^[^\u0000-\u001f\u007f]{1,64}$/.test(v);
