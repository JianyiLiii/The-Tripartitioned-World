import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedTimes } from '../public/js/suggested-times.js';

test('suggestions span sparse future weeks, rank attendance and exclude the past', () => {
  const people = [
    { bit: 1n, tz: 'UTC', weeks: { '2026-10-12': [[540,600]], '2026-10-19': [[540,660]], '2027-02-01': [[540,600]] } },
    { bit: 2n, tz: 'UTC', weeks: { '2027-02-01': [[540,600]] } },
  ];
  const results = suggestedTimes(people, 'UTC', 60, Date.UTC(2026,9,18));
  assert.equal(results[0].startMs, Date.UTC(2027,1,1,9));
  assert.equal(results[0].count, 2);
  assert.equal(results.length, 3);
  assert.ok(results.some(result => result.startMs === Date.UTC(2026,9,19,9)));
  assert.ok(results.every(result => result.startMs > Date.UTC(2026,9,18)));
  assert.ok(results.every((a,i) => results.slice(i+1).every(b => a.endMs <= b.startMs || b.endMs <= a.startMs)));
});

test('Sunday night can finish in the next dated week across time zones', () => {
  const people = [
    { bit: 1n, tz: 'America/Vancouver', weeks: { '2026-10-12': [[10050,10080]], '2026-10-19': [[0,30]] } },
    { bit: 2n, tz: 'UTC', weeks: { '2026-10-19': [[390,450]] } },
  ];
  const results = suggestedTimes(people, 'America/Vancouver', 60, Date.UTC(2026,9,18));
  assert.equal(results.length, 1);
  assert.equal(results[0].count, 2);
  assert.equal(results[0].startMs, Date.UTC(2026,9,19,6,30));
  assert.equal(results[0].data.monday.day, 12);
});

test('no stored future hours means no suggestions', () => {
  assert.deepEqual(suggestedTimes([{bit:1n,tz:'UTC',weeks:{'2026-10-12':[]}}], 'UTC',60,0), []);
});
