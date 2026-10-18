import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoData } from '../public/js/demo-data.js';
import { displayBounds, meetingStarts } from '../public/js/overlap-model.js';
import { CELLS, PER_DAY, weekInstants } from '../public/js/schedule.js';

// Fix the sample week so the tests cover the same dates on every run.
function demo(tz = 'Asia/Shanghai', scenario = 'balanced', duration = 60) {
  return createDemoData(tz, scenario, duration, {
    startDate: { year: 2026, month: 10, day: 19 }, days: 7,
    now: Date.parse('2026-10-14T12:00:00Z'),
  });
}

function starts(data, day = 0) {
  return meetingStarts(data.masks, day, data.duration, data.instants, { tz: data.tz, monday: data.monday });
}

test('the balanced demo has a full one-hour window for all five people', () => {
  const data = demo();
  const selected = starts(data).find(row => row.slot === 34); // Monday 17:00 Beijing
  assert.deepEqual(data.monday, { year: 2026, month: 10, day: 19 });
  assert.equal(data.total, 5);
  assert.equal(selected.count, 5);
  assert.equal(selected.group, 31n);
  assert.equal(data.instants[selected.start + 2] - data.instants[selected.start], 60 * 60000);
});

test('unchanged headcounts cannot hide rotating participants within a meeting', () => {
  const masks = Array(CELLS).fill(0n);
  masks[18] = 0b0011n; // 09:00: Alex and Maya
  masks[19] = 0b0110n; // 09:30: Maya and Noah
  const oneHour = meetingStarts(masks, 0, 60).find(row => row.slot === 18);
  assert.equal(oneHour.group, 0b0010n);
  assert.equal(oneHour.count, 1);

  masks[19] = 0b1100n; // A completely different pair is free in the second half.
  assert.equal(meetingStarts(masks, 0, 60).find(row => row.slot === 18).count, 0);
  assert.equal(meetingStarts(masks, 0, 30).find(row => row.slot === 18).count, 2);
});

test('the partial demo fits everyone for 30 minutes but never a full hour', () => {
  const short = demo('Asia/Shanghai', 'partial', 30);
  const long = demo('Asia/Shanghai', 'partial', 60);
  assert.equal(starts(short).find(row => row.slot === 37).count, 5); // 18:30–19:00
  assert.ok(starts(long).find(row => row.slot === 37).count < 5);
  const allLongStarts = Array.from({ length: 7 }, (_, day) => starts(long, day)).flat();
  assert.ok(allLongStarts.every(row => row.count < long.total));
});

test('a pending response remains in the denominator and cannot count as available', () => {
  const data = demo('Asia/Shanghai', 'pending');
  const pending = data.people.find(person => person.responded === false);
  assert.equal(data.total, 5);
  assert.equal(data.people.filter(person => person.responded !== false).length, 4);
  assert.equal(pending.ranges.length, 0);
  assert.ok(data.masks.every(mask => (mask & pending.bit) === 0n));
  const rows = Array.from({ length: 7 }, (_, day) => starts(data, day)).flat();
  assert.equal(Math.max(...rows.map(row => row.count)), 4);
  assert.ok(rows.every(row => row.count < data.total));
});

test('changing the viewing zone preserves availability for the same real instant', () => {
  const reference = demo();
  const instant = Date.parse('2026-10-19T09:00:00Z'); // 17:00 Beijing
  const referenceMasks = new Map(Array.from(reference.instants.slice(0, CELLS), (time, i) => [time, reference.masks[i]]));
  for (const tz of ['UTC', 'Europe/London', 'Europe/Berlin', 'America/Los_Angeles']) {
    const converted = demo(tz);
    const index = converted.instants.indexOf(instant);
    assert.ok(index >= 0 && index < CELLS, `${tz} includes the selected instant`);
    const row = starts(converted, Math.floor(index / PER_DAY)).find(item => item.slot === index % PER_DAY);
    assert.equal(row.group, 31n, `${tz} preserves all five participants for the full hour`);
    let compared = 0;
    for (let i = 0; i < CELLS; i++) {
      if (!referenceMasks.has(converted.instants[i])) continue;
      assert.equal(converted.masks[i], referenceMasks.get(converted.instants[i]), `${tz} at ${new Date(converted.instants[i]).toISOString()}`);
      compared++;
    }
    assert.ok(compared >= 300, `${tz} compares a full overlapping portion of the week`);
  }
});

test('spring-forward gaps cannot appear as selectable common meeting times', () => {
  const monday = { year: 2026, month: 3, day: 2 };
  const tz = 'America/Los_Angeles';
  const instants = weekInstants(monday, tz);
  const masks = Array(CELLS).fill(31n);
  const rows = meetingStarts(masks, 6, 60, instants, { tz, monday });
  assert.equal(rows.find(row => row.slot === 2).count, 0, '01:00–02:00 is not a one-hour wall-clock window');
  assert.equal(rows.find(row => row.slot === 4).count, 0, '02:00 does not exist');
  assert.equal(rows.find(row => row.slot === 5).count, 0, '02:30 does not exist');
  assert.equal(rows.find(row => row.slot === 6).count, 5, '03:00–04:00 is a real one-hour window');
});

test('fall-back repeated time must not manufacture a one-hour recommendation', () => {
  const monday = { year: 2026, month: 10, day: 26 };
  const tz = 'America/Los_Angeles';
  const instants = weekInstants(monday, tz);
  const rows = meetingStarts(Array(CELLS).fill(31n), 6, 60, instants, { tz, monday });
  assert.equal(instants[6 * PER_DAY + 4] - instants[6 * PER_DAY + 2], 120 * 60000);
  assert.equal(rows.find(row => row.slot === 2).count, 0, '01:00–02:00 spans two real hours');
  assert.equal(rows.find(row => row.slot === 4).count, 5, '02:00–03:00 spans one real hour');
});

test('compact display includes availability at either edge of the day', () => {
  const masks = Array(CELLS).fill(0n);
  assert.deepEqual(displayBounds(masks, 0), [16, 40]);
  for (const slot of [0, 18, 47]) {
    masks.fill(0n);
    masks[slot] = 1n;
    const [from, to] = displayBounds(masks, 0);
    assert.ok(from >= 0 && to <= PER_DAY);
    assert.ok(from <= slot && to > slot);
    assert.ok(to - from >= 16, 'sparse days still have enough context to read');
  }
});
