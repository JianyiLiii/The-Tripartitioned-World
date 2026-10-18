import { tr, dateLocale } from '../locale.js';
import { h, fill, icon } from '../dom.js';
import { createDemoData } from '../demo-data.js';
import { WeekGrid } from '../grid.js';
import { meetingStarts } from '../overlap-model.js';
import { weekPicker, mondayForDate } from '../week-picker.js';
import { popcount, rampStep, SLOT } from '../schedule.js';
import { now as serverNow, today, subscribeClock, clockReady } from '../time.js';
import { addDays, sameDate, cityName, zonedParts, zonedToEpoch } from '../tz.js';
import { weekday } from '../i18n.js';
import { avatar, localRange, memberClass } from '../ui.js';

export function DemoView({standalone=false}={}) {
  let tz = 'Asia/Shanghai', scenario = 'balanced', duration = 60;
  let weekStart = standalone ? addDays(mondayForDate(today(tz)), 7) : null, selectedIndex = null, data, starts = new Map(), destroyed = false;
  const picker = h('div');
  const selection = h('div', { class: 'weekly-preview-selection', 'aria-live': 'polite' });
  const names = h('div', { class: 'weekly-preview-people' });
  const future = h('div', { class: 'weekly-preview-future-list' });
  const note = h('p', { class: 'preview-note' }, tr('Sample data only. Changes here do not affect your projects.'));
  const grid = new WeekGrid({ onSelect: index => { selectedIndex = index; update(); } });
  const sampleMonday = addDays(mondayForDate(today(tz)), 7);
  const samples = [
    { title: tr('Project review'), date: sampleMonday, minute: 18 * 60, people: [0, 1, 2, 3, 4] },
    { title: tr('Planning session'), date: addDays(sampleMonday, 3), minute: 19 * 60, people: [0, 3, 4] },
  ];
  function jump(date) { weekStart = mondayForDate(date); selectedIndex = null; update(); }
  function update() {
    if (destroyed) return;
    const monday = weekStart || mondayForDate(today(tz));
    data = createDemoData(tz, scenario, duration, { startDate: monday, days: 7, now: serverNow(), timeReady: clockReady() });
    starts = new Map(Array.from({ length: 7 }, (_, day) => meetingStarts(data.masks, day, duration, data.instants,
      { tz, startDate: monday, notBefore: serverNow() })).flat().filter(slot => slot.valid && slot.count > 0).map(slot => [slot.start, slot]));
    if (!starts.has(selectedIndex)) selectedIndex = null;
    fill(picker, weekPicker({ monday, today: today(tz), onChange: jump,
      onToday: () => { weekStart = null; selectedIndex = null; update(); },
      onPrevious: () => jump(addDays(monday, -7)), onNext: () => jump(addDays(monday, 7)) }));
    grid.update({ mode: 'overlap', label: tr('Weekly availability for five sample participants'),
      days: Array.from({ length: 7 }, (_, day) => { const date = addDays(monday, day); return { label: weekday(day), date: String(date.day), isToday: sameDate(date, today(tz)) }; }),
      masks: data.masks, people: data.people, total: data.total, count: popcount, rampStep: mask => rampStep(popcount(mask), data.total),
      isAll: mask => popcount(mask) === data.total, canSelect: index => clockReady() && starts.has(index), selectedIndex,
      durationSlots: Math.ceil(duration / SLOT),
    });
    fill(names, data.people.map(person => h('span', { class: memberClass(person.member.index) },
      avatar(person.member, { size: 'sm' }), h('span', {}, person.member.name, h('small', {}, cityName(person.tz))))),
      h('span', { class: 'weekly-everyone-key' }, h('i', { class: 'sw sw-everyone' }), tr('Everyone available')));
    const slot = starts.get(selectedIndex);
    if (!slot) fill(selection, h('strong', {}, tr('Select a time in the week')), h('span', {}, tr('Counts show available participants. A selection checks the full meeting duration.')));
    else {
      const start = data.instants[selectedIndex], end = start + duration * 60000;
      fill(selection, h('div', { class: 'weekly-preview-selection-head' },
        h('strong', {}, tr("{v0}/{v1} available · {v2}", {v0: slot.count, v1: data.total, v2: localRange(start, end, tz)})),
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => { note.textContent = tr('Preview only. In your meeting, this opens the time confirmation dialog.'); } }, tr('Set meeting time'))),
      h('div', { class: 'weekly-preview-locals' }, data.people.map(person => h('span', {},
        h('b', {}, person.member.name), localRange(start, end, person.tz),
        h('small', {}, !person.responded ? tr('No response') : slot.group & person.bit ? tr('Available') : tr('Unavailable'))))));
    }
    fill(future, samples.map(sample => {
      const instant = zonedToEpoch(sample.date, sample.minute, 'Asia/Shanghai');
      return h('article', { class: 'weekly-preview-future-row' },
        h('span', { class: 'weekly-preview-date' }, new Intl.DateTimeFormat(dateLocale(), { month: 'short', day: 'numeric', timeZone: tz }).format(instant)),
        h('div', {}, h('strong', {}, sample.title), h('p', {}, `${localRange(instant, instant + 3600000, tz)} · ${cityName(tz)}`),
          h('small', {}, sample.people.map(index => data.people[index].member.name).join(', '))),
        h('span', { class: 'weekly-preview-confirmed' }, tr('Confirmed')));
    }));
  }
  function selectControl(label, value, choices, onChange) {
    const select = h('select', { class: 'input', 'aria-label': label, onchange: event => { onChange(event.target.value); selectedIndex = null; update(); } },
      choices.map(([key, text]) => h('option', { value: key, selected: String(key) === String(value) }, text)));
    return h('label', { class: 'preview-control' }, h('span', {}, label), select);
  }
  const controls = h('div', { class: 'preview-controls' },
    selectControl(tr('Scenario'), scenario, [['balanced', tr('Shared availability')], ['partial', tr('Limited shared time')], ['pending', tr('One response pending')]], value => { scenario = value; }),
    selectControl(tr('Display time zone'), tz, [['Asia/Shanghai', tr('Beijing / Shanghai')], ['Asia/Singapore', tr('Singapore')], ['Asia/Tokyo', tr('Tokyo')], ['Europe/London', tr('London')], ['America/Los_Angeles', tr('Los Angeles')], ['UTC', 'UTC']], value => { tz = value; }),
    selectControl(tr('Meeting duration'), duration, [[30, tr('30 minutes')], [60, tr('60 minutes')], [90, tr('90 minutes')]], value => { duration = Number(value); }));
  const el = h('div', { class: 'workspace-page availability-preview weekly-preview' },
    h('header', { class: 'preview-heading' },
      h('a', { class: 'back-link', href: '#/' }, icon('arrowLeft', 15), tr('Back to overview')),
      h('div', { class: 'preview-title-row' }, h('h1', {}, tr('Weekly availability')), h('span', { class: 'preview-badge' }, tr('Sample data · 5 people'))),
      h('p', {}, tr('Choose a week, select a shared time, then confirm your meeting.'))),
    controls, h('section', { class: 'panel weekly-preview-chart' },
      h('div', { class: 'weekly-preview-toolbar' }, h('strong', {}, tr('Everyone’s availability')), picker), names, grid.el, selection),
    h('section', { class: 'weekly-preview-future' }, h('h2', {}, tr('Future meetings')), h('p', {}, tr('Sample confirmed meetings for these participants.')), future), note);
  update();
  const unsubscribeClock = subscribeClock(() => { if (!picker.contains(document.activeElement)) update(); });
  return { el, destroy: () => { destroyed = true; unsubscribeClock(); grid.destroy(); } };
}
