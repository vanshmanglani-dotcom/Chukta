// All business time is India Standard Time (UTC+05:30, no DST).
const IST_OFFSET_MS = 330 * 60 * 1000;

export function istNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + IST_OFFSET_MS);
}

/** YYYY-MM-DD for the current IST calendar day. */
export function istToday(now: Date = new Date()): string {
  return istNow(now).toISOString().slice(0, 10);
}

export function istHour(now: Date = new Date()): number {
  return istNow(now).getUTCHours();
}

/** Whole days from `fromDate` to `toDate` (both YYYY-MM-DD). Positive when toDate is later. */
export function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10));
  const b = Date.UTC(+toDate.slice(0, 4), +toDate.slice(5, 7) - 1, +toDate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** ISO week key like 2026-W43, used to allow at most one stage-4 reminder per week. */
export function isoWeekKey(dateStr: string): string {
  const d = new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function toDateStr(v: string | Date): string {
  if (typeof v === 'string') return v.slice(0, 10);
  // Neon returns DATE columns as JS Dates at UTC midnight.
  return v.toISOString().slice(0, 10);
}
