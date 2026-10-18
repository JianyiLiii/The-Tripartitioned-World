import { tr } from './locale.js';
// The Monday–Sunday × 00:00–24:00 chart. One CSS grid holds the hit cells
// (gridlines, hover, painting) plus overlay blocks for each run of equal
// value, so availability reads as calendar blocks rather than 336 squares.
//
// view.mode 'mine':    view.mine[i] = 1 where I'm free; drag to paint/erase.
// view.mode 'overlap': member-colored bands; orange when everyone is free.

import { h } from './dom.js';
import { CELLS, PER_DAY, SLOT } from './schedule.js';
import { hm } from './tz.js';
import { availablePeople, memberColor } from './member-colors.js';

const LONG_PRESS_MS = 300;
const ROW = 3; // grid row of 00:00 (row 1: day headers, row 2: spacer so the 00:00 label shows)
let gridId = 0;

export class WeekGrid {
  constructor({ onCommit, onHover, onLeave, onSelect }) {
    this.onCommit = onCommit;
    this.onHover = onHover;
    this.onLeave = onLeave;
    this.onSelect = onSelect;
    this.view = null;
    this.drag = null;
    this.pending = null;
    this.hoverIndex = -1;
    this.blocks = [];
    this.selectionBlocks = [];

    this.el = h('div', { class: 'wk', tabindex: '0', role: 'application' });
    const hintId = `week-grid-hint-${++gridId}`;
    this.hint = h('span', { id: hintId, class: 'sr-only' });
    this.status = h('span', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    this.el.setAttribute('aria-describedby', hintId);
    this.el.append(this.hint, this.status);
    this.el.append(h('div', { class: 'wk-corner' }));
    this.heads = [];
    for (let d = 0; d < 7; d++) {
      const head = h('div', { class: 'wk-head', style: { 'grid-column': String(d + 2) } },
        h('span', { class: 'wk-day' }), h('span', { class: 'wk-date' }));
      this.heads.push(head);
      this.el.append(head);
    }
    for (let hour = 0; hour <= 24; hour++) {
      this.el.append(h('div', { class: 'wk-hour', style: { 'grid-row': String(hour * 2 + ROW) } }, hm(hour * 60)));
    }
    this.cells = [];
    for (let i = 0; i < CELLS; i++) {
      const d = Math.floor(i / PER_DAY), s = i % PER_DAY;
      let cls = 'wk-cell';
      if (s % 2) cls += ' half';
      if (s === PER_DAY - 1) cls += ' end-row';
      if (d === 6) cls += ' end-col';
      const cell = h('div', { class: cls, style: { 'grid-column': String(d + 2), 'grid-row': String(s + ROW) } });
      this.cells.push(cell);
      this.el.append(cell);
    }
    this.hover = h('div', { class: 'wk-hover', hidden: true });
    this.sel = h('div', { class: 'wk-sel', hidden: true });
    this.now = h('div', { class: 'wk-now', hidden: true });
    this.el.append(this.hover, this.sel, this.now);

    this.el.addEventListener('pointerdown', e => this.pointerDown(e));
    this.el.addEventListener('pointermove', e => this.pointerMove(e));
    this.el.addEventListener('pointerup', e => this.pointerUp(e));
    this.el.addEventListener('pointercancel', () => this.cancel());
    this.el.addEventListener('pointerleave', e => {
      if (!this.drag && e.pointerType !== 'touch') {
        this.cancel();
        this.clearHover();
      }
    });
    this.el.addEventListener('touchmove', e => { if (this.drag) e.preventDefault(); }, { passive: false });
    this.el.addEventListener('contextmenu', e => { if (this.drag || this.pending) e.preventDefault(); });
    this.el.addEventListener('keydown', e => this.keyDown(e));
    this.el.addEventListener('blur', () => this.clearHover());
  }

  update(view) {
    if (this.view?.mode !== view.mode) this.cancel();
    this.view = view;
    this.el.classList.toggle('mode-mine', view.mode === 'mine');
    this.el.classList.toggle('mode-overlap', view.mode === 'overlap');
    this.el.setAttribute('aria-label', view.label || '');
    this.hint.textContent = view.mode === 'mine'
      ? tr('Use arrow keys to explore. Press Enter or Space to change your weekly availability.')
      : this.onSelect
        ? tr('Use arrow keys to explore. Click or press Enter or Space on an available future time to schedule a meeting.')
        : tr('Use arrow keys to explore availability.');
    view.days.forEach((day, d) => {
      const head = this.heads[d];
      head.children[0].textContent = day.label;
      head.children[1].textContent = day.date;
      head.classList.toggle('today', day.isToday);
    });
    this.renderBlocks();
    this.renderOverlapSelection();
    this.renderNow();
  }

  renderBlocks() {
    for (const el of this.blocks) el.remove();
    this.blocks = [];
    const v = this.view;
    const valueAt = v.mode === 'mine' ? i => v.mine[i] : i => v.masks[i];
    for (let d = 0; d < 7; d++) {
      for (let s = 0; s < PER_DAY;) {
        const value = valueAt(d * PER_DAY + s);
        if (!value) { s++; continue; }
        let e = s + 1;
        while (e < PER_DAY && valueAt(d * PER_DAY + e) === value) e++;
        this.blocks.push(this.block(d, s, e - s, value));
        s = e;
      }
    }
    // While editing, a faint wash shows where the others are free.
    for (let i = 0; i < CELLS; i++) {
      const level = v.mode === 'mine' && v.others ? v.others[i] : 0;
      if (level) this.cells[i].dataset.o = String(level);
      else delete this.cells[i].dataset.o;
      this.cells[i].classList.toggle('can-schedule', this.canSelect(i));
    }
    this.el.append(...this.blocks);
  }

  block(d, s, len, value) {
    const v = this.view;
    const all = v.mode === 'overlap' && v.isAll(value);
    const time = `${hm(s * SLOT)}–${hm((s + len) * SLOT)}`;
    const cls = v.mode === 'mine'
      ? `wk-blk mine ${v.mineClass}`
      : `wk-blk ov rp-${v.rampStep(value)}${all ? ' all' : ''}`;
    const el = h('div', {
      class: cls,
      style: { 'grid-column': String(d + 2), 'grid-row': `${s + ROW} / span ${len}`,
        ...(v.mode === 'mine' && v.mineColor ? { '--mc': v.mineColor } : {}) },
    });
    if (v.mode === 'overlap') {
      const count = v.count(value);
      const people = availablePeople(value, v.people);
      const description = tr("{v0} {v1}, {v2}: {v3} of {v4} participants available{v5}{v6}", {v0: v.days[d].label, v1: v.days[d].date, v2: time, v3: count, v4: v.total, v5: people.length ? '. ' + people.map(person => person.member.name).join(', ') : '', v6: all ? '. ' + tr('Everyone available') : ''});
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', description);
      el.setAttribute('title', description);
      if (people.length && !all) {
        el.classList.add('member-bands');
        el.append(h('span', { class: 'wk-member-bands', 'aria-hidden': 'true' }, people.map(person =>
          h('i', { style: { '--mc': memberColor(person.member.index) } }))));
      }
      el.append(h('span', { class: 'wk-block-count', 'aria-hidden': 'true' }, `${count}/${v.total}`));
      if (len >= 4) el.append(h('span', { class: 'wk-block-time', 'aria-hidden': 'true' }, time));
    } else if (len >= 2) {
      el.append(h('span', { class: 'wk-lbl' }, time));
    }
    return el;
  }

  renderNow() {
    const pos = this.view.now;
    this.now.hidden = !pos;
    if (!pos) return;
    this.now.style.setProperty('grid-column', String(pos.day + 2));
    this.now.style.setProperty('grid-row', String(Math.floor(pos.minute / SLOT) + ROW));
    this.now.style.setProperty('--frac', `${((pos.minute % SLOT) / SLOT) * 100}%`);
  }

  canSelect(i) {
    return this.view?.mode === 'overlap' && typeof this.onSelect === 'function'
      && Number.isInteger(i) && i >= 0 && i < CELLS
      && typeof this.view.canSelect === 'function' && this.view.canSelect(i) === true;
  }

  select(i) {
    if (!this.canSelect(i)) return false;
    this.clearHover();
    this.onSelect(i);
    return true;
  }

  renderOverlapSelection() {
    for (const el of this.selectionBlocks) el.remove();
    this.selectionBlocks = [];
    const v = this.view;
    if (v.mode !== 'overlap' || !Number.isInteger(v.selectedIndex)
      || v.selectedIndex < 0 || v.selectedIndex >= CELLS) return;
    const slots = Number.isInteger(v.durationSlots) && v.durationSlots > 0 ? v.durationSlots : 1;
    const end = Math.min(CELLS, v.selectedIndex + slots);
    for (let i = v.selectedIndex; i < end;) {
      const day = Math.floor(i / PER_DAY), slot = i % PER_DAY;
      const len = Math.min(PER_DAY - slot, end - i);
      const segment = h('div', {
        class: 'wk-meeting-selection', 'aria-hidden': 'true',
        style: { 'grid-column': String(day + 2), 'grid-row': `${slot + ROW} / span ${len}` },
      });
      this.selectionBlocks.push(segment);
      i += len;
    }
    this.el.append(...this.selectionBlocks);
  }

  // Cell under a point, from the geometry of the first and last cells.
  cellAt(x, y, clamp) {
    const first = this.cells[0].getBoundingClientRect();
    const last = this.cells[CELLS - 1].getBoundingClientRect();
    let d = Math.floor((x - first.left) / ((last.right - first.left) / 7));
    let s = Math.floor((y - first.top) / ((last.bottom - first.top) / PER_DAY));
    if (clamp) {
      d = Math.min(6, Math.max(0, d));
      s = Math.min(PER_DAY - 1, Math.max(0, s));
    } else if (d < 0 || d > 6 || s < 0 || s >= PER_DAY) {
      return -1;
    }
    return d * PER_DAY + s;
  }

  pointerDown(e) {
    if (e.button !== 0 || e.isPrimary === false || !this.view) return;
    const i = this.cellAt(e.clientX, e.clientY, false);
    if (i < 0) return;
    if (e.pointerType === 'touch' || this.view.mode === 'overlap') {
      // Tap toggles (or shows details); long-press then drag paints. Plain swipes scroll.
      this.cancel();
      this.pending = { i, x: e.clientX, y: e.clientY, id: e.pointerId, timer: 0, mode: this.view.mode };
      if (e.pointerType !== 'touch') {
        e.preventDefault();
        this.el.focus({ preventScroll: true });
      }
      if (this.view.mode === 'mine') {
        this.pending.timer = setTimeout(() => {
          const p = this.pending;
          if (!p) return;
          this.pending = null;
          if (navigator.vibrate) navigator.vibrate(8);
          this.startDrag(p.i, p.id);
        }, LONG_PRESS_MS);
      }
      return;
    }
    if (this.view.mode !== 'mine') return;
    e.preventDefault();
    this.el.focus({ preventScroll: true });
    this.startDrag(i, e.pointerId);
  }

  startDrag(i, pointerId) {
    this.drag = { anchor: i, current: i, add: !this.view.mine[i] };
    try { this.el.setPointerCapture(pointerId); } catch { /* pointer already gone */ }
    this.clearHover();
    this.renderSelection();
  }

  pointerMove(e) {
    if (!this.view) return;
    if (this.pending) {
      if (e.pointerId !== this.pending.id) return;
      if (Math.hypot(e.clientX - this.pending.x, e.clientY - this.pending.y) > 10) {
        clearTimeout(this.pending.timer);
        this.pending = null;
      }
      return;
    }
    if (this.drag) {
      const i = this.cellAt(e.clientX, e.clientY, true);
      if (i !== this.drag.current) {
        this.drag.current = i;
        this.renderSelection();
      }
      return;
    }
    if (e.pointerType !== 'touch') this.setHover(this.cellAt(e.clientX, e.clientY, false), e.clientX, e.clientY);
  }

  pointerUp(e) {
    if (this.pending) {
      if (e.pointerId !== this.pending.id) return;
      const { i, x, y, timer, mode } = this.pending;
      clearTimeout(timer);
      this.pending = null;
      if (!this.view || this.view.mode !== mode || Math.hypot(e.clientX - x, e.clientY - y) > 10
        || this.cellAt(e.clientX, e.clientY, false) !== i) return;
      if (mode === 'mine') this.onCommit?.([i], !this.view.mine[i]);
      else if (!this.select(i)) this.setHover(i, x, y);
      return;
    }
    if (!this.drag || !this.view) return;
    const { anchor, current, add } = this.drag;
    this.drag = null;
    this.sel.hidden = true;
    this.onCommit(this.rectCells(anchor, current), add);
    if (e.pointerType !== 'touch') this.setHover(this.cellAt(e.clientX, e.clientY, false), e.clientX, e.clientY);
  }

  cancel() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
    this.drag = null;
    this.sel.hidden = true;
  }

  rectCells(a, b) {
    const [d0, d1] = [Math.floor(a / PER_DAY), Math.floor(b / PER_DAY)].sort((x, y) => x - y);
    const [s0, s1] = [a % PER_DAY, b % PER_DAY].sort((x, y) => x - y);
    const out = [];
    for (let d = d0; d <= d1; d++) for (let s = s0; s <= s1; s++) out.push(d * PER_DAY + s);
    return out;
  }

  renderSelection() {
    const { anchor, current, add } = this.drag;
    const [d0, d1] = [Math.floor(anchor / PER_DAY), Math.floor(current / PER_DAY)].sort((x, y) => x - y);
    const [s0, s1] = [anchor % PER_DAY, current % PER_DAY].sort((x, y) => x - y);
    this.sel.hidden = false;
    this.sel.className = `wk-sel ${add ? `add ${this.view.mineClass}` : 'erase'}`;
    this.sel.style.setProperty('grid-column', `${d0 + 2} / ${d1 + 3}`);
    this.sel.style.setProperty('grid-row', `${s0 + ROW} / ${s1 + ROW + 1}`);
    this.sel.dataset.label = `${hm(s0 * SLOT)}–${hm((s1 + 1) * SLOT)}`;
  }

  setHover(i, x, y) {
    if (!this.view || i < 0 || i >= CELLS) { this.clearHover(); return; }
    if (i !== this.hoverIndex) {
      this.hoverIndex = i;
      this.hover.hidden = false;
      this.hover.style.setProperty('grid-column', String(Math.floor(i / PER_DAY) + 2));
      this.hover.style.setProperty('grid-row', String((i % PER_DAY) + ROW));
    }
    if (this.onHover) this.onHover(i, x, y);
  }

  clearHover() {
    if (this.hoverIndex < 0) return;
    this.hoverIndex = -1;
    this.hover.hidden = true;
    if (this.onLeave) this.onLeave();
  }

  keyDown(e) {
    if (!this.view) return;
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -PER_DAY, ArrowRight: PER_DAY }[e.key];
    if (step) {
      e.preventDefault();
      let i = this.hoverIndex >= 0 ? this.hoverIndex : 18; // Monday 09:00
      if (this.hoverIndex >= 0) {
        const d = Math.floor(i / PER_DAY), s = i % PER_DAY;
        if (Math.abs(step) === 1) i = d * PER_DAY + Math.min(PER_DAY - 1, Math.max(0, s + step));
        else i = Math.min(6, Math.max(0, d + Math.sign(step))) * PER_DAY + s;
      }
      const cell = this.cells[i];
      cell.scrollIntoView({ block: 'nearest' });
      const r = cell.getBoundingClientRect();
      this.setHover(i, r.right, r.top + r.height / 2);
      const day = this.view.days[Math.floor(i / PER_DAY)];
      const availability = this.view.mode === 'overlap'
        ? tr("{v0} of {v1} participants available. {v2}", {v0: this.view.count(this.view.masks[i]), v1: this.view.total, v2: this.canSelect(i) ? tr('Press Enter to schedule.') : tr('This start time cannot be selected.')})
        : this.view.mine[i] ? tr('Available.') : tr('Unavailable.');
      this.status.textContent = `${day.label} ${day.date}, ${hm((i % PER_DAY) * SLOT)}. ${availability}`;
    } else if ((e.key === 'Enter' || e.key === ' ') && this.hoverIndex >= 0) {
      e.preventDefault();
      const i = this.hoverIndex;
      if (this.view.mode === 'mine') {
        this.onCommit?.([i], !this.view.mine[i]);
        const r = this.cells[i].getBoundingClientRect();
        if (this.onHover) this.onHover(i, r.right, r.top + r.height / 2);
      } else if (!this.select(i)) {
        this.status.textContent = tr('This start time cannot be selected. Choose an available future time.');
      }
    } else if (e.key === 'Escape') {
      this.cancel();
      this.clearHover();
    }
  }

  destroy() {
    this.cancel();
    this.clearHover();
  }
}
