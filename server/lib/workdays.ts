import { addDays, weekday } from "./dates.js";

/** Days a daily site report is expected: Monday to Saturday (PROPOSED, A-30). 0 = Sunday. */
export const SITE_WORKING_DAYS = [1, 2, 3, 4, 5, 6];

/** The most recent working day before `today`: the day whose site report should exist by now. */
export function lastWorkday(today: string) {
  let d = addDays(today, -1);
  while (!SITE_WORKING_DAYS.includes(weekday(d))) d = addDays(d, -1);
  return d;
}

/** Working days strictly after `from`, up to and including `to`. */
export function workdaysBetween(from: string, to: string) {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (SITE_WORKING_DAYS.includes(weekday(d))) n++;
  return n;
}
