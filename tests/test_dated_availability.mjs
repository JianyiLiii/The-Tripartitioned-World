import test from 'node:test';
import assert from 'node:assert/strict';
import { availabilityMasks, rangeInstants, dateKey, weekKeyAt } from '../public/js/schedule.js';

test('hours belong to one local week and do not repeat into the following week', () => {
  const person = { bit: 1n, tz: 'UTC', weeks: { '2026-10-12': [[9180, 10080]] } };
  assert.equal(availabilityMasks(rangeInstants({ year: 2026, month: 10, day: 12 }, 'UTC', 7), [person])[306], 1n);
  assert.ok(availabilityMasks(rangeInstants({ year: 2026, month: 10, day: 19 }, 'UTC', 7), [person]).every(value => value === 0n));
});

test('a viewer sees the correct participant date across a Sunday/Monday timezone boundary', () => {
  const people = [
    { bit: 1n, tz: 'America/Vancouver', weeks: { '2026-10-12': [[10020, 10080]], '2026-10-19': [[0, 60]] } },
    { bit: 2n, tz: 'Europe/London', weeks: { '2026-10-19': [[7 * 60, 9 * 60]] } },
  ];
  const instants = rangeInstants({ year: 2026, month: 10, day: 19 }, 'Europe/London', 7);
  const masks = availabilityMasks(instants, people);
  assert.deepEqual(masks.slice(14, 18), [3n, 3n, 3n, 3n]);
  assert.equal(masks[18], 0n);
  delete people[0].weeks['2026-10-19'];
  assert.deepEqual(availabilityMasks(instants, people).slice(14, 18), [3n, 3n, 2n, 2n]);
});

test('dated weeks cover year boundaries and keep DST calculations date-specific', () => {
  assert.equal(dateKey({year: 2026, month: 12, day: 28}), '2026-12-28');
  assert.equal(weekKeyAt(Date.UTC(2027, 0, 1), 'UTC'), '2026-12-28');
  const instants = rangeInstants({year: 2026, month: 10, day: 26}, 'America/Vancouver', 7);
  const masks = availabilityMasks(instants, [{bit: 1n, tz: 'America/Vancouver', weeks: {'2026-10-26': [[0, 10080]]}}]);
  // The repeated DST cell is not treated as an ordinary half-hour meeting slot.
  for(let i=0;i<masks.length;i++) if(instants[i+1]-instants[i]!==1800000) assert.equal(masks[i],0n);
});
