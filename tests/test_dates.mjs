import assert from 'node:assert/strict';
import test from 'node:test';
import { createClock } from '../public/js/time.js';
import { availabilityMasks, PER_DAY, rangeInstants } from '../public/js/schedule.js';
import { meetingStarts } from '../public/js/overlap-model.js';
import { addDays, zonedParts } from '../public/js/tz.js';

test('server clock corrects a wrong device date and keeps monotonic elapsed time', async () => {
  let monotonic = 100, wall = Date.parse('2035-01-01T00:00:00Z');
  const clock = createClock({ monotonic: () => monotonic, wall: () => wall });
  const server = Date.parse('2026-12-31T23:59:59Z');
  await clock.sync(async () => { monotonic += 200; return { unixMs: server, utc: new Date(server).toISOString() }; });
  assert.equal(clock.now(), server + 100);
  assert.equal(clock.ready, true);
  monotonic += 1000; wall += 1000;
  assert.equal(clock.now(), server + 1100);
  assert.equal(zonedParts(clock.now(), 'UTC').year, 2027);
  assert.equal(zonedParts(clock.now(), 'America/Toronto').year, 2026);
});

test('clock retains its server anchor on outage and flags a paused clock after sleep', async () => {
  let elapsed = 0, wall = 1000000;
  const clock = createClock({ monotonic: () => elapsed, wall: () => wall });
  const server = Date.parse('2026-10-17T23:00:00Z');
  await clock.sync(async () => ({ unixMs: server, utc: new Date(server).toISOString() }));
  elapsed += 60000; wall += 60000;
  await assert.rejects(clock.sync(async () => { throw new Error('offline'); }));
  assert.equal(clock.now(), server + 60000);
  assert.equal(clock.ready, true);
  wall += 3600000; // A browser whose monotonic clock pauses during laptop sleep.
  assert.equal(clock.ready, false);
  await assert.rejects(clock.sync(async () => ({ unixMs: server, utc: 'invalid' })));
  assert.equal(clock.ready, false);
  await clock.sync(async () => ({ unixMs: server + 3660000, utc: new Date(server + 3660000).toISOString() }));
  assert.equal(clock.ready, true);
});

test('rolling 90-day ranges retain every date across month, year and leap-day boundaries', () => {
  for (const start of [{ year: 2026, month: 12, day: 29 }, { year: 2028, month: 2, day: 27 }]) {
    const instants = rangeInstants(start, 'UTC', 90);
    assert.equal(instants.length, 90 * PER_DAY + 1);
    for (let day = 0; day <= 90; day++) {
      const local = zonedParts(instants[day * PER_DAY], 'UTC');
      const expected = addDays(start, day);
      assert.deepEqual({ year: local.year, month: local.month, day: local.day }, expected);
    }
  }
});

test('weekly rules project onto real weekdays beyond the first seven days', () => {
  const startDate = { year: 2026, month: 10, day: 17 }; // Saturday, not Monday.
  const instants = rangeInstants(startDate, 'UTC', 30);
  const masks = availabilityMasks(instants, [{ bit: 1n, tz: 'UTC', ranges: [[540, 600]] }]);
  assert.equal(masks.length, 30 * PER_DAY);
  assert.equal(masks[18], 0n);
  for (const day of [2, 9, 16, 23]) {
    const row = meetingStarts(masks, day, 60, instants, { tz: 'UTC', startDate }).find(row => row.slot === 18);
    assert.equal(row.count, 1);
    assert.equal(zonedParts(instants[row.start], 'UTC').weekday, 0);
  }
});

test('today excludes elapsed start times while later dates remain available', () => {
  const startDate = { year: 2026, month: 10, day: 17 };
  const instants = rangeInstants(startDate, 'UTC', 30);
  const masks = Array(instants.length - 1).fill(3n);
  const notBefore = Date.parse('2026-10-17T10:05:00Z');
  const options = { tz: 'UTC', startDate, notBefore };
  const rows = meetingStarts(masks, 0, 60, instants, options);
  assert.equal(rows[0].slot, 21);
  assert.ok(rows.every(row => instants[row.start] >= notBefore));
  assert.equal(meetingStarts(masks, 20, 60, instants, options)[0].slot, 0);
});

test('long ranges recalculate Canada/UK offsets across their different DST end dates', () => {
  const startDate = { year: 2026, month: 10, day: 17 };
  const instants = rangeInstants(startDate, 'UTC', 30);
  // Sunday 09:00–10:00 in each participant's own zone.
  const masks = availabilityMasks(instants, [
    { bit: 1n, tz: 'Europe/London', ranges: [[6 * 1440 + 540, 6 * 1440 + 600]] },
    { bit: 2n, tz: 'America/Toronto', ranges: [[6 * 1440 + 540, 6 * 1440 + 600]] },
  ]);
  const at = iso => masks[instants.indexOf(Date.parse(iso))];
  assert.equal(at('2026-10-18T08:00:00Z'), 1n);
  assert.equal(at('2026-10-25T09:00:00Z'), 1n);
  assert.equal(at('2026-10-25T13:00:00Z'), 2n);
  assert.equal(at('2026-11-01T14:00:00Z'), 2n);
});

test('a participant DST fold inside a quarter-offset viewer cell cannot create false availability', () => {
  const startDate = { year: 2026, month: 10, day: 25 }, tz = 'Asia/Kathmandu';
  const instants = rangeInstants(startDate, tz, 1);
  const masks = availabilityMasks(instants, [{ bit: 1n, tz: 'Europe/London',
    ranges: [[6 * 1440 + 90, 6 * 1440 + 150]] }]);
  const row = meetingStarts(masks, 0, 30, instants, { tz, startDate }).find(row => row.slot === 13);
  assert.equal(new Date(instants[row.start]).toISOString(), '2026-10-25T00:45:00.000Z');
  assert.equal(row.count, 0, 'London 01:45 rolls back to 01:00 during this half hour');
});

test('a full meeting can span midnight inside the calendar range without wrapping the range end', () => {
  const startDate = { year: 2026, month: 12, day: 31 }, tz = 'UTC';
  const instants = rangeInstants(startDate, tz, 30);
  const masks = Array(instants.length - 1).fill(0n);
  masks[47] = masks[48] = 3n;
  const row = meetingStarts(masks, 0, 60, instants, { tz, startDate }).find(row => row.slot === 47);
  assert.equal(row.count, 2);
  assert.equal(row.valid, true);
  assert.equal(new Date(instants[row.start + 2]).toISOString(), '2027-01-01T00:30:00.000Z');
  masks[masks.length - 1] = masks[0] = 3n;
  assert.ok(!meetingStarts(masks, 29, 60, instants, { tz, startDate }).some(row => row.slot === 47));
});
