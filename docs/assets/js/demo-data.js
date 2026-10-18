// Isolated sample schedules. No profile, project, or availability is saved.
import { availabilityMasks, emptySlots, rangesFromSlots, SLOT, rangeInstants } from './schedule.js';
import { addDays, mondayOf, weekMinute, zonedParts, zonedToEpoch } from './tz.js';
import { now as serverNow, clockReady } from './time.js';

const SOURCE_TZ = 'Asia/Shanghai';
const MEMBERS = [
  { key: 'sample-1', name: 'Member 1', index: 0, tz: 'Asia/Shanghai' },
  { key: 'sample-2', name: 'Member 2', index: 1, tz: 'Asia/Shanghai' },
  { key: 'sample-3', name: 'Member 3', index: 2, tz: 'Asia/Singapore' },
  { key: 'sample-4', name: 'Member 4', index: 3, tz: 'Europe/London' },
  { key: 'sample-5', name: 'Member 5', index: 4, tz: 'Europe/Berlin' },
];

// Monday through Friday, expressed on the Shanghai clock. Convert each real
// half-hour to the member's own weekly clock before using the real scheduler.
const BANDS = [
  [[15, 19], [16, 20], [15, 18], [16, 21], [15, 19]],
  [[16, 20], [15, 19], [16, 20], [17, 21], [16, 20]],
  [[17, 21], [17, 21], [15, 19], [16, 20], [17, 21]],
  [[16, 19], [16, 18], [17, 21], [18, 22], [16, 19]],
  [[17, 20], [18, 22], [17, 20], [18, 21], [18, 22]],
];
const LIMITED_BANDS = [[18.5, 22], [18, 22], [17.5, 21], [19.5, 22], [18.5, 22]];

function localRanges(monday, tz, bands) {
  const slots = emptySlots();
  bands.forEach(([start, end], day) => {
    const date = addDays(monday, day);
    for (let minute = start * 60; minute < end * 60; minute += SLOT) {
      const instant = zonedToEpoch(date, minute, SOURCE_TZ);
      slots[weekMinute(instant, tz) / SLOT] = 1;
    }
  });
  return rangesFromSlots(slots);
}

export function createDemoData(tz = SOURCE_TZ, scenario = 'balanced', duration = 60, options = {}) {
  const currentTime = options.now ?? serverNow();
  const { year, month, day } = zonedParts(currentTime, tz);
  const startDate = options.startDate || { year, month, day };
  const days = Math.max(1, Math.min(90, Math.floor(options.days || 30)));
  // Sample availability is a weekly recurrence in each person's own time zone.
  // Anchor its initial conversion to the supplied clock, then recalculate every
  // real future date independently so DST changes remain visible.
  const sourceMonday = mondayOf(SOURCE_TZ, 0, currentTime);
  const people = MEMBERS.map((profile, index) => {
    const member = { ...profile };
    const responded = !(scenario === 'pending' && index === 4);
    const bands = scenario === 'partial' && index === 4 ? LIMITED_BANDS : BANDS[index];
    return {
      member,
      bit: 1n << BigInt(index),
      tz: member.tz,
      ranges: responded ? localRanges(sourceMonday, member.tz, bands) : [],
      responded,
    };
  });
  const instants = rangeInstants(startDate, tz, days);
  return { startDate, monday: startDate, days, now: currentTime, timeReady: options.timeReady ?? clockReady(), tz, instants,
    masks: availabilityMasks(instants, people), people, duration, total: MEMBERS.length };
}
