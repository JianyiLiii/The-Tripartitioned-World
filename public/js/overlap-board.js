import { tr, dateLocale } from './locale.js';
import { h, fill, icon } from './dom.js';
import { PER_DAY, SLOT } from './schedule.js';
import { meetingStarts, displayBounds } from './overlap-model.js';
import { addDays, cityName, hm, sameDate, weekdayOf, zonedParts } from './tz.js';
import { duration as durationLabel, weekday, monthDay, monthLong } from './i18n.js';

const COLORS = ['#5065d9', '#17867f', '#af6b26', '#9160ba', '#ce6577'];

const dateValue = date => `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
const dateNumber = date => Date.UTC(date.year, date.month - 1, date.day);

export function OverlapBoard({ onSelect, onRangeChange } = {}) {
  const el = h('section', { class: 'overlap-board', 'aria-label': tr('Compare availability') });
  let data, day = null, selected = null, receivedAt = 0, summaries = [], dayCount = 30;
  const startDate = () => data.startDate || data.monday;
  const currentNow = () => Number.isFinite(data.now) ? data.now + performance.now() - receivedAt : Date.now();
  const today = () => { const { year, month, day } = zonedParts(currentNow(), data.tz); return { year, month, day }; };
  const localFormat = (instant, tz) => new Intl.DateTimeFormat(dateLocale(), {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant);

  function update(next) {
    const previousInstant = data && day != null && selected != null ? data.instants[day * PER_DAY + selected] : null;
    const previousDate = data && day != null ? addDays(startDate(), day) : null;
    const changedRange = data && (data.tz !== next.tz || !sameDate(startDate(), next.startDate || next.monday));
    if (data !== next) receivedAt = performance.now();
    data = next;
    dayCount = Math.min(data.days || Math.floor(data.masks.length / PER_DAY), Math.floor(data.masks.length / PER_DAY));
    const now = currentNow();
    summaries = Array.from({ length: dayCount }, (_, d) => meetingStarts(data.masks, d, data.duration, data.instants,
      { tz: data.tz, startDate: startDate(), monday: startDate(), notBefore: now })
      .filter(row => row.valid !== false && data.instants[row.start] >= now));
    if (previousInstant != null) {
      const index = data.instants.indexOf(previousInstant);
      if (index >= 0 && index < dayCount * PER_DAY && summaries[Math.floor(index / PER_DAY)].some(row => row.slot === index % PER_DAY)) {
        day = Math.floor(index / PER_DAY); selected = index % PER_DAY;
      } else if (changedRange) { day = null; selected = null; }
    } else if (changedRange && previousDate) {
      const index = Math.round((dateNumber(previousDate) - dateNumber(startDate())) / 86400000);
      day = index >= 0 && index < dayCount ? index : null;
    }
    if (day == null || day >= dayCount || !summaries[day]?.length) {
      const todayIndex = Math.round((dateNumber(today()) - dateNumber(startDate())) / 86400000);
      day = todayIndex >= 0 && todayIndex < dayCount && summaries[todayIndex].length ? todayIndex : summaries.findIndex(rows => rows.length);
      if (day < 0) day = 0;
      selected = null;
    }
    const starts = summaries[day] || [];
    if (!starts.some(row => row.slot === selected)) {
      const best = [...starts].sort((a, b) => b.count - a.count || a.slot - b.slot)[0];
      selected = best?.slot ?? null;
    }
    render();
  }

  function choose(d, slot) {
    const active = document.activeElement?.dataset?.overlapFocus;
    day = d; selected = slot;
    update(data);
    if (active) el.querySelector(`[data-overlap-focus="${active}"]`)?.focus({ preventScroll: true });
  }

  function bounds() {
    let [from, to] = displayBounds(data.masks, day);
    if (selected != null) {
      from = Math.min(from, Math.floor(selected / 2) * 2);
      to = Math.max(to, Math.min(PER_DAY, Math.ceil((selected + data.duration / SLOT) / 2) * 2));
    }
    return [from, to];
  }

  function changeRange(date, days = data.days || dayCount) {
    if (!onRangeChange) return;
    const minimum = today();
    onRangeChange({ startDate: dateNumber(date) < dateNumber(minimum) ? minimum : date, days });
  }

  function rangeToolbar() {
    const first = startDate(), minimum = today(), last = addDays(first, dayCount - 1);
    const days = data.days || dayCount;
    const dateInput = h('input', {
      class: 'input overlap-date-input', type: 'date', value: dateValue(first), min: dateValue(minimum),
      'aria-label': tr('Start date'), disabled: !onRangeChange,
      onchange: event => {
        const value = event.currentTarget.value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!value) { event.currentTarget.value = dateValue(first); return; }
        const date = { year: +value[1], month: +value[2], day: +value[3] };
        if (dateNumber(date) < dateNumber(minimum)) event.currentTarget.value = dateValue(minimum);
        changeRange(date);
      },
    });
    const options = [30, 60, 90];
    if (!options.includes(days)) options.unshift(days);
    return h('div', { class: 'overlap-range-toolbar' },
      h('div', { class: 'overlap-range-title' }, h('strong', {}, `${monthDay(first.month, first.day)}, ${first.year} – ${monthDay(last.month, last.day)}, ${last.year}`),
        h('small', {}, tr("{v0} days · {v1}", {v0: dayCount, v1: cityName(data.tz)}))),
      h('div', { class: 'overlap-range-controls' },
        h('button', { class: 'btn overlap-today-button', type: 'button', disabled: !onRangeChange, onclick: () => {
          day = null; selected = null; changeRange(today());
        } }, tr('Today')),
        h('div', { class: 'overlap-range-arrows' },
          h('button', { class: 'btn-icon', type: 'button', 'aria-label': tr("Previous {v0} days", {v0: days}), title: tr("Previous {v0} days", {v0: days}),
            disabled: !onRangeChange || dateNumber(first) <= dateNumber(minimum), onclick: () => changeRange(addDays(first, -days)) }, icon('chevronLeft', 17)),
          h('button', { class: 'btn-icon', type: 'button', 'aria-label': tr("Next {v0} days", {v0: days}), title: tr("Next {v0} days", {v0: days}), disabled: !onRangeChange,
            onclick: () => changeRange(addDays(first, days)) }, icon('chevronRight', 17))),
        h('label', { class: 'overlap-range-field' }, h('span', {}, tr('From')), dateInput),
        h('label', { class: 'overlap-range-field' }, h('span', {}, tr('Show')), h('select', { class: 'input overlap-range-select', 'aria-label': tr('Number of days'), disabled: !onRangeChange,
          onchange: event => changeRange(first, Number(event.currentTarget.value)) }, options.map(value => h('option', { value: String(value), selected: value === days }, tr("{v0} days", {v0: value})))))));
  }

  function calendar(total) {
    const months = [], minimum = today();
    summaries.forEach((starts, index) => {
      const date = addDays(startDate(), index);
      let month = months.at(-1);
      if (!month || month.year !== date.year || month.month !== date.month) {
        month = { year: date.year, month: date.month, dates: new Map() }; months.push(month);
      }
      month.dates.set(date.day, { index, starts });
    });
    return h('div', { class: 'overlap-calendar' },
      h('div', { class: 'overlap-calendar-caption' }, h('p', {}, tr('Choose a date')),
        h('span', {}, tr("Daily best: people available for the full {v0}. Numbers show available / invited.", {v0: durationLabel(data.duration)}))),
      h('div', { class: 'overlap-months' }, months.map(month => {
        const first = { year: month.year, month: month.month, day: 1 };
        const daysInMonth = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
        const cells = Array.from({ length: weekdayOf(first) }, () => h('span', { class: 'overlap-calendar-spacer', 'aria-hidden': 'true' }));
        for (let number = 1; number <= daysInMonth; number++) {
          const date = { ...first, day: number }, item = month.dates.get(number);
          if (!item) { cells.push(h('span', { class: 'overlap-calendar-outside', 'aria-hidden': 'true' }, String(number))); continue; }
          const best = Math.max(0, ...item.starts.map(row => row.count));
          const current = sameDate(date, minimum), disabled = !item.starts.length;
          cells.push(h('button', {
            class: `overlap-calendar-day${item.index === day ? ' selected' : ''}${current ? ' today' : ''}${best === total && best ? ' full' : best ? ' some' : ' none'}`,
            type: 'button', disabled, 'aria-pressed': String(item.index === day), 'aria-current': current ? 'date' : null,
            'data-overlap-focus': `day-${item.index}`,
            'aria-label': `${weekday(weekdayOf(date))}, ${monthDay(date.month, date.day)}, ${date.year}${current ? ', today' : ''}. ${disabled ? tr('No future start times') : tr("Best {v0} of {v1} available for {v2}", {v0: best, v1: total, v2: durationLabel(data.duration)})}`,
            onclick: () => choose(item.index, null),
          }, h('span', { class: 'overlap-calendar-date' }, String(number), current ? h('i', { 'aria-hidden': 'true' }) : null),
          h('small', {}, disabled ? '—' : `${best}/${total}`)));
        }
        return h('section', { class: 'overlap-month', 'aria-label': `${monthLong(month.month)} ${month.year}` },
          h('h3', {}, monthLong(month.month), h('span', {}, String(month.year))),
          h('div', { class: 'overlap-weekdays', 'aria-hidden': 'true' }, Array.from({ length: 7 }, (_, index) => h('span', {}, weekday(index)))),
          h('div', { class: 'overlap-calendar-grid' }, cells));
      })));
  }

  function render() {
    const total = data.total || data.people.length;
    const responded = data.people.filter(p => p.responded !== false).length;
    const date = addDays(startDate(), day);
    const rows = summaries[day] || [];
    const choice = rows.find(row => row.slot === selected);
    const [from, to] = bounds();
    const count = to - from;
    const ticks = [];
    for (let slot = from; slot <= to; slot += count > 32 ? 4 : 2) ticks.push(h('span', { style: { left: `${(slot - from) / count * 100}%` } }, hm(slot * SLOT)));
    const timeline = h('div', { class: 'overlap-timeline', style: { '--slot-count': String(count) } },
      h('div', { class: 'overlap-axis' }, h('span', {}, cityName(data.tz)), h('div', { class: 'overlap-ticks' }, ticks)),
      data.people.map((person, index) => personRow(person, index, from, to)),
      h('div', { class: 'overlap-total-row' },
        h('div', { class: 'overlap-row-label' }, h('strong', {}, tr('Meeting starts')), h('small', {}, tr("Free for {v0}", {v0: durationLabel(data.duration)}))),
        h('div', { class: 'overlap-starts' }, Array.from({ length: count }, (_, offset) => {
          const slot = from + offset;
          const row = rows.find(r => r.slot === slot);
          const available = row?.count || 0;
          return h('button', {
            type: 'button', class: `overlap-start level-${available === total && available ? 'all' : available >= 2 ? 'some' : 'low'}${slot === selected ? ' selected' : ''}`,
            disabled: !row || data.timeReady === false, 'aria-pressed': String(slot === selected), 'data-overlap-focus': `slot-${slot}`,
            'aria-label': tr("{v0}, {v1} of {v2} available for {v3}", {v0: hm(slot * SLOT), v1: available, v2: total, v3: durationLabel(data.duration)}),
            title: tr("{v0} · {v1}/{v2} available", {v0: hm(slot * SLOT), v1: available, v2: total}), onclick: () => choose(day, slot),
          }, available ? String(available) : '–');
        }))),
      choice ? h('div', { class: 'overlap-selection-band', 'aria-hidden': 'true', style: {
        '--selection-left': `${Math.max(0, selected - from) / count * 100}%`,
        '--selection-width': `${Math.min(data.duration / SLOT, to - selected) / count * 100}%`,
      } }) : null);

    fill(el,
      h('div', { class: 'overlap-heading' },
        h('div', {}, h('h2', {}, tr('Compare availability')), h('p', {}, tr("{v0}/{v1} responses · {v2} meeting · {v3}", {v0: responded, v1: total, v2: durationLabel(data.duration), v3: cityName(data.tz)}))),
        h('div', { class: 'overlap-legend' }, h('span', {}, h('i', { class: 'legend-all' }), tr('Everyone')), h('span', {}, h('i', { class: 'legend-some' }), tr('Some available')))),
      data.timeReady === false ? h('p', { class: 'overlap-clock-warning', role: 'status' }, icon('clock', 15), tr('Current time needs to be synced. Reconnect to continue.')) : null,
      rangeToolbar(), calendar(total),
      h('div', { class: 'overlap-day-heading' }, h('h3', {}, `${weekday(weekdayOf(date))}, ${monthDay(date.month, date.day)}, ${date.year}`),
        h('span', {}, sameDate(date, today()) ? tr('Today · Future start times only') : tr("Times in {v0}", {v0: cityName(data.tz)}))),
      h('div', { class: 'overlap-content' },
        h('div', { class: 'overlap-chart-area' }, h('div', { class: 'overlap-chart-scroll', tabindex: '0', 'aria-label': tr('Participant timelines') }, timeline),
          h('p', { class: 'overlap-chart-hint' }, icon('info', 14), tr('Select a start time to check every participant. Colored bars show available time.'))),
        detail(choice, date, total)),
      responded < total ? h('p', { class: 'overlap-pending' }, icon('clock', 14), tr("{v0} participant{v1} not responded. Full availability requires all {v2}.", {v0: total - responded, v1: total - responded === 1 ? ' has' : 's have', v2: total})) : null);
  }

  function personRow(person, index, from, to) {
    const segments = [];
    for (let slot = from; slot < to;) {
      if (!(data.masks[day * PER_DAY + slot] & person.bit)) { slot++; continue; }
      let end = slot + 1;
      while (end < to && (data.masks[day * PER_DAY + end] & person.bit)) end++;
      segments.push(h('div', { class: 'overlap-person-band', title: `${person.member.name}: ${hm(slot * SLOT)}–${hm(end * SLOT)} (${cityName(data.tz)})`, style: {
        left: `${(slot - from) / (to - from) * 100}%`, width: `${(end - slot) / (to - from) * 100}%`,
      } }, end - slot >= 4 ? `${hm(slot * SLOT)}–${hm(end * SLOT)}` : ''));
      slot = end;
    }
    return h('div', { class: 'overlap-person-row', style: { '--person-color': COLORS[index % COLORS.length] } },
      h('div', { class: 'overlap-row-label' }, h('span', { class: 'overlap-avatar', 'aria-hidden': 'true' }, person.member.name.slice(0, 1).toUpperCase()),
        h('div', {}, h('strong', {}, person.member.name), h('small', {}, person.responded === false ? tr('Awaiting response') : cityName(person.tz)))),
      h('div', { class: 'overlap-person-track' }, segments));
  }

  function detail(choice, date, total) {
    const start = choice ? data.instants[choice.start] : null;
    const end = start == null ? null : start + data.duration * 60000;
    const endDate = end == null ? null : zonedParts(end, data.tz);
    const endDayOffset = endDate ? Math.round((dateNumber(endDate) - dateNumber(date)) / 86400000) : 0;
    const available = choice?.count || 0;
    return h('aside', { class: `overlap-detail${available === total && available ? ' full' : ''}`, 'aria-label': tr('Selected time details'), 'aria-live': 'polite' },
      h('span', { class: 'overlap-detail-label' }, 'SELECTED TIME'),
      h('h3', {}, choice ? `${hm(selected * SLOT)}–${hm(endDate.hour * 60 + endDate.minute)}` : tr('No time selected'),
        endDayOffset > 0 ? h('small', { class: 'overlap-next-day' }, tr("+{v0} day{v1}", {v0: endDayOffset, v1: endDayOffset === 1 ? '' : 's'})) : null),
      h('p', { class: 'overlap-detail-date' }, `${weekday(weekdayOf(date))}, ${monthDay(date.month, date.day)}, ${date.year} · ${cityName(data.tz)}`),
      h('div', { class: `overlap-verdict${available === total && available ? ' full' : ''}` }, icon(available === total && available ? 'check' : 'users', 17), tr("{v0}/{v1} available", {v0: available, v1: total}), h('small', {}, available === total && available ? tr('Everyone can attend') : tr("For the full {v0}", {v0: durationLabel(data.duration)}))),
      h('div', { class: 'overlap-person-statuses' }, data.people.map((person, index) => {
        const free = Boolean(choice && choice.group & person.bit);
        const localStart = start == null || !person.tz ? '' : localFormat(start, person.tz);
        const localEnd = end == null || !person.tz ? '' : localFormat(end, person.tz);
        const endLabel = localEnd.slice(0, 3) === localStart.slice(0, 3) ? localEnd.slice(-5) : localEnd;
        return h('div', { class: 'overlap-person-status' },
          h('span', { class: 'overlap-status-dot', style: { background: COLORS[index % COLORS.length] } }),
          h('div', {}, h('strong', {}, person.member.name), h('small', {}, !person.tz ? tr('Time zone not set') : start == null ? cityName(person.tz) : `${localStart}–${endLabel}`)),
          h('span', { class: `overlap-person-state ${free ? 'free' : ''}` }, person.responded === false ? tr('Pending') : free ? tr('Free') : tr('Unavailable')));
      })),
      onSelect ? h('button', { class: 'btn btn-primary overlap-confirm', type: 'button', disabled: !available || data.timeReady === false, onclick: () => {
        if (data.timeReady === false || start == null || start < currentNow()) { update(data); return; }
        onSelect(start);
      } }, tr('Use this time'), icon('arrowRight', 15)) : null);
  }
  return { el, update };
}
