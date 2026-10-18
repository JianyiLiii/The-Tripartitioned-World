import { tr } from './locale.js';
import { h, icon } from './dom.js';
import { weekRange } from './i18n.js';
import { addDays, sameDate } from './tz.js';

export function parseCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000 || year > 9998) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month && check.getUTCDate() === day
    ? { year, month, day } : null;
}

export function mondayForDate(date) {
  const weekday = (new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

export function weekPicker({ monday, today, onChange, onToday, onPrevious, onNext }) {
  const end = addDays(monday, 6);
  const value = `${monday.year}-${String(monday.month).padStart(2, '0')}-${String(monday.day).padStart(2, '0')}`;
  const label = `${weekRange(monday, end)}${monday.year === end.year ? `, ${monday.year}` : ` (${monday.year}–${end.year})`}`;
  let trigger;
  const close = () => { popover.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
  const input = h('input', {
    type: 'date', class: 'input week-picker-input', value, min: '1000-01-01', max: '9998-12-31',
    'aria-label': tr('Choose a date to view its week'),
    onchange: event => {
      const date = parseCalendarDate(event.target.value);
      if (date) { close(); onChange(date); }
    },
    onblur: event => { if (!parseCalendarDate(event.target.value)) event.target.value = value; },
  });
  const popover = h('div', { class: 'week-picker-popover', hidden: true, role: 'group', 'aria-label': tr('Choose week by date') },
    h('label', {}, h('span', {}, tr('Choose a date')), input),
    h('small', {}, tr('Jump to the week containing this date.')));
  trigger = h('button', { class: 'week-picker-value', type: 'button', 'aria-label': tr("Choose week: {v0}", {v0: label}), 'aria-expanded': 'false',
    onclick: () => {
      popover.hidden = !popover.hidden;
      trigger.setAttribute('aria-expanded', String(!popover.hidden));
      if (!popover.hidden) input.focus();
    },
  }, icon('calendar', 15), label, icon('chevronDown', 13));
  const control = h('div', { class: 'week-picker-control',
    onkeydown: event => { if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); } },
    onfocusout: event => { if (event.relatedTarget && !control.contains(event.relatedTarget)) close(); },
  }, trigger, popover);
  return h('div', { class: 'week-picker', role: 'group', 'aria-label': tr('View week') },
    onPrevious ? h('button', { class: 'btn-icon', type: 'button', 'aria-label': tr('Previous week'), onclick: onPrevious }, icon('chevronLeft', 15)) : null,
    control,
    onNext ? h('button', { class: 'btn-icon', type: 'button', 'aria-label': tr('Next week'), onclick: onNext }, icon('chevronRight', 15)) : null,
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', disabled: sameDate(monday, mondayForDate(today)), onclick: onToday }, tr('This week')));
}
