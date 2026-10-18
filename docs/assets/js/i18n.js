// Interface copy for the local project and meeting workspace.
import { now as serverNow } from './time.js';
import { tr, getLanguage } from './locale.js';

const STRINGS = {
  'app.tagline': 'Projects and meetings',

  'login.eyebrow': 'Sign in',
  'login.label': 'Your name',
  'login.placeholder': 'Enter your name',
  'login.submit': 'Continue',
  'login.wrong': 'Enter a valid name.',
  'login.rateLimited': 'Too many attempts. Try again in {min} min.',
  'login.notConfigured': 'Service unavailable. Check the local server.',
  'login.network': 'Cannot connect. Check that the local server is running.',
  'login.footnote': 'No account or password required. Use the same name to return.',

  'nav.signOut': 'Sign out',
  'nav.myTz': 'My time zone',

  'greet.morning': 'Good morning',
  'greet.afternoon': 'Good afternoon',
  'greet.evening': 'Good evening',
  'home.hello': '{name}',
  'home.sumUpcoming': '{n} upcoming',
  'home.sumPending': '{n} awaiting a time',
  'home.sumJoin': ' · ',
  'home.sumNone': 'No upcoming meetings.',
  'home.sumEmpty': 'Create a meeting and invite members.',
  'home.items': 'Meetings',
  'home.new': 'Create meeting',
  'home.filterAll': 'All',
  'home.upcoming': 'Upcoming',
  'home.pending': 'Unscheduled',
  'home.past': 'Past',
  'home.emptyTitle': 'No meetings yet',
  'home.emptyBody': 'Create a meeting to collect availability.',
  'home.emptyFilter': 'No meetings to show.',
  'home.tzBanner': 'Your device uses {detected}. Your saved time zone is {saved}.',
  'home.tzUpdate': 'Use {city}',
  'home.tzDismiss': 'Keep current setting',

  'item.responded': '{n}/{total} responded',
  'item.yourTime': 'Your local time',
  'item.weekly': 'Weekly',
  'item.once': 'One-time',
  'item.inMinutes': 'In {n} min',
  'item.inHours': 'In {n} hr',
  'item.inDay': 'Tomorrow',
  'item.inDays': 'In {n} days',
  'item.now': 'In progress',
  'item.ended': 'Ended',
  'item.noTime': 'Time not set',
  'item.by': 'Organized by {name}',
  'status.scheduled': 'Scheduled',
  'status.pending': 'Unscheduled',
  'status.past': 'Past',

  'meeting.new': 'Create meeting',
  'meeting.edit': 'Edit meeting',
  'meeting.title': 'Meeting name',
  'meeting.titlePh': 'e.g. Weekly project sync',
  'meeting.desc': 'Agenda (optional)',
  'meeting.descPh': 'Topics and preparation',
  'meeting.duration': 'Duration',
  'meeting.invitees': 'Select participants',
  'meeting.inviteesHint': 'Only invited members can view this meeting. Add more members in the project.',
  'meeting.link': 'Video call link (optional)',
  'meeting.linkPh': 'Paste a Zoom, Meet, or other video call link',
  'meeting.linkInvalid': 'Enter a valid http or https link.',
  'meeting.create': 'Create meeting',
  'meeting.save': 'Save changes',
  'meeting.delete': 'Delete meeting',
  'meeting.deleteConfirm': 'Delete "{title}" and its availability responses? This cannot be undone.',
  'meeting.deleted': 'Meeting deleted',
  'meeting.notFound': 'Meeting not found, or you have not been invited.',
  'meeting.back': 'All meetings',
  'meeting.organizer': 'Organizer',

  'flow.meetingCreated': 'Meeting created',
  'flow.availability': 'Add availability',
  'flow.confirmTime': 'Confirm time',
  'flow.startHint': 'Add your availability, then select a time from the responses.',
  'flow.waitHint': 'Availability saved. Review shared availability to choose a time.',
  'flow.doneHint': 'Time confirmed. Join the meeting or add it to your calendar.',
  'flow.fill': 'Add my availability',
  'flow.review': 'View shared availability',
  'flow.backProject': 'Back to project',
  'flow.backMeetings': 'Back to meetings',

  'd.time': 'Meeting time',
  'd.timeUnset': 'Time not set',
  'd.timeUnsetHint': 'Choose a suggested time after members respond, or set one manually.',
  'd.setManually': 'Set time',
  'd.change': 'Change',
  'd.unschedule': 'Clear scheduled time',
  'd.unscheduleConfirm': 'Clear the scheduled time? Availability responses will be kept.',
  'd.unscheduled': 'Scheduled time cleared',
  'd.addCalendar': 'Add to calendar',
  'd.yourTime': 'Your local time · {city}',
  'd.everyoneLocal': 'Participants’ local times',
  'd.everyoneNow': 'Current local times',
  'd.link': 'Meeting link',
  'd.join': 'Join meeting',
  'd.copy': 'Copy',
  'd.copied': 'Link copied',
  'd.noLink': 'No video call link added.',
  'd.addLink': 'Add link',
  'd.editLink': 'Edit',
  'd.removeLink': 'Remove link',
  'd.linkTitle': 'Video call link',
  'd.people': 'Participants',
  'd.editPeople': 'Invite members',
  'd.inviteTitle': 'Invite participants',
  'd.inviteHint': 'Invited members can view the meeting and add availability.',
  'd.responded': 'Responded',
  'd.waiting': 'Awaiting response',
  'd.schedEyebrow': 'Scheduling',
  'd.schedTitle': 'Availability',
  'd.schedSub': 'Enter availability in your local time. Shared times are calculated automatically.',
  'd.pick': 'Select time',
  'd.confirmTitle': 'Confirm meeting time',
  'd.once': 'One-time meeting',
  'd.weekly': 'Repeat weekly',
  'd.weeklyOn': '{weekday}',
  'd.confirm': 'Confirm time',
  'd.scheduled': 'Meeting time confirmed',
  'd.date': 'Date',
  'd.start': 'Start time',
  'd.inTz': '{city} time',

  'p.editorTitle': 'My availability',
  'p.editorHint': 'Enter your local times. Each member sees times in their own time zone.',
  'p.tz': 'My time zone',
  'p.change': 'Change',
  'p.tzMismatch': 'This availability uses {city}. Your current time zone is {current}.',
  'p.useTz': 'Use {city}',
  'p.none': '—',
  'p.start': 'Start',
  'p.end': 'End',
  'p.add': 'Add time slot',
  'p.remove': 'Remove',
  'p.dayMenu': 'More actions',
  'p.copyWeekdays': 'Copy to weekdays',
  'p.copyAll': 'Copy to every day',
  'p.clearDay': 'Clear day',
  'p.clearAll': 'Clear all',
  'p.clearAllConfirm': 'Clear all availability for this meeting? Save to apply the change.',
  'p.save': 'Save availability',
  'p.saving': 'Saving…',
  'p.saved': 'Saved',
  'p.unsaved': 'Unsaved changes',
  'p.savedAgo': 'Saved {ago}',
  'p.neverSaved': 'Not saved yet',
  'p.saveError': 'Could not save: {msg}',
  'p.leaveConfirm': 'Leave without saving your changes?',
  'p.leave': 'Leave',
  'p.tabMine': 'My availability',
  'p.tabOverlap': 'Shared availability',
  'p.thisWeek': 'This week',
  'p.prevWeek': 'Previous week',
  'p.nextWeek': 'Next week',
  'p.weekNote': 'Time zones and daylight saving time for {week}',
  'p.viewIn': 'Display time zone',
  'p.viewInCity': '{city} time',
  'p.otherZone': 'Other time zone…',
  'p.legendAvailable': 'Available',
  'p.legendOf': '/ {total} members',
  'p.legendMine': 'Me',
  'p.legendOthers': 'Other members available',
  'p.hintMine': 'Drag on the grid to add or clear availability.',
  'p.hintTouch': 'Tap to toggle · Hold and drag to select a range',
  'p.tipCount': '{n}/{total} available',
  'p.tipFree': 'Available',
  'p.tipBusy': 'Busy',
  'p.tipNotFilled': 'No response',
  'p.bestTitle': 'Suggested times',
  'p.bestSub': 'At least {d} · {city} time',
  'p.bestNone': 'No availability submitted yet.',
  'p.bestOnlyYou': 'Shared availability will appear after other members respond.',
  'p.bestShort': 'No shared time lasts {d}. These are the closest matches.',
  'p.bestNoOverlap': 'No shared availability between two or more members.',
  'p.bestEveryoneShort': 'Everyone shares up to {d}, less than the required {need}. These longer slots exclude some members.',
  'p.bestEveryone': 'Everyone',
  'p.bestCount': '{n}/{total} members',
  'p.bestMissing': 'Unavailable: {names}',
  'p.more': 'Show more',
  'p.less': 'Show less',

  'tz.title': 'Select time zone',
  'tz.search': 'Search countries or cities',
  'tz.detected': 'Use device time zone · {city}',
  'tz.zones': '{n} time zones',
  'tz.all': 'All',
  'tz.others': 'Other time zones',
  'tz.empty': 'No matching locations.',
  'tz.updated': 'Time zone set to {city}',
  'region.asia': 'Asia',
  'region.europe': 'Europe',
  'region.namerica': 'North America',
  'region.samerica': 'South America',
  'region.oceania': 'Oceania',
  'region.mideast': 'Middle East',
  'region.africa': 'Africa',

  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.back': 'Back',
  'common.ok': 'Confirm',
  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.error': 'Request failed: {msg}',
  'error.network': 'Cannot connect to the server',
  'error.unknown': 'Unknown error',

  'time.justNow': 'just now',
  'time.minAgo': '{n} min ago',
  'time.hourAgo': '{n} hr ago',
  'time.dayAgo': '{n}d ago',
  'dur.min': '{m} min',
  'dur.hour': '{h} hr',
  'dur.hourMin': '{h} hr {m} min',
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function t(key, vars) {
  const text = tr(STRINGS[key] ?? key);
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

export const weekday = index => tr(WEEKDAYS[index]);
export const weekdayLong = index => tr(WEEKDAYS_LONG[index]);
export const monthShort = month => getLanguage() === 'zh' ? `${month}月` : MONTHS[month - 1].slice(0, 3);
export const monthLong = month => tr(MONTHS[month - 1]);
export const monthDay = (month, day) => getLanguage() === 'zh' ? `${month}月${day}日` : `${monthShort(month)} ${day}`;

export function weekRange(start, end) {
  if (start.month === end.month) return `${monthDay(start.month, start.day)}–${end.day}${getLanguage() === 'zh' ? '日' : ''}`;
  return `${monthDay(start.month, start.day)} – ${monthDay(end.month, end.day)}`;
}

export function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return t('dur.min', { m });
  return m ? t('dur.hourMin', { h, m }) : t('dur.hour', { h });
}

export function ago(timestamp) {
  const minutes = Math.floor((serverNow() - timestamp) / 60000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hourAgo', { n: hours });
  return t('time.dayAgo', { n: Math.floor(hours / 24) });
}

export function greeting(hour) {
  if (hour >= 5 && hour < 12) return t('greet.morning');
  if (hour >= 12 && hour < 18) return t('greet.afternoon');
  return t('greet.evening');
}
