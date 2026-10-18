import { availabilityMasks, dateKey, rangeInstants, SLOT } from './schedule.js';
import { addDays, zonedParts, zonedToEpoch } from './tz.js';
import { meetingStarts } from './overlap-model.js';

// Search the dated weeks that actually contain hours, including weeks on the
// other side of a time-zone boundary. Empty gaps cost no calendar scans.
export function suggestedTimes(people, tz, duration, notBefore) {
  const weeks = new Map();
  for (const person of people) {
    for (const [key, ranges] of Object.entries(person.weeks || {})) {
      if (!ranges.length) continue;
      const [year, month, day] = key.split('-').map(Number);
      const localMonday = { year, month, day };
      const from = zonedToEpoch(localMonday, 0, person.tz);
      const until = zonedToEpoch(addDays(localMonday, 7), 0, person.tz);
      if (until <= notBefore) continue;
      for (const instant of [from, until - 1]) {
        const date = zonedParts(instant, tz);
        const monday = addDays(date, -date.weekday);
        weeks.set(dateKey(monday), monday);
      }
    }
  }
  const candidates = [];
  for (const monday of weeks.values()) {
    const instants = rangeInstants(monday, tz, 8);
    const masks = availabilityMasks(instants, people);
    const data = { tz, monday, instants, people };
    for (let day = 0; day < 7; day++) {
      for (const choice of meetingStarts(masks, day, duration, instants, { tz, startDate: monday, notBefore })) {
        if (!choice.valid || !choice.count) continue;
        candidates.push({ ...choice, data, startMs: instants[choice.start],
          endMs: instants[choice.start] + Math.ceil(duration / SLOT) * SLOT * 60000 });
      }
    }
  }
  candidates.sort((a, b) => b.count - a.count || a.startMs - b.startMs);
  const accepted = [];
  const occupied = new Set();
  for (const candidate of candidates) {
    const cells = [];
    for (let time = candidate.startMs; time < candidate.endMs; time += SLOT * 60000) cells.push(time);
    if (cells.some(time => occupied.has(time))) continue;
    cells.forEach(time => occupied.add(time));
    accepted.push(candidate);
  }
  return accepted;
}
