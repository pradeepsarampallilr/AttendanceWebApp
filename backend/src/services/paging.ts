/** Reads ?page= and ?pageSize= safely: whole numbers only, page between 1 and 1,000,000, size between 1 and 100. */
export function pageParams(q: Record<string, unknown>, defaultSize: number) {
  const whole = (v: unknown, fallback: number) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : fallback; };
  return { page: Math.min(1_000_000, whole(q.page, 1)), pageSize: Math.min(100, whole(q.pageSize, defaultSize)) };
}
