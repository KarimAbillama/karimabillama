// Business dates are Dubai-local calendar dates ("YYYY-MM-DD"); timestamps are stored in UTC.
export const BUSINESS_TZ = "Asia/Dubai";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export function businessToday(now = new Date()): string {
  return fmt.format(now);
}

export function businessYear(now = new Date()): string {
  return businessToday(now).slice(0, 4);
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Adds calendar days to a "YYYY-MM-DD" date. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday, for a "YYYY-MM-DD" date. */
export const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
