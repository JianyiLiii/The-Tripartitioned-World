import { PER_DAY, SLOT, popcount } from './schedule.js';
import { addDays, sameDate, zonedParts } from './tz.js';

// A start time is suitable only if the SAME people remain free for the
// entire meeting. Counts at a single point in time are not enough.
export function meetingStarts(masks, day, duration, instants, { tz, monday, startDate = monday, notBefore = -Infinity } = {}) {
  const need = Math.max(1, Math.ceil(duration / SLOT));
  const starts = [];
  for (let slot = 0; slot < PER_DAY; slot++) {
    const start = day * PER_DAY + slot;
    if (start + need > masks.length) continue;
    if (instants && instants[start] < notBefore) continue;
    let valid = true;
    let group = BigInt(masks[start] || 0);
    for (let offset = 1; offset < need; offset++) group &= BigInt(masks[start + offset] || 0);
    // A nonexistent or repeated wall-clock cell must not manufacture a slot.
    if (instants && instants[start + need] - instants[start] !== need * SLOT * 60000) valid = false;
    if (valid && instants && tz && startDate) {
      for (let offset = 0; offset < need; offset++) {
        const expectedDate = addDays(startDate, day + Math.floor((slot + offset) / PER_DAY));
        const local = zonedParts(instants[start + offset], tz);
        if (!sameDate(local, expectedDate) || local.hour * 60 + local.minute !== ((slot + offset) % PER_DAY) * SLOT) { valid = false; break; }
      }
    }
    if (!valid) group = 0n;
    starts.push({ start, slot, group, count: popcount(group), valid });
  }
  return starts;
}

export function displayBounds(masks, day) {
  const active = [];
  for (let slot = 0; slot < PER_DAY; slot++) if (masks[day * PER_DAY + slot]) active.push(slot);
  if (!active.length) return [16, 40];
  let from = Math.max(0, Math.floor(active[0] / 2) * 2 - 2);
  let to = Math.min(PER_DAY, Math.ceil((active.at(-1) + 1) / 2) * 2 + 2);
  if (to - from < 16) { from = Math.max(0, from - (16 - to + from)); to = Math.min(PER_DAY, from + 16); }
  return [from, to];
}
