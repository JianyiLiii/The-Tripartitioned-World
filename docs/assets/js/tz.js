// Time zone math on top of Intl, which ships the full IANA database in every
// modern browser, so daylight saving is handled without any library.
// Also: the major countries of the world and their zones, for the picker.

import { tr, getLanguage } from './locale.js';
const formatters = new Map();

function partsFormatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a zone. weekday: 0 = Monday … 6 = Sunday. */
export function zonedParts(epochMs, tz) {
  const parts = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(epochMs))) parts[p.type] = p.value;
  const year = +parts.year, month = +parts.month, day = +parts.day;
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return { year, month, day, hour: +parts.hour % 24, minute: +parts.minute, second: +parts.second, weekday };
}

/** Minutes the zone is ahead of UTC at that instant (Vancouver in summer: -420). */
export function offsetMinutes(tz, epochMs) {
  const p = zonedParts(epochMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60000);
}

/** The instant when the clock in `tz` shows that date and time. */
export function zonedToEpoch(date, minuteOfDay, tz) {
  const guess = Date.UTC(date.year, date.month - 1, date.day, 0, minuteOfDay);
  const first = offsetMinutes(tz, guess);
  let t = guess - first * 60000;
  const second = offsetMinutes(tz, t);
  if (second !== first) t = guess - second * 60000; // the guess straddled a DST change
  return t;
}

/** Minutes since Monday 00:00 on the local clock of `tz`. */
export function weekMinute(epochMs, tz) {
  const p = zonedParts(epochMs, tz);
  return p.weekday * 1440 + p.hour * 60 + p.minute;
}

export function addDays(date, n) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function sameDate(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function weekdayOf(date) {
  return (new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() + 6) % 7;
}

/** The Monday of the current week in `tz`, shifted by whole weeks. */
export function mondayOf(tz, weekOffset = 0, now = Date.now()) {
  const p = zonedParts(now, tz);
  return addDays(p, -p.weekday + weekOffset * 7);
}

export function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Same clock all year? Windows reports Pacific time as Los Angeles even in
 * Vancouver, so compare offsets now and half a year away, not names.
 */
export function sameClock(a, b, now = Date.now()) {
  if (a === b) return true;
  if (!isValidTimeZone(a) || !isValidTimeZone(b)) return false;
  const later = now + 182 * 86400000;
  return offsetMinutes(a, now) === offsetMinutes(b, now) && offsetMinutes(a, later) === offsetMinutes(b, later);
}

export function hm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function clock(tz, epochMs = Date.now()) {
  const p = zonedParts(epochMs, tz);
  return hm(p.hour * 60 + p.minute);
}

export function formatOffset(minutes) {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const mm = abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : '';
  return `UTC${sign}${Math.floor(abs / 60)}${mm}`;
}

// ------------------------------------------------------- countries & zones --
// Major countries and the zones people actually live in. Rows:
//   [code, name, region, search aliases, zones]
//   zone: [IANA id, city, area, search aliases]
// Anything else in Intl.supportedValuesOf('timeZone') stays searchable by id.

const COUNTRY_ROWS = [
  ['CN', 'China', 'asia', 'prc', [['Asia/Shanghai', 'Beijing', '', 'shanghai shenzhen guangzhou hangzhou chengdu nanjing wuhan xian chongqing']]],
  ['HK', 'Hong Kong', 'asia', 'hk', [['Asia/Hong_Kong', 'Hong Kong', '', '']]],
  ['MO', 'Macao', 'asia', 'macau', [['Asia/Macau', 'Macao', '', 'macau']]],
  ['TW', 'Taiwan', 'asia', '', [['Asia/Taipei', 'Taipei', '', 'kaohsiung hsinchu taichung']]],
  ['JP', 'Japan', 'asia', 'nippon', [['Asia/Tokyo', 'Tokyo', '', 'osaka kyoto yokohama']]],
  ['KR', 'South Korea', 'asia', 'korea', [['Asia/Seoul', 'Seoul', '', 'busan']]],
  ['SG', 'Singapore', 'asia', '', [['Asia/Singapore', 'Singapore', '', '']]],
  ['MY', 'Malaysia', 'asia', '', [['Asia/Kuala_Lumpur', 'Kuala Lumpur', '', 'penang']]],
  ['TH', 'Thailand', 'asia', '', [['Asia/Bangkok', 'Bangkok', '', 'chiang mai phuket']]],
  ['VN', 'Vietnam', 'asia', '', [['Asia/Ho_Chi_Minh', 'Ho Chi Minh City', '', 'hanoi saigon']]],
  ['PH', 'Philippines', 'asia', '', [['Asia/Manila', 'Manila', '', 'cebu']]],
  ['ID', 'Indonesia', 'asia', '', [
    ['Asia/Jakarta', 'Jakarta', 'Western', 'wib surabaya'],
    ['Asia/Makassar', 'Bali', 'Central', 'wita makassar denpasar'],
    ['Asia/Jayapura', 'Jayapura', 'Eastern', 'wit papua'],
  ]],
  ['IN', 'India', 'asia', 'bharat', [['Asia/Kolkata', 'New Delhi', '', 'mumbai bangalore bengaluru delhi kolkata calcutta hyderabad chennai']]],
  ['PK', 'Pakistan', 'asia', '', [['Asia/Karachi', 'Karachi', '', 'islamabad lahore']]],
  ['BD', 'Bangladesh', 'asia', '', [['Asia/Dhaka', 'Dhaka', '', '']]],
  ['NP', 'Nepal', 'asia', '', [['Asia/Kathmandu', 'Kathmandu', '', 'katmandu']]],
  ['LK', 'Sri Lanka', 'asia', '', [['Asia/Colombo', 'Colombo', '', '']]],
  ['KZ', 'Kazakhstan', 'asia', '', [['Asia/Almaty', 'Almaty', '', 'astana']]],
  ['MN', 'Mongolia', 'asia', '', [['Asia/Ulaanbaatar', 'Ulaanbaatar', '', 'ulan bator']]],

  ['AE', 'United Arab Emirates', 'mideast', 'uae emirates', [['Asia/Dubai', 'Dubai', '', 'abu dhabi']]],
  ['SA', 'Saudi Arabia', 'mideast', 'ksa', [['Asia/Riyadh', 'Riyadh', '', 'jeddah']]],
  ['QA', 'Qatar', 'mideast', '', [['Asia/Qatar', 'Doha', '', '']]],
  ['IL', 'Israel', 'mideast', '', [['Asia/Jerusalem', 'Jerusalem', '', 'tel aviv']]],
  ['TR', 'Türkiye', 'mideast', 'turkey turkiye', [['Europe/Istanbul', 'Istanbul', '', 'ankara']]],
  ['IR', 'Iran', 'mideast', '', [['Asia/Tehran', 'Tehran', '', '']]],

  ['GB', 'United Kingdom', 'europe', 'uk britain england scotland wales', [['Europe/London', 'London', '', 'manchester edinburgh birmingham cambridge oxford']]],
  ['IE', 'Ireland', 'europe', '', [['Europe/Dublin', 'Dublin', '', '']]],
  ['FR', 'France', 'europe', '', [['Europe/Paris', 'Paris', '', 'lyon marseille']]],
  ['DE', 'Germany', 'europe', 'deutschland', [['Europe/Berlin', 'Berlin', '', 'munich frankfurt hamburg']]],
  ['NL', 'Netherlands', 'europe', 'holland', [['Europe/Amsterdam', 'Amsterdam', '', 'rotterdam']]],
  ['BE', 'Belgium', 'europe', '', [['Europe/Brussels', 'Brussels', '', '']]],
  ['CH', 'Switzerland', 'europe', 'swiss', [['Europe/Zurich', 'Zurich', '', 'geneva']]],
  ['AT', 'Austria', 'europe', '', [['Europe/Vienna', 'Vienna', '', '']]],
  ['IT', 'Italy', 'europe', '', [['Europe/Rome', 'Rome', '', 'milan']]],
  ['ES', 'Spain', 'europe', '', [['Europe/Madrid', 'Madrid', '', 'barcelona']]],
  ['PT', 'Portugal', 'europe', '', [['Europe/Lisbon', 'Lisbon', '', 'porto']]],
  ['SE', 'Sweden', 'europe', '', [['Europe/Stockholm', 'Stockholm', '', '']]],
  ['NO', 'Norway', 'europe', '', [['Europe/Oslo', 'Oslo', '', '']]],
  ['DK', 'Denmark', 'europe', '', [['Europe/Copenhagen', 'Copenhagen', '', '']]],
  ['FI', 'Finland', 'europe', '', [['Europe/Helsinki', 'Helsinki', '', '']]],
  ['PL', 'Poland', 'europe', '', [['Europe/Warsaw', 'Warsaw', '', 'krakow']]],
  ['CZ', 'Czechia', 'europe', 'czech republic', [['Europe/Prague', 'Prague', '', '']]],
  ['GR', 'Greece', 'europe', '', [['Europe/Athens', 'Athens', '', '']]],
  ['UA', 'Ukraine', 'europe', '', [['Europe/Kyiv', 'Kyiv', '', 'kiev']]],
  ['RU', 'Russia', 'europe', '', [
    ['Europe/Moscow', 'Moscow', '', 'st petersburg'],
    ['Asia/Yekaterinburg', 'Yekaterinburg', '', ''],
    ['Asia/Novosibirsk', 'Novosibirsk', '', ''],
    ['Asia/Vladivostok', 'Vladivostok', '', ''],
  ]],

  ['US', 'United States', 'namerica', 'usa america', [
    ['America/New_York', 'New York', 'Eastern', 'boston washington miami atlanta philadelphia et est edt'],
    ['America/Chicago', 'Chicago', 'Central', 'houston dallas austin ct cst cdt'],
    ['America/Denver', 'Denver', 'Mountain', 'salt lake city mt mst mdt'],
    ['America/Phoenix', 'Phoenix', 'Arizona', ''],
    ['America/Los_Angeles', 'Los Angeles', 'Pacific', 'san francisco seattle silicon valley san diego portland las vegas pt pst pdt'],
    ['America/Anchorage', 'Anchorage', 'Alaska', ''],
    ['Pacific/Honolulu', 'Honolulu', 'Hawaii', ''],
  ]],
  ['CA', 'Canada', 'namerica', '', [
    ['America/Vancouver', 'Vancouver', 'Pacific', 'victoria ubc bc british columbia'],
    ['America/Edmonton', 'Calgary', 'Mountain', 'edmonton alberta'],
    ['America/Winnipeg', 'Winnipeg', 'Central', 'saskatoon manitoba'],
    ['America/Toronto', 'Toronto', 'Eastern', 'ottawa montreal waterloo quebec'],
    ['America/Halifax', 'Halifax', 'Atlantic', 'nova scotia'],
    ['America/St_Johns', "St. John's", 'Newfoundland', 'st johns'],
  ]],
  ['MX', 'Mexico', 'namerica', '', [
    ['America/Mexico_City', 'Mexico City', '', 'guadalajara'],
    ['America/Cancun', 'Cancún', '', 'cancun'],
    ['America/Tijuana', 'Tijuana', '', ''],
  ]],

  ['BR', 'Brazil', 'samerica', 'brasil', [
    ['America/Sao_Paulo', 'São Paulo', '', 'rio de janeiro brasilia'],
    ['America/Manaus', 'Manaus', '', 'amazon'],
  ]],
  ['AR', 'Argentina', 'samerica', '', [['America/Argentina/Buenos_Aires', 'Buenos Aires', '', '']]],
  ['CL', 'Chile', 'samerica', '', [['America/Santiago', 'Santiago', '', '']]],
  ['CO', 'Colombia', 'samerica', '', [['America/Bogota', 'Bogotá', '', 'bogota']]],
  ['PE', 'Peru', 'samerica', '', [['America/Lima', 'Lima', '', '']]],

  ['AU', 'Australia', 'oceania', 'aussie', [
    ['Australia/Sydney', 'Sydney', 'Eastern', 'canberra nsw'],
    ['Australia/Melbourne', 'Melbourne', 'Eastern', 'victoria'],
    ['Australia/Brisbane', 'Brisbane', 'Queensland', 'gold coast'],
    ['Australia/Adelaide', 'Adelaide', 'Central', ''],
    ['Australia/Perth', 'Perth', 'Western', ''],
  ]],
  ['NZ', 'New Zealand', 'oceania', '', [['Pacific/Auckland', 'Auckland', '', 'wellington christchurch']]],

  ['EG', 'Egypt', 'africa', '', [['Africa/Cairo', 'Cairo', '', '']]],
  ['ZA', 'South Africa', 'africa', '', [['Africa/Johannesburg', 'Johannesburg', '', 'cape town']]],
  ['NG', 'Nigeria', 'africa', '', [['Africa/Lagos', 'Lagos', '', 'abuja']]],
  ['KE', 'Kenya', 'africa', '', [['Africa/Nairobi', 'Nairobi', '', '']]],
  ['MA', 'Morocco', 'africa', '', [['Africa/Casablanca', 'Casablanca', '', 'rabat']]],
  ['ET', 'Ethiopia', 'africa', '', [['Africa/Addis_Ababa', 'Addis Ababa', '', '']]],

  ['UTC', 'Coordinated Universal Time', 'other', 'gmt utc z', [['UTC', 'UTC', '', '']]],
];

export const REGIONS = ['asia', 'europe', 'namerica', 'samerica', 'oceania', 'mideast', 'africa'];

// Spellings browsers may report or understand instead of ours (older ICU data).
const ALIASES = {
  'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires', 'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar', 'America/Montreal': 'America/Toronto', 'Asia/Chongqing': 'Asia/Shanghai',
  'Asia/Harbin': 'Asia/Shanghai', PRC: 'Asia/Shanghai', 'Etc/UTC': 'UTC', 'Etc/GMT': 'UTC', GMT: 'UTC',
  'Etc/Universal': 'UTC', Universal: 'UTC', Zulu: 'UTC', 'US/Pacific': 'America/Los_Angeles',
  'US/Eastern': 'America/New_York', 'US/Central': 'America/Chicago', 'US/Mountain': 'America/Denver',
  'Canada/Pacific': 'America/Vancouver', 'Canada/Eastern': 'America/Toronto', 'Australia/ACT': 'Australia/Sydney',
};
const OLD_NAMES = Object.fromEntries(Object.entries(ALIASES).map(([old, current]) => [current, old]));

// A zone id this browser accepts: ours, or the older spelling it knows.
function usable(tz) {
  if (isValidTimeZone(tz)) return tz;
  const old = OLD_NAMES[tz];
  return old && isValidTimeZone(old) ? old : null;
}

export const COUNTRIES = COUNTRY_ROWS.map(([code, name, region, aliases, zones]) => ({
  code, name: getLanguage() === 'zh' && /^[A-Z]{2}$/.test(code) ? new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(code) : name, region, aliases: `${aliases} ${name}`,
  zones: zones.map(([tz, city, area, zoneAliases]) => ({ tz: usable(tz), id: tz, city: tr(city), area: tr(area), aliases: `${zoneAliases} ${city}` }))
    .filter(z => z.tz),
})).filter(c => c.zones.length);

const ZONE_INDEX = new Map();
for (const country of COUNTRIES) {
  for (const zone of country.zones) {
    ZONE_INDEX.set(zone.tz, { country, zone });
    ZONE_INDEX.set(zone.id, { country, zone });
  }
}

function lookup(tz) {
  return ZONE_INDEX.get(tz) || ZONE_INDEX.get(ALIASES[tz]) || null;
}

/** "Vancouver", or the last part of an unknown id ("Buenos Aires"). */
export function cityName(tz) {
  const hit = lookup(tz);
  return hit ? hit.zone.city : tz.split('/').pop().replace(/_/g, ' ');
}

/** "Canada" for America/Vancouver; '' when unknown. */
export function countryOf(tz) {
  const hit = lookup(tz);
  return hit && hit.country.region !== 'other' ? hit.country.name : '';
}

export function allTimeZones() {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* older browser: our list only */ }
  return zones;
}

const normalize = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_/'.,·-]+/g, ' ');

/**
 * Countries (with the zones that match) for a query and region, plus any other
 * IANA zone whose id matches. With no query, every country with all its zones.
 */
export function searchPlaces(query, region = 'all') {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const results = [];
  for (const country of COUNTRIES) {
    if (region !== 'all' && country.region !== region) continue;
    if (!words.length) {
      results.push({ country, zones: country.zones });
      continue;
    }
    const countryText = normalize(`${country.code} ${country.name} ${country.aliases}`);
    const zones = country.zones.filter(zone => {
      const text = `${countryText} ${normalize(`${zone.city} ${zone.area} ${zone.aliases} ${zone.id}`)}`;
      return words.every(w => text.includes(w));
    });
    if (zones.length) results.push({ country, zones });
  }
  let others = [];
  if (words.length && region === 'all') {
    others = allTimeZones()
      .filter(tz => !lookup(tz) && words.every(w => normalize(tz).includes(w)))
      .slice(0, 40);
  }
  return { results, others };
}
