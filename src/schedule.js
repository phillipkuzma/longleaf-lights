import { CONFIG } from "./config.js";

// Dates are plain "YYYY-MM-DD" strings, treated as calendar days in Florida.

export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(iso) {
  return new Date(iso + "T12:00:00Z").getUTCDay();
}

export function todayLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.business.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

export function weekendDays(friday) {
  return [friday, addDays(friday, 1), addDays(friday, 2)];
}

export function kindForStories(stories) {
  return stories === 2 ? "lift" : "evening";
}

export function capacityFor(kind, iso) {
  return CONFIG.capacity[kind]?.[dayOfWeek(iso)] ?? 0;
}

export function liftCapacityPerWeekend() {
  return Object.values(CONFIG.capacity.lift).reduce((a, b) => a + b, 0);
}

// counts: Map of "date|kind" -> number of active bookings
// settings: { closedWeekends: Set("season:friday"), blocked: Set("date|kind") }
export function buildSeason(season, counts, settings, today = todayLocal()) {
  const def = CONFIG.seasons[season];
  const earliest = addDays(today, CONFIG.minLeadDays);
  const perWeekend = liftCapacityPerWeekend();

  const weekends = def.weekends.map((friday) => {
    const days = weekendDays(friday).map((date) => {
      const slot = (kind) => {
        const cap = capacityFor(kind, date);
        const used = counts.get(`${date}|${kind}`) || 0;
        const blocked = settings.blocked.has(`${date}|${kind}`);
        return { kind, cap, used, left: Math.max(0, cap - used), blocked };
      };
      return { date, dow: dayOfWeek(date), lift: slot("lift"), evening: slot("evening") };
    });
    const liftBooked = days.reduce((s, d) => s + d.lift.used, 0);
    const closed = settings.closedWeekends.has(`${season}:${friday}`);
    return {
      friday,
      days,
      closed,
      past: friday < earliest && addDays(friday, 2) < earliest,
      liftBooked,
      liftCapacity: perWeekend,
      liftFull: liftBooked >= perWeekend,
      liftRuns: liftBooked >= CONFIG.liftMinimum,
      liftConfirmBy: addDays(friday, -CONFIG.liftConfirmDaysBefore),
    };
  });

  // Only one lift weekend is open to new bookings at a time: the earliest
  // upcoming weekend that isn't closed or full.
  const open = weekends.find((w) => !w.closed && !w.past && !w.liftFull);
  for (const w of weekends) w.liftOpen = w === open;

  return { season, label: def.label, earliest, weekends };
}

// Dates a customer can pick for a visit.
export function availableDates(seasonData, kind) {
  const out = [];
  for (const w of seasonData.weekends) {
    if (w.closed && kind === "lift") continue;
    if (kind === "lift" && !w.liftOpen) continue;
    for (const d of w.days) {
      const s = d[kind];
      if (d.date < seasonData.earliest || s.blocked || s.left <= 0) continue;
      out.push({
        date: d.date,
        left: s.left,
        weekend: w.friday,
        liftBooked: w.liftBooked,
        liftRuns: w.liftRuns,
        liftConfirmBy: w.liftConfirmBy,
      });
    }
  }
  return out;
}

export function isBookable(seasonData, kind, date) {
  return availableDates(seasonData, kind).some((d) => d.date === date);
}
