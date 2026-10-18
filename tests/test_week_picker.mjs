import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendarDate, mondayForDate } from '../public/js/week-picker.js';

test('date picker jumps across the year to the containing Monday, without browser time zone conversion', () => {
  assert.deepEqual(mondayForDate(parseCalendarDate('2027-01-01')), { year: 2026, month: 12, day: 28 });
  assert.deepEqual(mondayForDate(parseCalendarDate('2027-01-03')), { year: 2026, month: 12, day: 28 });
  assert.deepEqual(mondayForDate(parseCalendarDate('2027-01-04')), { year: 2027, month: 1, day: 4 });
  assert.deepEqual(mondayForDate(parseCalendarDate('2028-02-29')), { year: 2028, month: 2, day: 28 });
});

test('incomplete or impossible dates cannot change the viewed week', () => {
  for (const value of ['', '2027-2-01', '2027-02-29', '2026-04-31', '2026-13-01', '0026-01-01', '2026-01-01x']) {
    assert.equal(parseCalendarDate(value), null, value);
  }
});
