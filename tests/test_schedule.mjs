import assert from 'node:assert/strict';
import test from 'node:test';
import { availabilityMasks, bestWindows, popcount, weekInstants } from '../public/js/schedule.js';

const monday = { year: 2026, month: 10, day: 12 };
const instants = weekInstants(monday, 'UTC');

test('all 40 participants contribute to the same recommended time', () => {
  const people = Array.from({ length: 40 }, (_, index) => ({
    bit: 1n << BigInt(index), tz: 'UTC', ranges: [[540, 600]],
  }));
  const among = people.reduce((mask, person) => mask | person.bit, 0n);
  const masks = availabilityMasks(instants, people);
  assert.equal(popcount(among), 40);
  assert.equal(masks[18], among);
  assert.equal(masks[17], 0n);
  assert.deepEqual(bestWindows(masks, among, 2), [
    { group: among, count: 40, start: 18, len: 2 },
  ]);
});

test('high participant bits retain subset recommendations and full-group overlap', () => {
  const a = 1n, b = 1n << 63n, c = 1n << 127n;
  const masks = availabilityMasks(instants, [
    { bit: a, tz: 'UTC', ranges: [[540, 660]] },
    { bit: b, tz: 'UTC', ranges: [[540, 660]] },
    { bit: c, tz: 'UTC', ranges: [[600, 660]] },
  ]);
  const windows = bestWindows(masks, a | b | c, 2);
  assert.deepEqual(windows, [
    { group: a | b | c, count: 3, start: 20, len: 2 },
    { group: a | b, count: 2, start: 18, len: 4 },
  ]);
});

test('a shared window still wraps from Sunday into Monday', () => {
  const people = [0, 39].map(index => ({
    bit: 1n << BigInt(index), tz: 'UTC', ranges: [[0, 60], [10020, 10080]],
  }));
  const among = people[0].bit | people[1].bit;
  assert.deepEqual(bestWindows(availabilityMasks(instants, people), among, 4), [
    { group: among, count: 2, start: 334, len: 4 },
  ]);
});

test('large masks preserve the actual time-zone overlap across a DST change', () => {
  const dstWeek = weekInstants({ year: 2026, month: 3, day: 2 }, 'UTC');
  const low = 1n, high = 1n << 60n;
  const masks = availabilityMasks(dstWeek, [
    { bit: low, tz: 'America/Los_Angeles', ranges: [[8820, 8880]] },
    { bit: high, tz: 'UTC', ranges: [[9240, 9300]] },
  ]);
  assert.equal(masks[308], low | high);
  assert.equal(masks[306], 0n);
  assert.deepEqual(bestWindows(masks, low | high, 2), [
    { group: low | high, count: 2, start: 308, len: 2 },
  ]);
});
