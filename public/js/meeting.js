// A meeting's confirmed time, its calendar file, and its video-call link.
//
// schedule = { tz, date: 'YYYY-MM-DD', minute, repeat: 'none' | 'weekly' }:
// the start on the organizer's wall clock, so a weekly meeting stays at the
// organizer's local time across daylight-saving changes.

import { t } from './i18n.js';
import { addDays, zonedParts, zonedToEpoch } from './tz.js';
import { now as serverNow } from './time.js';

const WEEK_MS = 7 * 86400000;

export function parseDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

export function isoDate(date) {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/** The next occurrence still to finish (or the only one, possibly past). */
export function nextOccurrence(schedule, durationMin, now = serverNow()) {
  if (!schedule) return null;
  const anchor = parseDate(schedule.date);
  const length = durationMin * 60000;
  const at = weeks => {
    const start = zonedToEpoch(addDays(anchor, weeks * 7), schedule.minute, schedule.tz);
    return { start, end: start + length };
  };
  const first = at(0);
  if (schedule.repeat !== 'weekly') return { ...first, weekly: false, past: first.end <= now };
  let weeks = Math.max(0, Math.floor((now - first.start) / WEEK_MS) - 1);
  let next = at(weeks);
  while (next.end <= now) next = at(++weeks);
  return { ...next, weekly: true, past: false };
}

/** "in 3 d", "in 2 h", "now", or "ended". */
export function relativeTime(occurrence, now = serverNow()) {
  if (occurrence.past) return t('item.ended');
  if (occurrence.start <= now) return t('item.now');
  const minutes = Math.round((occurrence.start - now) / 60000);
  if (minutes < 60) return t('item.inMinutes', { n: Math.max(1, minutes) });
  const hours = Math.round(minutes / 60);
  if (hours < 36) return t('item.inHours', { n: hours });
  const days = Math.round(hours / 24);
  return days === 1 ? t('item.inDay') : t('item.inDays', { n: days });
}

// ------------------------------------------------------------- calendar --

const pad = n => String(n).padStart(2, '0');

function utcStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

function localStamp(ms, tz) {
  const p = zonedParts(ms, tz);
  return `${p.year}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}00`;
}

const escapeText = text => text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545: lines longer than 75 octets continue on the next line after a space.
function fold(line) {
  const bytes = new TextEncoder();
  let out = '', chunk = '';
  for (const ch of line) {
    if (bytes.encode(chunk + ch).length > (out ? 74 : 75)) {
      out += (out ? '\r\n ' : '') + chunk;
      chunk = '';
    }
    chunk += ch;
  }
  return out ? `${out}\r\n ${chunk}` : chunk;
}

/** An .ics file for the meeting: one event, repeating weekly when it does. */
export function calendarFile(project) {
  const { schedule } = project;
  const first = nextOccurrence(schedule, project.duration, 0);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Tripartitioned World//Meeting planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${project.id}@overlap`, `DTSTAMP:${utcStamp(serverNow())}`,
  ];
  if (schedule.repeat === 'weekly') {
    lines.push(`DTSTART;TZID=${schedule.tz}:${localStamp(first.start, schedule.tz)}`,
      `DTEND;TZID=${schedule.tz}:${localStamp(first.end, schedule.tz)}`, 'RRULE:FREQ=WEEKLY');
  } else {
    lines.push(`DTSTART:${utcStamp(first.start)}`, `DTEND:${utcStamp(first.end)}`);
  }
  lines.push(`SUMMARY:${escapeText(project.title)}`);
  const notes = [project.description, project.link].filter(Boolean).join('\n\n');
  if (notes) lines.push(`DESCRIPTION:${escapeText(notes)}`);
  if (project.link) lines.push(`LOCATION:${escapeText(project.link)}`, `URL:${project.link}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- links --

const PROVIDERS = [
  [/(^|\.)zoom\.(us|com|com\.cn)$/, 'Zoom'],
  [/^meet\.google\.com$/, 'Google Meet'],
  [/(^|\.)teams\.(microsoft|live)\.com$/, 'Microsoft Teams'],
  [/(^|\.)meeting\.tencent\.com$/, 'Tencent Meeting'],
  [/(^|\.)voovmeeting\.com$/, 'VooV Meeting'],
  [/(^|\.)(feishu\.cn|larksuite\.com)$/, 'Lark'],
  [/(^|\.)dingtalk\.com$/, 'DingTalk'],
  [/(^|\.)webex\.com$/, 'Webex'],
  [/(^|\.)whereby\.com$/, 'Whereby'],
  [/(^|\.)discord\.(gg|com)$/, 'Discord'],
  [/(^|\.)slack\.com$/, 'Slack'],
];

/** { provider, host, short } for display, or null when it isn't a URL. */
export function linkInfo(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const match = PROVIDERS.find(([re]) => re.test(host));
  const path = parsed.pathname.length > 1 ? parsed.pathname : '';
  return { provider: match ? match[1] : null, host, short: `${host}${path}` };
}

/** Accept "zoom.us/j/123" as https://zoom.us/j/123. */
export function normalizeLink(text) {
  const value = text.trim();
  if (!value) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}

export function isWebLink(text) {
  try {
    const u = new URL(text);
    return (u.protocol === 'https:' || u.protocol === 'http:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}
