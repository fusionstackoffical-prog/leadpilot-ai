import type { DateRangeKey } from "./definitions";

/** Reporting timezone used when a workspace has none configured (US HVAC market). */
export const DEFAULT_REPORTING_TIMEZONE = "America/New_York";

export type DateRangeBounds = {
  key: DateRangeKey;
  timeZone: string;
  /** Inclusive start instant: local midnight of the first day, as ISO UTC. */
  start: string;
  /** Exclusive end instant: local midnight after the last day, as ISO UTC. */
  end: string;
  /** Local calendar dates (YYYY-MM-DD), inclusive. Used for chart buckets. */
  startDate: string;
  endDate: string;
  days: string[];
};

type LocalDate = { year: number; month: number; day: number };

function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Milliseconds the zone is ahead of UTC at a given instant (negative west of UTC). */
function zoneOffset(instant: Date, timeZone: string) {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** UTC instant of local midnight on a calendar date in a zone (DST-safe). */
function localMidnight({ year, month, day }: LocalDate, timeZone: string) {
  const wall = Date.UTC(year, month - 1, day);
  let instant = wall - zoneOffset(new Date(wall), timeZone);
  // Re-check once: the offset at the guess can differ across a DST transition.
  instant = wall - zoneOffset(new Date(instant), timeZone);
  return new Date(instant);
}

/** Calendar arithmetic on local dates, independent of time zones. */
function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function iso({ year, month, day }: LocalDate) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Resolves a dashboard range to [start, end) instants for the reporting timezone.
 * Every range ends at the end of "today" in that zone; day counts include today.
 */
export function getDateRangeBounds(
  key: DateRangeKey,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
  now: Date = new Date(),
): DateRangeBounds {
  const today = localParts(now, timeZone);
  const todayDate: LocalDate = { year: today.year, month: today.month, day: today.day };

  const first: LocalDate =
    key === "today"
      ? todayDate
      : key === "7d"
        ? addDays(todayDate, -6)
        : key === "30d"
          ? addDays(todayDate, -29)
          : { year: today.year, month: today.month, day: 1 };

  const days: string[] = [];
  for (let d = first; iso(d) <= iso(todayDate); d = addDays(d, 1)) days.push(iso(d));

  return {
    key,
    timeZone,
    start: localMidnight(first, timeZone).toISOString(),
    end: localMidnight(addDays(todayDate, 1), timeZone).toISOString(),
    startDate: iso(first),
    endDate: iso(todayDate),
    days,
  };
}

/** Human-readable span, e.g. "Oct 3 – Nov 1, 2026" or "Nov 1, 2026". */
export function formatRangeSpan(bounds: DateRangeBounds) {
  // Format the local calendar dates themselves (noon UTC avoids any day shift).
  const toDate = (value: string) => new Date(`${value}T12:00:00Z`);
  const full = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (bounds.startDate === bounds.endDate) return full.format(toDate(bounds.endDate));
  const sameYear = bounds.startDate.slice(0, 4) === bounds.endDate.slice(0, 4);
  const startFormat = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
  return `${startFormat.format(toDate(bounds.startDate))} – ${full.format(toDate(bounds.endDate))}`;
}

/** Short zone name at the end of the range, e.g. "EST" / "EDT". */
export function formatZoneAbbreviation(bounds: DateRangeBounds) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: bounds.timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date(new Date(bounds.end).getTime() - 1));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? bounds.timeZone;
}
