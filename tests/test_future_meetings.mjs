import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingMeetings } from '../public/js/future-meetings.js';

const now = Date.parse('2026-12-31T12:00:00Z');
const schedule = (date, minute = 13 * 60, repeat = 'none', tz = 'UTC') => ({ date, minute, repeat, tz });
const meeting = (id, fields = {}) => ({
  id, title: id, workspaceId: 'workspace-a', invitees: ['alex', 'maya'], duration: 60, schedule: null, ...fields,
});
const current = meeting('current');

test('future list excludes pending and finished meetings and sorts actual start times', () => {
  const rows = upcomingMeetings([
    meeting('later', { schedule: schedule('2027-01-02') }),
    meeting('pending'),
    meeting('past', { schedule: schedule('2026-12-30') }),
    meeting('earlier', { schedule: schedule('2027-01-01') }),
  ], current, now);
  assert.deepEqual(rows.map(row => row.meeting.id), ['earlier', 'later']);
});

test('future list only includes meetings in the same project with a current participant', () => {
  const rows = upcomingMeetings([
    meeting('shared', { invitees: ['maya', 'noah'], schedule: schedule('2027-01-01') }),
    meeting('unrelated', { invitees: ['noah', 'emma'], schedule: schedule('2027-01-01') }),
    meeting('other-project', { workspaceId: 'workspace-b', schedule: schedule('2027-01-01') }),
    meeting('legacy', { workspaceId: undefined, schedule: schedule('2027-01-01') }),
  ], current, now);
  assert.deepEqual(rows.map(row => row.meeting.id), ['shared']);
});

test('a repeating meeting shows only its next occurrence, including a meeting in progress', () => {
  const rows = upcomingMeetings([
    meeting('weekly', { schedule: schedule('2026-12-17', 11 * 60 + 30, 'weekly') }),
  ], current, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].occurrence.start, Date.parse('2026-12-31T11:30:00Z'));
  assert.equal(rows[0].occurrence.weekly, true);
  assert.equal(rows[0].occurrence.past, false);
});

test('current schedule replaces cached duplicates immediately after saving or clearing', () => {
  const cached = meeting('current', { schedule: schedule('2027-01-01') });
  const updated = meeting('current', { schedule: schedule('2027-01-03') });
  const rows = upcomingMeetings([cached, cached], updated, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].occurrence.start, Date.parse('2027-01-03T13:00:00Z'));
  assert.deepEqual(upcomingMeetings([cached], current, now), []);
});

test('legacy meetings stay in the legacy scope and finished recurring weeks advance', () => {
  const legacy = meeting('legacy-current', { workspaceId: undefined });
  const rows = upcomingMeetings([
    meeting('legacy-weekly', { workspaceId: undefined, schedule: schedule('2026-12-17', 10 * 60, 'weekly') }),
    meeting('project-meeting', { schedule: schedule('2027-01-01') }),
  ], legacy, now);
  assert.deepEqual(rows.map(row => row.meeting.id), ['legacy-weekly']);
  assert.equal(rows[0].occurrence.start, Date.parse('2027-01-07T10:00:00Z'));
});
