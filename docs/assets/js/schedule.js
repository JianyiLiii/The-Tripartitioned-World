import { tr } from './locale.js';
// Weekly availability and overlap math.
//
// Each person stores a repeating weekly schedule on their OWN wall clock:
// [start, end) minute ranges counted from Monday 00:00 in their time zone.
// To compare people, the viewer picks a concrete week; every half-hour cell of
// that week (on the viewer's clock) becomes a real instant, and that instant is
// looked up on each person's clock. Weeks repeat, so Sunday night wraps into
// Monday morning, and DST is exact for whichever week is being viewed.

import { addDays, weekMinute, zonedToEpoch, zonedParts } from './tz.js';

export const dateKey = date => `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
export function weekKeyAt(instant, tz) {
  const local = zonedParts(instant, tz);
  return dateKey(addDays(local, -local.weekday));
}

export const SLOT = 30;               // minutes per cell
export const PER_DAY = 48;
export const CELLS = 7 * PER_DAY;     // 336 cells in a week
export const WEEK = 7 * 24 * 60;      // 10080 minutes
const WEEK_MS = WEEK * 60000;

export function emptySlots() {
  return new Uint8Array(CELLS);
}

export function normalizeRanges(ranges) {
  const spans = ranges.filter(r => r[1] > r[0]).map(r => [r[0], r[1]]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of spans) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Is all of [a, b) inside the (normalized) weekly ranges? Wraps past Sunday. */
export function covers(ranges, a, b) {
  if (b > WEEK) return covers(ranges, a, WEEK) && covers(ranges, 0, b - WEEK);
  for (const [s, e] of ranges) {
    if (s > a) break;
    if (b <= e) return true;
  }
  return false;
}

export function slotsFromRanges(ranges) {
  const norm = normalizeRanges(ranges);
  const slots = emptySlots();
  for (let i = 0; i < CELLS; i++) {
    if (covers(norm, i * SLOT, i * SLOT + SLOT)) slots[i] = 1;
  }
  return slots;
}

export function rangesFromSlots(slots) {
  const out = [];
  for (let i = 0; i < CELLS;) {
    if (!slots[i]) { i++; continue; }
    let j = i + 1;
    while (j < CELLS && slots[j]) j++;
    out.push([i * SLOT, j * SLOT]);
    i = j;
  }
  return out;
}

/** Runs of selected cells within one day, as [startSlot, endSlot) pairs. */
export function dayRuns(slots, day) {
  const runs = [];
  const base = day * PER_DAY;
  for (let s = 0; s < PER_DAY;) {
    if (!slots[base + s]) { s++; continue; }
    let e = s + 1;
    while (e < PER_DAY && slots[base + e]) e++;
    runs.push([s, e]);
    s = e;
  }
  return runs;
}

export function hasAny(slots) {
  return slots.some(Boolean);
}

export function popcount(x) {
  let n = 0;
  for (let v = BigInt(x); v; v &= v - 1n) n++;
  return n;
}

/** Start instant of every cell in the week starting `monday` in `tz`, plus the end. */
export function rangeInstants(startDate, tz, days = 30) {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new RangeError(tr('Choose between 1 and 366 days.'));
  const length = days * PER_DAY;
  const out = new Float64Array(length + 1);
  for (let i = 0; i <= length; i++) {
    const day = Math.floor(i / PER_DAY);
    out[i] = zonedToEpoch(addDays(startDate, day), (i % PER_DAY) * SLOT, tz);
  }
  return out;
}

export function weekInstants(monday, tz) { return rangeInstants(monday, tz, 7); }

/**
 * Bitmask per cell of who is free for the whole cell.
 * people: [{ bit, tz, ranges }] with ranges on that person's own clock.
 * BigInt masks keep every participant, including meetings larger than 31 people.
 */
export function availabilityMasks(instants, people) {
  const cells = instants.length - 1;
  const masks = Array(cells).fill(0n);
  const localByTz = new Map();
  const weeksByTz = new Map();
  for (const person of people) {
    const weeks = person.weeks ? Object.fromEntries(Object.entries(person.weeks).map(([key, ranges]) => [key, normalizeRanges(ranges)])) : null;
    const ranges = normalizeRanges(person.ranges || []);
    if (!weeks && !ranges.length) continue;
    let weekKeys = weeksByTz.get(person.tz);
    if (weeks && !weekKeys) {
      weekKeys = Array.from({ length: cells * 2 }, (_, index) => weekKeyAt(instants[Math.floor(index / 2)] + index % 2 * 15 * 60000, person.tz));
      weeksByTz.set(person.tz, weekKeys);
    }
    let local = localByTz.get(person.tz);
    if (!local) {
      // Availability is entered in 15-minute steps. Check both halves in the
      // participant's zone: another country's DST transition can fall inside
      // a viewer's half-hour cell (for example a quarter-hour-offset zone).
      local = new Int16Array(cells * 2);
      for (let i = 0; i < cells; i++) {
        local[i * 2] = weekMinute(instants[i], person.tz);
        local[i * 2 + 1] = weekMinute(instants[i] + 15 * 60000, person.tz);
      }
      localByTz.set(person.tz, local);
    }
    for (let i = 0; i < cells; i++) {
      const firstRanges = weeks ? weeks[weekKeys[i * 2]] || [] : ranges;
      const secondRanges = weeks ? weeks[weekKeys[i * 2 + 1]] || [] : ranges;
      if (instants[i + 1] - instants[i] === SLOT * 60000
          && covers(firstRanges, local[i * 2], local[i * 2] + 15)
          && covers(secondRanges, local[i * 2 + 1], local[i * 2 + 1] + 15)) masks[i] |= BigInt(person.bit);
    }
  }
  return masks;
}

/** Instant at the end of a window that may run past Sunday into next week. */
export function windowEnd(instants, start, len) {
  const end = start + len;
  return end <= CELLS ? instants[end] : instants[end - CELLS] + WEEK_MS;
}

// Maximal runs of cells where pred holds, treating the week as a circle.
function circularRuns(masks, pred) {
  const ok = Array.from(masks, pred);
  const first = ok.indexOf(false);
  if (first < 0) return [{ start: 0, len: CELLS }];
  const runs = [];
  for (let k = 0; k < CELLS;) {
    const idx = (first + k) % CELLS;
    if (!ok[idx]) { k++; continue; }
    let len = 0;
    while (k < CELLS && ok[(first + k) % CELLS]) { len++; k++; }
    runs.push({ start: idx, len });
  }
  return runs;
}

function contains(outer, inner) {
  return ((inner.start - outer.start + CELLS) % CELLS) + inner.len <= outer.len;
}

/**
 * Time windows of at least `minCells` where the same group stays free,
 * largest groups first, then longest. `among` is the bitmask of people who
 * filled in; a window is dropped when a bigger group is free for all of it.
 */
export function bestWindows(masks, among, minCells, limit = 30) {
  among = BigInt(among);
  const bits = [];
  for (let remaining = among; remaining; remaining &= remaining - 1n) bits.push(remaining & -remaining);
  if (!bits.length) return [];

  let groups;
  if (bits.length <= 10) {
    groups = [];
    for (let combo = 1; combo < 1 << bits.length; combo++) {
      let mask = 0n;
      bits.forEach((bit, k) => { if (combo & (1 << k)) mask |= bit; });
      groups.push(mask);
    }
  } else {
    groups = [...new Set(Array.from(masks, m => m & among))].filter(Boolean);
  }
  groups.sort((a, b) => popcount(b) - popcount(a));

  const found = [];
  for (const group of groups) {
    for (const run of circularRuns(masks, m => (m & group) === group)) {
      if (run.len < minCells) continue;
      const covered = found.some(w => (w.group & group) === group && w.group !== group && contains(w, run));
      if (!covered) found.push({ group, count: popcount(group), start: run.start, len: run.len });
    }
  }
  found.sort((a, b) => b.count - a.count || b.len - a.len || a.start - b.start);
  return found.slice(0, limit);
}

export const RAMP_STEPS = 6;

/**
 * Ramp step (0-5) for "k of total people free"; more people, deeper wash.
 * The palest step is only needed for teams of six or more.
 */
export function rampStep(count, total) {
  const top = RAMP_STEPS - 1;
  if (total <= 1) return top;
  const first = total >= RAMP_STEPS ? 0 : 1;
  return first + Math.round(((count - 1) * (top - first)) / (total - 1));
}
