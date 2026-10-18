import { nextOccurrence } from './meeting.js';

// `meetings` must come from an authorized API response. The current record
// wins over a list cached before a schedule was changed or cleared.
export function upcomingMeetings(meetings, current, now) {
  if (!current) return [];
  const participants = new Set(current.invitees);
  const unique = new Map(meetings.map(meeting => [meeting.id, meeting]));
  unique.set(current.id, current);
  return [...unique.values()]
    .filter(meeting => (meeting.workspaceId || null) === (current.workspaceId || null)
      && meeting.invitees.some(key => participants.has(key)))
    .map(meeting => ({ meeting, occurrence: nextOccurrence(meeting.schedule, meeting.duration, now) }))
    .filter(({ occurrence }) => occurrence && !occurrence.past)
    .sort((a, b) => a.occurrence.start - b.occurrence.start || a.meeting.title.localeCompare(b.meeting.title));
}
