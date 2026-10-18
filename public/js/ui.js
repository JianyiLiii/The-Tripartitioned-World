import { tr } from './locale.js';
// Shared UI: monograms, the day ribbon, modal, confirm, menu, toast, tooltip,
// tabs, the country time zone picker, and the meeting dialogs.

import { h, icon, svg } from './dom.js';
import { api, errorText } from './api.js';
import { duration, monthDay, t, weekday, weekdayLong } from './i18n.js';
import { isWebLink, isoDate, normalizeLink, parseDate } from './meeting.js';
import { clockReady, now as serverNow } from './time.js';
import { memberColor } from './member-colors.js';
import {
  REGIONS, addDays, cityName, clock, countryOf, detectTimeZone, formatOffset, hm,
  offsetMinutes, searchPlaces, weekdayOf, zonedParts, zonedToEpoch,
} from './tz.js';

// Members use a stable categorical color slot.
export function memberClass(index) {
  return index >= 0 && index < 8 ? `mc-${index}` : 'mc-x';
}

/** A monogram in a fine ring of the member's color; dashed until they respond. */
export function avatar(member, { size = 'md', hollow = false } = {}) {
  const initial = (Array.from(member.name.trim())[0] || '?').toUpperCase();
  return h('span', {
    class: `avatar avatar-${size} ${memberClass(member.index)}${hollow ? ' hollow' : ''}`,
    style: { '--mc': memberColor(member.index) },
    title: member.name, 'aria-hidden': 'true',
  }, initial);
}

/**
 * A person's day drawn as a scale from 00:00 to 24:00: hour ticks, night
 * shaded, a seal-red mark at the local time now, and the meeting bracketed.
 * `windows` are [start, end) local minutes.
 */
export function dayRibbon(tz, { now = serverNow(), windows = [], showNow = true } = {}) {
  const art = svg('svg', { viewBox: '0 0 1440 24', preserveAspectRatio: 'none', class: 'ribbon-art', 'aria-hidden': 'true' },
    svg('rect', { x: 0, y: 2, width: 330, height: 15.5, class: 'night' }),
    svg('rect', { x: 330, y: 2, width: 90, height: 15.5, class: 'twilight' }),
    svg('rect', { x: 1140, y: 2, width: 90, height: 15.5, class: 'twilight' }),
    svg('rect', { x: 1230, y: 2, width: 210, height: 15.5, class: 'night' }));
  for (let hour = 0; hour <= 24; hour++) {
    const x = Math.min(1439.5, Math.max(0.5, hour * 60));
    art.append(svg('line', { x1: x, x2: x, y1: hour % 6 ? 13 : 7, y2: 17.5, class: hour % 6 ? 'tick' : 'tick major' }));
  }
  art.append(svg('line', { x1: 0, x2: 1440, y1: 17.5, y2: 17.5, class: 'base' }));
  for (const [start, end] of windows) {
    art.append(svg('rect', { x: start, y: 3, width: Math.max(4, end - start), height: 17, class: 'window' }));
  }
  const el = h('div', { class: 'ribbon' }, art);
  if (showNow) {
    const p = zonedParts(now, tz);
    el.append(h('span', { class: 'ribbon-now', style: { '--at': `${((p.hour * 60 + p.minute) / 1440) * 100}%` } }));
  }
  return el;
}

/** Local [start, end) minutes of a meeting on someone's clock, split at midnight. */
export function localWindows(startMs, endMs, tz) {
  const a = zonedParts(startMs, tz);
  const from = a.hour * 60 + a.minute;
  const to = from + Math.round((endMs - startMs) / 60000);
  return to <= 1440 ? [[from, to]] : [[from, 1440], [0, Math.min(1440, to - 1440)]];
}

/** "Tue 22:00–23:00", or "Sun 23:00 – Mon 00:30" when it crosses midnight. */
export function localRange(startMs, endMs, tz) {
  const a = zonedParts(startMs, tz);
  const b = zonedParts(endMs - 60000, tz); // last minute inside, so 00:00 reads as 24:00
  const from = hm(a.hour * 60 + a.minute);
  const to = hm(b.hour * 60 + b.minute + 1);
  if (a.weekday === b.weekday && endMs - startMs < 86400000) return `${weekday(a.weekday)} ${from}–${to}`;
  return `${weekday(a.weekday)} ${from} – ${weekday(b.weekday)} ${to}`;
}

// ------------------------------------------------------------------ modal --

const modalStack = [];

export function openModal({ title, body, footer, onClose, className = '', eyebrow = null }) {
  const previous = document.activeElement;
  const record = {};
  const close = () => {
    const index = modalStack.indexOf(record);
    if (index < 0) return;
    const wasTop = index === modalStack.length - 1;
    modalStack.splice(index, 1);
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 140);
    document.removeEventListener('keydown', onKey, true);
    if (wasTop && previous && previous.isConnected) previous.focus();
    if (onClose) onClose();
  };
  const closeButton = h('button', { class: 'btn-icon', type: 'button', 'aria-label': t('common.close'), onclick: close }, icon('x'));
  const dialog = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' },
      h('div', {}, eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null, h('h2', { class: 'modal-title' }, title)),
      closeButton),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, footer) : null);
  const overlay = h('div', { class: 'overlay', onmousedown: e => { if (e.target === overlay) close(); } }, dialog);

  function onKey(e) {
    if (modalStack[modalStack.length - 1] !== record) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  Object.assign(record, { close, dialog });
  modalStack.push(record);
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  const initial = dialog.querySelector('.modal-body input:not([type=checkbox]), .modal-body textarea, .modal-foot .btn-primary, .modal-foot button');
  (initial || closeButton).focus({ preventScroll: true });
  return record;
}

export function confirmDialog({ title, message, confirmText = t('common.ok'), danger = false }) {
  return new Promise(resolve => {
    let confirmed = false;
    const cancel = h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, t('common.cancel'));
    const ok = h('button', {
      class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button',
      onclick: () => { confirmed = true; modal.close(); },
    }, confirmText);
    const modal = openModal({
      title, body: h('p', { class: 'confirm-text' }, message), footer: [cancel, ok], className: 'modal-sm',
      onClose: () => resolve(confirmed),
    });
    cancel.focus();
  });
}

// ------------------------------------------------------------------- menu --

let openMenuEl = null;

export function closeMenu() {
  if (!openMenuEl) return;
  openMenuEl.cleanup();
  openMenuEl.remove();
  openMenuEl = null;
}

export function openMenu(anchor, items) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map(item =>
    h('button', {
      class: `menu-item${item.danger ? ' danger' : ''}`, type: 'button', role: 'menuitem',
      onclick: () => { closeMenu(); item.onClick(); },
    }, item.icon ? icon(item.icon) : null, h('span', {}, item.label))));
  document.body.append(menu);

  const r = anchor.getBoundingClientRect();
  const width = menu.offsetWidth, height = menu.offsetHeight;
  let left = r.right - width;
  if (left < 8) left = Math.min(r.left, window.innerWidth - width - 8);
  let top = r.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6);
  menu.style.setProperty('left', `${left}px`);
  menu.style.setProperty('top', `${top}px`);

  const onPointer = e => { if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onKey = e => {
    if (e.key === 'Escape') { closeMenu(); anchor.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = [...menu.querySelectorAll('.menu-item')];
      const i = buttons.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
      buttons[next].focus();
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', onPointer, true));
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', closeMenu, { once: true, capture: true });
  window.addEventListener('resize', closeMenu, { once: true });
  menu.cleanup = () => {
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', closeMenu, true);
    window.removeEventListener('resize', closeMenu);
  };
  openMenuEl = menu;
  const first = menu.querySelector('.menu-item');
  if (first) first.focus();
}

// ------------------------------------------------------------------ toast --

let toastBox = null;

export function toast(message, kind = 'info') {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const el = h('div', { class: `toast toast-${kind}` }, h('i', { class: 'toast-dot' }), h('span', {}, message));
  toastBox.append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, kind === 'error' ? 5000 : 2400);
}

// ---------------------------------------------------------------- tooltip --

let tipEl = null;

export function showTooltip(content, x, y) {
  if (!tipEl || !tipEl.isConnected) {
    tipEl = h('div', { class: 'tooltip', role: 'tooltip' });
    document.body.append(tipEl);
  }
  tipEl.replaceChildren(content);
  tipEl.classList.add('visible');
  const gap = 16;
  const width = tipEl.offsetWidth, height = tipEl.offsetHeight;
  let left = x + gap;
  if (left + width > window.innerWidth - 8) left = x - width - gap;
  let top = y + gap;
  if (top + height > window.innerHeight - 8) top = y - height - gap;
  tipEl.style.setProperty('transform', `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`);
}

export function hideTooltip() {
  if (tipEl) tipEl.classList.remove('visible');
}

// ------------------------------------------------------------------- tabs --

export function segmented(options, value, onChange, label, className = '') {
  return h('div', { class: `seg ${className}`, role: 'tablist', 'aria-label': label }, options.map(opt =>
    h('button', {
      class: `seg-btn${opt.id === value ? ' active' : ''}`, type: 'button', role: 'tab',
      'aria-selected': String(opt.id === value), onclick: () => { if (opt.id !== value) onChange(opt.id); },
    }, opt.label, opt.badge ? h('span', { class: 'seg-badge' }, opt.badge) : null)));
}

// ------------------------------------------------------- time zone picker --

/** Pick a zone by country (and city, for countries with several). */
export function pickTimeZone({ current = null, title = t('tz.title') } = {}) {
  return new Promise(resolve => {
    let picked = null;
    let region = 'all';
    const opened = new Set();
    const detected = detectTimeZone();
    const input = h('input', {
      class: 'input input-search', type: 'search', placeholder: t('tz.search'), 'aria-label': t('tz.search'),
      autocomplete: 'off', spellcheck: 'false',
    });
    const regionBar = h('div', { class: 'seg seg-scroll', role: 'tablist' });
    const list = h('div', { class: 'tz-list', role: 'listbox', 'aria-label': title });
    const choose = tz => { picked = tz; modal.close(); };

    const meta = (tz, now) => h('span', { class: 'tz-meta' },
      h('b', {}, clock(tz, now)), h('span', {}, formatOffset(offsetMinutes(tz, now))));

    const countryBlock = (country, zones, open, now) => {
      const single = country.zones.length === 1;
      const isCurrent = single && zones[0].tz === current;
      const head = h('button', {
        class: `tz-country${isCurrent ? ' current' : ''}${open ? ' open' : ''}`,
        type: 'button', role: single ? 'option' : null, 'aria-expanded': single ? null : String(open),
        onclick: () => {
          if (single) return choose(zones[0].tz);
          if (opened.has(country.code)) opened.delete(country.code); else opened.add(country.code);
          render();
        },
      },
      h('span', { class: 'cc' }, country.code),
      h('span', { class: 'tz-names' },
        h('span', { class: 'tz-name' }, country.name),
        h('span', { class: 'tz-sub' }, single ? zones[0].city : t('tz.zones', { n: country.zones.length }))),
      single ? meta(zones[0].tz, now) : icon(open ? 'chevronDown' : 'chevronRight'),
      isCurrent ? icon('check') : null);
      if (single || !open) return head;
      return h('div', { class: 'tz-block' }, head, zones.map(zone => h('button', {
        class: `tz-zone${zone.tz === current ? ' current' : ''}`, type: 'button', role: 'option',
        onclick: () => choose(zone.tz),
      },
      h('span', { class: 'tz-names' },
        h('span', { class: 'tz-name' }, zone.city),
        zone.area ? h('span', { class: 'tz-sub' }, zone.area) : null),
      meta(zone.tz, now),
      zone.tz === current ? icon('check') : null)));
    };

    function renderRegions() {
      regionBar.replaceChildren(...['all', ...REGIONS].map(id => h('button', {
        class: `seg-btn${id === region ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(id === region),
        onclick: () => { region = id; renderRegions(); render(); },
      }, id === 'all' ? t('tz.all') : t(`region.${id}`))));
    }

    function render() {
      const now = serverNow();
      const query = input.value.trim();
      const { results, others } = searchPlaces(query, region);
      const items = results.map(({ country, zones }) => countryBlock(country, zones,
        Boolean(query) || opened.has(country.code) || zones.some(z => z.tz === current), now));
      if (others.length) {
        items.push(h('div', { class: 'tz-heading' }, t('tz.others')));
        for (const tz of others) {
          items.push(h('button', { class: `tz-zone${tz === current ? ' current' : ''}`, type: 'button', role: 'option', onclick: () => choose(tz) },
            h('span', { class: 'tz-names' }, h('span', { class: 'tz-name' }, cityName(tz)), h('span', { class: 'tz-sub' }, tz)),
            meta(tz, now)));
        }
      }
      if (!items.length) items.push(h('div', { class: 'tz-empty' }, t('tz.empty')));
      list.replaceChildren(...items);
    }

    input.addEventListener('input', render);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = list.querySelector('.tz-zone, .tz-country');
        if (first) first.click();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const first = list.querySelector('button');
        if (first) first.focus();
      }
    });
    list.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const buttons = [...list.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement);
      const next = buttons[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) next.focus();
      else if (e.key === 'ArrowUp') input.focus();
    });

    const now = serverNow();
    const quick = h('div', { class: 'tz-quick' },
      current ? h('div', { class: 'tz-current' },
        icon('pin', 14),
        h('span', {}, `${cityName(current)}${countryOf(current) ? `, ${countryOf(current)}` : ''}`),
        h('b', {}, clock(current, now))) : null,
      detected !== current ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => choose(detected) },
        t('tz.detected', { city: cityName(detected) })) : null);

    const modal = openModal({
      title, body: [quick, h('div', { class: 'search-wrap' }, icon('search'), input), regionBar, list],
      className: 'modal-tz', onClose: () => resolve(picked),
    });
    renderRegions();
    render();
    input.focus();
  });
}

// ------------------------------------------------------- meeting dialogs --

const LENGTHS = [30, 45, 60, 90, 120, 180];

let fieldSeq = 0;

function field(label, control, hint = null) {
  const id = `field-${++fieldSeq}`;
  const input = control.matches('input, textarea, select') ? control : control.querySelector('input, textarea, select');
  const labelNode = input
    ? h('label', { class: 'field-label', for: input.id || (input.id = id) }, label)
    : h('span', { class: 'field-label', id }, label);
  if (!input) {
    control.setAttribute('role', 'group');
    control.setAttribute('aria-labelledby', id);
  }
  if (hint && input) input.setAttribute('aria-describedby', `${id}-hint`);
  return h('div', { class: 'field' }, labelNode, control,
    hint ? h('span', { class: 'field-hint', id: `${id}-hint` }, hint) : null);
}

/** Toggle chips for choosing invitees; the organizer is always in. */
function inviteePicker(members, selected, ownerKey) {
  const chosen = new Set(selected);
  chosen.add(ownerKey);
  const el = h('div', { class: 'invitee-picker' });
  const render = () => {
    el.replaceChildren(...members.map(m => {
      const locked = m.key === ownerKey;
      const on = chosen.has(m.key);
      return h('button', {
        class: `invitee-chip ${memberClass(m.index)}${on ? ' on' : ''}${locked ? ' locked' : ''}`,
        type: 'button', 'aria-pressed': String(on), disabled: locked,
        onclick: () => {
          if (on) chosen.delete(m.key); else chosen.add(m.key);
          render();
          el.querySelectorAll('button')[members.indexOf(m)]?.focus();
        },
      },
      avatar(m, { size: 'sm', hollow: !on }),
      h('span', {}, m.name),
      locked ? h('span', { class: 'chip-tag' }, t('meeting.organizer')) : on ? icon('check', 14) : icon('plus', 14));
    }));
  };
  render();
  return { el, value: () => members.filter(m => chosen.has(m.key)).map(m => m.key) };
}

let formSeq = 0;

/** Create in two short steps, or edit all existing meeting details together. */
export function meetingForm({ ctx, initial = {}, title, submitText, onSubmit }) {
  const id = `meeting-form-${++formSeq}`;
  const isNew = !initial.id;
  let step = 1;
  const ownerKey = initial.createdBy || ctx.me.key;
  const titleInput = h('input', {
    class: 'input input-lg', maxlength: '80', required: true,
    placeholder: t('meeting.titlePh'), value: initial.title || '', autocomplete: 'off',
  });
  const descInput = h('textarea', { class: 'input', maxlength: '500', rows: '2', placeholder: t('meeting.descPh') },
    initial.description || '');
  let length = initial.duration || 60;
  const lengths = LENGTHS.includes(length) ? LENGTHS : [...LENGTHS, length].sort((a, b) => a - b);
  const lengthBox = h('div', { class: 'chips' });
  const renderLengths = () => lengthBox.replaceChildren(...lengths.map(m => h('button', {
    class: `chip${m === length ? ' active' : ''}`, type: 'button', 'aria-pressed': String(m === length),
    onclick: () => { length = m; renderLengths(); lengthBox.querySelector('.active')?.focus(); },
  }, duration(m))));
  renderLengths();
  const invitees = inviteePicker(ctx.members, initial.invitees || ctx.members.map(m => m.key), ownerKey);
  const linkInput = h('input', {
    class: 'input', type: 'url', inputmode: 'url', maxlength: '500', placeholder: t('meeting.linkPh'),
    value: initial.link || '', autocomplete: 'off', spellcheck: 'false',
  });
  const error = h('p', { class: 'form-error', role: 'alert', id: `${id}-error` });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit', form: id });
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, t('common.cancel'));
  const back = h('button', { class: 'btn', type: 'button', onclick: () => { step = 1; renderStep(); titleInput.focus(); } }, t('common.back'));
  const steps = h('div', { class: 'wizard-steps', 'aria-label': tr('Meeting creation progress') });
  const summary = h('div', { class: 'meeting-summary' });
  const detailsPanel = h('div', { class: 'wizard-panel' },
    field(t('meeting.title'), titleInput),
    field(t('meeting.desc'), descInput),
    field(t('meeting.duration'), lengthBox),
    field(t('meeting.link'), h('div', { class: 'input-icon' }, icon('link'), linkInput)));
  const invitePanel = h('div', { class: 'wizard-panel' },
    isNew ? summary : null,
    field(t('meeting.invitees'), invitees.el, t('meeting.inviteesHint')),
    isNew && ctx.members.length < 2 ? h('p', { class: 'field-hint' }, tr('You are the only project member. Add members from the project after creating this meeting.')) : null,
    isNew ? h('p', { class: 'invite-note' }, tr('Participants can add availability after the meeting is created.')) : null);

  function renderStep() {
    detailsPanel.hidden = isNew && step === 2;
    invitePanel.hidden = isNew && step === 1;
    back.hidden = !isNew || step === 1;
    cancel.hidden = isNew && step === 2;
    submit.textContent = isNew && step === 1 ? tr('Next: invite members') : (submitText || t(isNew ? 'meeting.create' : 'meeting.save'));
    error.textContent = '';
    if (isNew) {
      steps.replaceChildren(...[tr('Meeting details'), tr('Invite members')].map((label, i) => h('div', {
        class: `wizard-step${step === i + 1 ? ' active' : ''}${step > i + 1 ? ' complete' : ''}`,
        'aria-current': step === i + 1 ? 'step' : null,
      }, h('span', { class: 'wizard-step-number' }, step > i + 1 ? icon('check', 12) : i + 1), h('span', {}, label))));
      summary.replaceChildren(h('strong', {}, titleInput.value.trim()), h('span', {}, tr("{v0} · Time not set", {v0: duration(length)})));
    }
  }

  const validate = () => {
    titleInput.removeAttribute('aria-invalid');
    linkInput.removeAttribute('aria-invalid');
    const link = normalizeLink(linkInput.value);
    if (!titleInput.value.trim()) {
      error.textContent = tr('Enter a meeting name.');
      titleInput.setAttribute('aria-invalid', 'true');
      titleInput.setAttribute('aria-describedby', `${id}-error`);
      titleInput.focus();
      return false;
    }
    if (link && !isWebLink(link)) {
      error.textContent = t('meeting.linkInvalid');
      linkInput.setAttribute('aria-invalid', 'true');
      linkInput.setAttribute('aria-describedby', `${id}-error`);
      linkInput.focus();
      return false;
    }
    return true;
  };

  const form = h('form', {
    class: 'form', id, novalidate: true, onsubmit: async e => {
      e.preventDefault();
      if (submit.disabled) return;
      if (!validate()) return;
      if (isNew && step === 1) {
        step = 2;
        renderStep();
        (invitePanel.querySelector('button:not([disabled])') || submit).focus();
        return;
      }
      const link = normalizeLink(linkInput.value);
      const values = {
        title: titleInput.value.trim(), description: descInput.value.trim(),
        duration: length, invitees: invitees.value(), link,
      };
      submit.disabled = true;
      back.disabled = true;
      submit.textContent = isNew ? tr('Creating…') : tr('Saving…');
      error.textContent = '';
      try {
        await onSubmit(values);
        modal.close();
      } catch (err) {
        error.textContent = t('common.error', { msg: errorText(err) });
        submit.disabled = false;
        back.disabled = false;
        submit.textContent = submitText || t(isNew ? 'meeting.create' : 'meeting.save');
      }
    },
  },
  isNew ? steps : null, detailsPanel, invitePanel, error);

  renderStep();
  const modal = openModal({ title: title || t(isNew ? 'meeting.new' : 'meeting.edit'), body: form, footer: [cancel, back, submit], className: 'modal-form' });
  titleInput.focus();
}

// ------------------------------------------------------- project dialogs --

const WORKSPACE_COLORS = [
  ['#5479e6', tr('Blue')], ['#8b6dd9', tr('Purple')], ['#4b9b80', tr('Green')],
  ['#d89a4e', tr('Orange')], ['#cb7c96', tr('Rose')], ['#4b9eaf', tr('Teal')],
];

/** A project holds its own members and meetings. */
export function workspaceForm({ initial = {}, onSubmit }) {
  const id = `workspace-form-${++formSeq}`;
  const editing = Boolean(initial.id);
  let color = initial.color || WORKSPACE_COLORS[0][0];
  const name = h('input', {
    class: 'input input-lg', required: true, maxlength: '80', autocomplete: 'off',
    placeholder: tr('e.g. Website redesign'), value: initial.title || '',
  });
  const description = h('textarea', {
    class: 'input', rows: '3', maxlength: '500', placeholder: tr('Project scope and goals'),
  }, initial.description || '');
  const colors = h('div', { class: 'workspace-colors' });
  const renderColors = () => colors.replaceChildren(...WORKSPACE_COLORS.map(([value, label]) => h('button', {
    type: 'button', class: `workspace-color${color === value ? ' active' : ''}`,
    style: { '--swatch': value }, title: label, 'aria-label': label, 'aria-pressed': String(color === value),
    onclick: () => { color = value; renderColors(); colors.querySelector('.active')?.focus(); },
  }, color === value ? icon('check', 16) : null)));
  renderColors();
  const error = h('p', { class: 'form-error', id: `${id}-error`, role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit', form: id }, editing ? tr('Save changes') : tr('Create project'));
  const form = h('form', {
    class: 'form', id, novalidate: true, onsubmit: async e => {
      e.preventDefault();
      if (submit.disabled) return;
      const title = name.value.trim();
      if (!title) {
        error.textContent = tr('Enter a project name.');
        name.setAttribute('aria-invalid', 'true');
        name.setAttribute('aria-describedby', `${id}-error`);
        name.focus();
        return;
      }
      name.removeAttribute('aria-invalid');
      error.textContent = '';
      submit.disabled = true;
      submit.textContent = editing ? tr('Saving…') : tr('Creating…');
      try {
        await onSubmit({ title, description: description.value.trim(), color });
        modal.close();
      } catch (err) {
        error.textContent = t('common.error', { msg: errorText(err) });
        submit.disabled = false;
        submit.textContent = editing ? tr('Save changes') : tr('Create project');
      }
    },
  }, field(tr('Project name'), name), field(tr('Description (optional)'), description), field(tr('Project color'), colors), error);
  const modal = openModal({
    title: editing ? tr('Edit project') : tr('Create project'),
    body: form,
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, t('common.cancel')), submit],
    className: 'modal-form',
  });
  name.focus();
  return modal;
}

/** Share an invitation or add names directly for this local personal project. */
export function workspaceInviteDialog({ workspace, onInvite, onClose }) {
  const id = `workspace-invite-${++formSeq}`;
  const link = `${location.origin}/#/invite/${encodeURIComponent(workspace.inviteCode)}`;
  const linkInput = h('input', { class: 'input', value: link, readonly: true, 'aria-label': tr('Project invitation link') });
  const copyStatus = h('p', { class: 'field-hint', role: 'status' });
  const copy = h('button', {
    class: 'btn', type: 'button', onclick: async () => {
      let copied = false;
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch {
        linkInput.focus();
        linkInput.select();
        try { copied = document.execCommand('copy'); } catch { /* leave the selected link ready for manual copy */ }
      }
      copyStatus.textContent = copied ? tr('Invitation link copied.') : tr('Link selected. Press Ctrl+C or ⌘C to copy.');
      if (copied) copy.replaceChildren(icon('check', 14), tr('Copied'));
    },
  }, icon('copy', 14), tr('Copy link'));
  const names = h('textarea', {
    class: 'input', rows: '3', maxlength: '2000', placeholder: tr('e.g. Alex, Sam, Jordan'),
  });
  const error = h('p', { class: 'form-error', role: 'alert', id: `${id}-error` });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit', form: id }, tr('Add members'));
  const form = h('form', {
    class: 'form', id, novalidate: true, onsubmit: async e => {
      e.preventDefault();
      if (submit.disabled) return;
      const seen = new Set();
      const list = names.value.split(/[,，\n\r]+/).map(name => name.trim()).filter(name => {
        const key = name.toLocaleLowerCase();
        if (!name || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const validation = !list.length ? tr('Enter at least one member name.')
        : list.length > 100 ? tr('Add up to 100 members at a time.')
        : list.some(name => Array.from(name).length > 80) ? tr('Names must be 80 characters or fewer.')
        : list.some(name => /[\u0000-\u001f\u007f]/.test(name)) ? tr('Names cannot contain tabs or other control characters.') : '';
      if (validation) {
        error.textContent = validation;
        names.setAttribute('aria-invalid', 'true');
        names.setAttribute('aria-describedby', `${id}-error`);
        names.focus();
        return;
      }
      names.removeAttribute('aria-invalid');
      submit.disabled = true;
      submit.textContent = tr('Adding…');
      error.textContent = '';
      try {
        await onInvite(list);
        toast(tr('Members added to project'), 'success');
        modal.close();
      } catch (err) {
        error.textContent = t('common.error', { msg: errorText(err) });
        submit.disabled = false;
        submit.textContent = tr('Add members');
      }
    },
  }, field(tr('Member login names'), names, tr('Separate login names with commas or line breaks.')),
  h('p', { class: 'invite-note' }, tr('Use each member’s current username.')), error);
  const modal = openModal({
    title: tr('Invite project members'), eyebrow: workspace.title,
    body: [
      h('section', { class: 'invite-section' },
        h('h3', {}, tr('Share invitation link')),
        h('p', { class: 'modal-lead' }, tr('Recipients open the link and enter a name to join.')),
        h('div', { class: 'invite-link-row' }, linkInput, copy), copyStatus,
        h('p', { class: 'field-hint' }, tr('Recipients must be able to reach this local server.'))),
      h('div', { class: 'invite-divider' }, tr('Or add members by name')), form,
    ],
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, tr('Done')), submit],
    className: 'modal-form', onClose,
  });
  names.focus();
  return modal;
}

/** Change who is invited to a meeting. */
export function inviteDialog({ ctx, project, onSave }) {
  let picker = inviteePicker(ctx.members, project.invitees, project.createdBy);
  let open = true;
  const pickerHost = h('div', {}, picker.el);
  const error = h('p', { class: 'form-error', role: 'alert' });
  const status = h('p', { class: 'field-hint', role: 'status' });
  const applyMembers = members => {
    // Keep unsaved choices; new project members must be selected explicitly.
    const selected = picker.value();
    ctx.members = members;
    picker = inviteePicker(members, selected, project.createdBy);
    pickerHost.replaceChildren(picker.el);
  };
  const refreshMembers = async () => {
    const data = await api.workspace(project.workspaceId);
    if (open) applyMembers(data.members);
    return data;
  };
  const add = project.workspaceId ? h('button', {
    class: 'btn btn-sm', type: 'button', onclick: async () => {
      add.disabled = true;
      error.textContent = '';
      try {
        const data = await refreshMembers();
        if (!open) return;
        let refreshedAfterInvite = false;
        workspaceInviteDialog({
          workspace: data.workspace,
          onInvite: async names => {
            await api.updateWorkspace(project.workspaceId, { inviteNames: names });
            await refreshMembers();
            refreshedAfterInvite = true;
            status.textContent = tr('Project members updated. Select participants and save changes.');
          },
          onClose: () => {
            // A person may have joined through the shared link while it was open.
            if (open && !refreshedAfterInvite) {
              refreshMembers().catch(err => { if (open) error.textContent = t('common.error', { msg: errorText(err) }); });
            }
          },
        });
      } catch (err) {
        if (open) error.textContent = t('common.error', { msg: errorText(err) });
      } finally {
        add.disabled = false;
      }
    },
  }, icon('plus', 14), tr('Add project members')) : null;
  const save = h('button', {
    class: 'btn btn-primary', type: 'button',
    onclick: async () => {
      save.disabled = true;
      error.textContent = '';
      try {
        await onSave(picker.value());
        modal.close();
      } catch (err) {
        error.textContent = t('common.error', { msg: errorText(err) });
        save.disabled = false;
      }
    },
  }, t('meeting.save'));
  const modal = openModal({
    title: t('d.inviteTitle'), body: [
      h('p', { class: 'modal-lead' }, t('d.inviteHint')), pickerHost,
      add ? h('div', { class: 'invite-section' },
        h('p', { class: 'field-hint' }, tr('Add people to the project before inviting them to this meeting.')), add) : null,
      status, error,
    ],
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, t('common.cancel')), save],
    className: 'modal-form', onClose: () => { open = false; },
  });
}

/** Add, change or remove the video-call link. */
export function linkDialog({ project, onSave }) {
  const input = h('input', {
    class: 'input', type: 'url', inputmode: 'url', maxlength: '500', placeholder: t('meeting.linkPh'),
    value: project.link || '', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('d.linkTitle'),
  });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submitLink = async link => {
    try {
      await onSave(link);
      modal.close();
    } catch (err) {
      error.textContent = t('common.error', { msg: errorText(err) });
    }
  };
  const save = h('button', {
    class: 'btn btn-primary', type: 'button',
    onclick: () => {
      const link = normalizeLink(input.value);
      if (link && !isWebLink(link)) { error.textContent = t('meeting.linkInvalid'); return; }
      submitLink(link);
    },
  }, t('meeting.save'));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save.click(); });
  const remove = project.link
    ? h('button', { class: 'btn btn-ghost danger-text', type: 'button', onclick: () => submitLink('') }, t('d.removeLink'))
    : null;
  const modal = openModal({
    title: t('d.linkTitle'),
    body: [h('div', { class: 'input-icon' }, icon('link'), input), error],
    footer: [remove, h('span', { class: 'spacer' }), h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, t('common.cancel')), save],
    className: 'modal-form',
  });
  input.focus();
}

/**
 * Set the meeting time. `start` (epoch ms) comes from a best-time window, or
 * is null to set it by hand. The time is kept on `tz` (the clock of whoever sets it).
 */
export function scheduleDialog({ project, invitees, tz, start = null, onSave }) {
  if (!clockReady()) { toast(tr('Current time needs to be synced. Reconnect to continue.'), 'error'); return; }
  const now = serverNow();
  const initial = zonedParts(start != null ? start : Math.ceil(now / 1800000) * 1800000, tz);
  let date = { year: initial.year, month: initial.month, day: initial.day };
  let minute = initial.hour * 60 + initial.minute;
  if (zonedToEpoch(date, minute, tz) < now) {
    const next = zonedParts(Math.ceil(now / 1800000) * 1800000, tz);
    date = { year: next.year, month: next.month, day: next.day };
    minute = next.hour * 60 + next.minute;
  }
  let repeat = project.schedule ? project.schedule.repeat : 'none';

  const dateInput = h('input', { class: 'input', type: 'date', value: isoDate(date), min: isoDate(zonedParts(now, tz)) });
  const timeSelect = h('select', { class: 'input' });
  for (let m = 0; m < 1440; m += 15) timeSelect.append(h('option', { value: String(m) }, hm(m)));
  timeSelect.value = String(minute - (minute % 15));
  minute = Number(timeSelect.value);
  const repeatBox = h('div');
  const preview = h('div', { class: 'sched-preview' });

  const render = () => {
    const startMs = zonedToEpoch(date, minute, tz);
    const endMs = startMs + project.duration * 60000;
    repeatBox.replaceChildren(segmented([
      { id: 'none', label: `${t('d.once')} · ${monthDay(date.month, date.day)}` },
      { id: 'weekly', label: `${t('d.weekly')} · ${t('d.weeklyOn', { weekday: weekdayLong(weekdayOf(date)) })}` },
    ], repeat, id => { repeat = id; render(); }, t('d.confirmTitle'), 'seg-wide'));
    preview.replaceChildren(...invitees.map(({ member, tz: personTz }) => h('div', { class: `sched-row ${memberClass(member.index)}` },
      avatar(member, { size: 'sm' }),
      h('span', { class: 'sched-name' }, member.name),
      personTz ? h('span', { class: 'sched-local' }, localRange(startMs, endMs, personTz)) : h('span', { class: 'muted' }, '—'),
      personTz ? dayRibbon(personTz, { windows: localWindows(startMs, endMs, personTz), showNow: false }) : h('span'))));
  };
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    date = parseDate(dateInput.value);
    render();
  });
  timeSelect.addEventListener('change', () => { minute = Number(timeSelect.value); render(); });
  render();

  const confirm = h('button', {
    class: 'btn btn-primary', type: 'button',
    onclick: async () => {
      if (!clockReady()) { toast(tr('Current time needs to be synced. Reconnect to continue.'), 'error'); return; }
      const selectedStart = zonedToEpoch(date, minute, tz);
      const actual = zonedParts(selectedStart, tz);
      if (!dateInput.value || selectedStart < serverNow()) {
        toast(tr('Choose a date and time in the future.'), 'error'); return;
      }
      if (isoDate(actual) !== isoDate(date) || actual.hour * 60 + actual.minute !== minute) {
        toast(tr('This local time does not exist because the clocks change. Choose another time.'), 'error'); return;
      }
      confirm.disabled = true;
      try {
        await onSave({ tz, date: isoDate(date), minute, repeat });
        modal.close();
      } catch (err) {
        toast(t('common.error', { msg: errorText(err) }), 'error');
        confirm.disabled = false;
      }
    },
  }, t('d.confirm'));
  const modal = openModal({
    title: t('d.confirmTitle'), eyebrow: project.title,
    body: [
      h('div', { class: 'sched-when' },
        field(t('d.date'), dateInput),
        field(`${t('d.start')} · ${t('d.inTz', { city: cityName(tz) })}`, timeSelect),
        field(t('meeting.duration'), h('div', { class: 'static-value' }, duration(project.duration)))),
      repeatBox,
      h('div', { class: 'eyebrow sched-eyebrow' }, t('d.everyoneLocal')),
      preview,
    ],
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, t('common.cancel')), confirm],
    className: 'modal-form',
  });
  confirm.focus();
}
