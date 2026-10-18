import { tr } from '../locale.js';
// Weekly availability is the primary scheduling workspace. Confirmed future
// meetings follow it, with call details and participants below.

import { fill, h, icon } from '../dom.js';
import { api, errorText } from '../api.js';
import { ago, duration, monthDay, t, weekday } from '../i18n.js';
import { WeekGrid } from '../grid.js';
import { calendarFile, downloadFile, linkInfo, relativeTime } from '../meeting.js';
import {
  CELLS, PER_DAY, SLOT, availabilityMasks, dayRuns, emptySlots, hasAny,
  popcount, rampStep, rangeInstants, rangesFromSlots, slotsFromRanges,
  dateKey, weekKeyAt,
} from '../schedule.js';
import {
  addDays, cityName, clock, countryOf, detectTimeZone, formatOffset, hm, isValidTimeZone, mondayOf,
  offsetMinutes, sameClock, sameDate, zonedParts,
} from '../tz.js';
import {
  avatar, confirmDialog, hideTooltip, inviteDialog, linkDialog, localRange,
  meetingForm, memberClass, openMenu, pickTimeZone, scheduleDialog, segmented, showTooltip, toast,
} from '../ui.js';
import { meetingStarts } from '../overlap-model.js';
import { now as serverNow, today, subscribeClock, clockReady } from '../time.js';
import { weekPicker, mondayForDate } from '../week-picker.js';
import { upcomingMeetings } from '../future-meetings.js';
import { memberColor } from '../member-colors.js';
import { suggestedTimes } from '../suggested-times.js';

const POLL_MS = 15000;
const BEST_SHOWN = 3;

export function ProjectView(ctx, projectId) {
  const s = {
    project: null,
    records: {},         // other invitees' saved availability, by member key
    mine: null,          // my saved record
    slots: emptySlots(), // my availability being edited, on my own clock
    weeks: {},          // independent local-date weeks, including unsaved edits
    editorWeek: null,
    baseUpdatedAt: null,
    editorTz: null,
    savedSig: '',
    dirty: false,
    saving: false,
    patching: false,
    tab: null,           // 'mine' | 'overlap'
    weekStart: null,      // null follows this week in the selected display zone
    viewTz: null,        // overlap shown in another zone; null = mine
    bestLimit: BEST_SHOWN,
    bestCacheKey: null,
    bestCache: [],
    grid: null,          // computed data behind the chart
    overlap: null,       // computed data behind "best times"
    selectedStart: null, // epoch, preserved while changing display zones
    starts: new Map(),   // full-duration meeting starts in the displayed week
    futureMeetings: [],
    futureLoaded: false,
    futureLoading: false,
    futureError: null,
    memberBits: new Map(), // meeting-local masks, independent of profile colors
  };
  const grid = new WeekGrid({ onCommit: paint, onSelect: selectStart, onHover: showCellTip, onLeave: hideTooltip });
  const el = h('div', { class: 'page detail meeting-week-page' }, h('div', { class: 'page-loading' }, t('common.loading')));
  let headBox, overviewBox, schedulingSection, editorBody, saveBar, chartTools, chartFoot, bestBox, selectionBox, futureBox;
  let pollTimer = 0, destroyed = false, futureRequest = 0, revision = 0;
  const unsubscribeClock = subscribeClock(() => {
    if (!destroyed && headBox && s.project && !grid.drag) tick();
  });

  const onKey = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  };
  const onBeforeUnload = e => {
    if (s.dirty) { e.preventDefault(); e.returnValue = ''; }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onBeforeUnload);

  load();

  // ------------------------------------------------------------- data --

  async function load() {
    try {
      const data = await fetchMeeting();
      if (destroyed) return;
      apply(data, true);
      build();
      refreshFuture();
      pollTimer = setInterval(poll, POLL_MS);
    } catch (err) {
      if (!destroyed) fill(el, errorState(err));
    }
  }

  // Returns true when my own saved record was (re)loaded into the editor.
  function apply(data, initial) {
    refreshMembers(data.members);
    s.project = data.project;
    s.memberBits = new Map(s.project.invitees.map((key, index) => [key, 1n << BigInt(index)]));
    const all = data.availability || {};
    const mine = all[ctx.me.key] || null;
    s.records = {};
    for (const [key, record] of Object.entries(all)) {
      if (key !== ctx.me.key && isValidTimeZone(record.tz)) s.records[key] = record;
    }
    const reload = initial || (!s.dirty && (mine ? mine.updatedAt : 0) !== (s.mine ? s.mine.updatedAt : 0));
    s.mine = mine;
    if (reload) {
      s.editorTz = (mine && isValidTimeZone(mine.tz) && mine.tz) || ctx.me.tz || detectTimeZone();
      s.weeks = structuredClone(mine?.weeks || {});
      s.baseUpdatedAt = mine?.updatedAt ?? null;
      s.editorWeek = null;
      loadEditorWeek();
      s.savedSig = signature();
      s.dirty = false;
    }
    if (s.tab == null) s.tab = mine || Object.keys(s.records).length ? 'overlap' : 'mine';
    return reload;
  }

  function refreshMembers(members) {
    if (!Array.isArray(members)) return;
    const directory = new Map(ctx.members.map(member => [member.key, member]));
    for (const member of members) directory.set(member.key, member);
    ctx.members = [...directory.values()].sort((a, b) => a.index - b.index);
  }

  async function fetchMeeting() {
    const data = await api.project(projectId);
    // Older local data/API versions do not include the member directory.
    // Refresh it too so someone invited after this page opened gets a name.
    if (!Array.isArray(data.members)) data.members = (await api.me()).members;
    return data;
  }

  const parentRoute = () => s.project?.workspaceId ? `#/w/${s.project.workspaceId}` : '#/meetings';

  async function meetingContext() {
    if (!s.project.workspaceId) {
      refreshMembers((await api.me()).members);
      return ctx;
    }
    const data = await api.workspace(s.project.workspaceId);
    refreshMembers(data.members);
    return { ...ctx, members: data.members };
  }

  async function poll() {
    if (document.hidden || grid.drag || s.saving || s.patching || document.querySelector('.overlay') || choosingWeek()) return;
    const before = revision;
    try {
      const data = await fetchMeeting();
      if (destroyed || before !== revision || grid.drag || s.saving || s.patching
        || choosingWeek() || document.querySelector('.overlay')) return;
      const reloaded = apply(data, false);
      renderHead();
      renderOverview();
      if (reloaded) renderEditor();
      renderChart();
      renderBest();
      renderSaveBar();
      refreshFuture();
    } catch (err) {
      if (err.status === 404 && !destroyed) {
        stopTimers();
        fill(el, errorState(err));
      }
    }
  }

  function tick() {
    if (choosingWeek()) return; // Keep the native date picker open while choosing.
    renderOverview();
    renderChart();
    renderBest();
    renderSaveBar();
    renderFuture();
  }

  function choosingWeek() {
    return Boolean(chartTools?.contains(document.activeElement)
      && document.activeElement.matches('input, select'));
  }

  async function refreshFuture() {
    const request = ++futureRequest;
    s.futureLoading = true;
    renderFuture();
    try {
      // These endpoints only return meetings this signed-in person may read.
      const result = s.project.workspaceId
        ? await api.workspace(s.project.workspaceId)
        : await api.projects();
      if (destroyed || request !== futureRequest) return;
      refreshMembers(result.members);
      s.futureMeetings = result.meetings || result.projects || [];
      s.futureLoaded = true;
      s.futureError = null;
    } catch (err) {
      if (destroyed || request !== futureRequest) return;
      s.futureError = err;
    } finally {
      if (!destroyed && request === futureRequest) {
        s.futureLoading = false;
        renderFuture();
      }
    }
  }

  function signature() {
    return `${s.editorTz}|${JSON.stringify(Object.fromEntries(Object.entries(s.weeks).sort(([a], [b]) => a.localeCompare(b))))}`;
  }

  function editorMonday() { return s.weekStart || mondayOf(s.editorTz, 0, serverNow()); }

  function loadEditorWeek() {
    const key = dateKey(editorMonday());
    if (key === s.editorWeek) return false;
    s.editorWeek = key;
    s.slots = slotsFromRanges(s.weeks[key] || []);
    return true;
  }

  function changed() {
    s.weeks[s.editorWeek] = rangesFromSlots(s.slots);
    s.dirty = signature() !== s.savedSig;
    renderEditor();
    renderChart();
    renderBest();
    renderSaveBar();
  }

  function paint(cells, add) {
    for (const i of cells) s.slots[i] = add ? 1 : 0;
    changed();
  }

  const isOwner = () => s.project.createdBy === ctx.me.key;
  const bitOf = member => s.memberBits.get(member.key) || 0n;

  /** Invited members, in member-list order (that order also sets their colors). */
  function invitees() {
    const keys = new Set(s.project.invitees);
    return ctx.members.filter(m => keys.has(m.key));
  }

  function memberTz(member) {
    if (member.key === ctx.me.key) return s.editorTz;
    const tz = (s.records[member.key] && s.records[member.key].tz) || member.tz;
    return tz && isValidTimeZone(tz) ? tz : null;
  }

  // Everyone who has filled in. My unsaved edits count, so the overlap is live.
  function people() {
    const list = [];
    for (const member of invitees()) {
      const bit = bitOf(member);
      if (!bit) continue;
      if (member.key === ctx.me.key) {
        if (s.mine || Object.values(s.weeks).some(ranges => ranges.length)) list.push({ member, bit, tz: s.editorTz, weeks: s.weeks });
      } else if (s.records[member.key]) {
        const r = s.records[member.key];
        list.push({ member, bit, tz: r.tz, weeks: r.weeks || {} });
      }
    }
    return list;
  }

  function compute(tz) {
    const monday = s.weekStart || mondayOf(tz, 0, serverNow());
    // One extra day lets a Sunday meeting finish after midnight on Monday.
    const instants = rangeInstants(monday, tz, 8);
    const who = people();
    return {
      tz, monday, startDate: monday, days: 7, instants, people: who,
      masks: availabilityMasks(instants, who),
      filled: who.reduce((acc, p) =>
        Object.hasOwn(p.weeks, weekKeyAt(instants[0], p.tz)) || Object.hasOwn(p.weeks, weekKeyAt(instants[CELLS - 1], p.tz))
          ? acc | p.bit : acc, 0n),
    };
  }

  function availableStarts(data) {
    const notBefore = serverNow();
    return Array.from({ length: 7 }, (_, day) =>
      meetingStarts(data.masks, day, s.project.duration, data.instants,
        { tz: data.tz, startDate: data.monday, notBefore }))
      .flat().filter(start => start.valid && start.count > 0);
  }

  function selectStart(index) {
    const choice = s.starts.get(index);
    if (!clockReady() || !choice || s.grid.instants[index] < serverNow()) return;
    s.selectedStart = s.grid.instants[index];
    hideTooltip();
    renderChart();
  }

  function openSelected() {
    // Recompute on confirmation: the clock or an invitee's hours may have changed.
    const data = compute(s.grid.tz);
    const choice = availableStarts(data).find(start => data.instants[start.start] === s.selectedStart);
    if (!choice) {
      s.selectedStart = null;
      renderChart();
      toast(tr('This time is no longer available. Select another time.'), 'error');
      return;
    }
    openSchedule(s.selectedStart, data.tz);
  }

  // ------------------------------------------------------------ actions --

  async function save() {
    if (!s.dirty || s.saving) return;
    revision++;
    s.saving = true;
    renderSaveBar();
    const sent = signature();
    try {
      const { availability } = await api.saveAvailability(projectId, {
        tz: s.editorTz, weeks: structuredClone(s.weeks), baseUpdatedAt: s.baseUpdatedAt,
      });
      s.mine = availability;
      s.baseUpdatedAt = availability.updatedAt;
      s.savedSig = sent;
      s.dirty = signature() !== sent; // edits made while saving stay unsaved
      s.tab = 'overlap';
      toast(t('p.saved'), 'success');
    } catch (err) {
      toast(t('p.saveError', { msg: errorText(err) }), 'error');
    } finally {
      revision++;
      s.saving = false;
      if (!destroyed) {
        renderOverview();
        renderChart();
        renderBest();
        renderSaveBar();
      }
    }
  }

  /** Save meeting details, then refresh all views of the confirmed time. */
  async function patch(fields) {
    revision++;
    s.patching = true;
    try {
      const { project } = await api.updateProject(projectId, fields);
      if (destroyed) return;
      if (!project.invitees.includes(ctx.me.key)) {
        // Removing yourself intentionally removes access to the meeting.
        s.project = project;
        s.dirty = false;
        stopTimers();
        toast(tr('You have left this meeting'), 'success');
        ctx.navigate(parentRoute());
        return;
      }
      if ('invitees' in fields) {
        const data = await fetchMeeting();
        if (destroyed) return;
        apply(data, false);
      } else {
        s.project = project;
      }
      renderHead();
      renderOverview();
      renderChart();
      renderBest();
      refreshFuture();
    } finally {
      s.patching = false;
      revision++;
    }
  }

  async function changeTz() {
    const tz = await pickTimeZone({ current: s.editorTz });
    if (!tz || tz === s.editorTz || destroyed) return;
    setEditorTz(tz);
    if (tz !== ctx.me.tz) {
      ctx.setMyTimeZone(tz).catch(err => toast(t('common.error', { msg: errorText(err) }), 'error'));
    }
  }

  // My times are wall-clock times: switching zone keeps 09:00 as 09:00.
  function setEditorTz(tz) {
    s.editorTz = tz;
    renderOverview();
    changed();
  }

  async function clearAll() {
    if (!hasAny(s.slots)) return;
    const ok = await confirmDialog({ title: t('p.clearAll'), message: tr('Clear availability for the displayed week? Other weeks will be kept. Save to apply.'), confirmText: t('p.clearAll'), danger: true });
    if (ok) {
      s.slots = emptySlots();
      changed();
    }
  }

  async function editMeeting() {
    try {
      const meetingCtx = await meetingContext();
      if (destroyed) return;
      meetingForm({
        ctx: meetingCtx,
        initial: s.project,
        title: t('meeting.edit'),
        submitText: t('meeting.save'),
        onSubmit: values => patch(values),
      });
    } catch (err) {
      toast(t('common.error', { msg: errorText(err) }), 'error');
    }
  }

  async function editInvitees() {
    try {
      const meetingCtx = await meetingContext();
      if (destroyed) return;
      inviteDialog({ ctx: meetingCtx, project: s.project, onSave: keys => patch({ invitees: keys }) });
    } catch (err) {
      toast(t('common.error', { msg: errorText(err) }), 'error');
    }
  }

  async function deleteMeeting() {
    const ok = await confirmDialog({
      title: t('meeting.delete'), message: t('meeting.deleteConfirm', { title: s.project.title }),
      confirmText: t('meeting.delete'), danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteProject(projectId);
      s.dirty = false;
      toast(t('meeting.deleted'), 'success');
      ctx.navigate(parentRoute());
    } catch (err) {
      toast(t('common.error', { msg: errorText(err) }), 'error');
    }
  }

  function openSchedule(start, tz = s.grid?.tz || s.editorTz) {
    if (!clockReady()) {
      toast(tr('Current time needs to be synced. Reconnect to continue.'), 'error');
      return;
    }
    scheduleDialog({
      project: s.project,
      invitees: invitees().map(member => ({ member, tz: memberTz(member) })),
      tz,
      start,
      onSave: async schedule => {
        await patch({ schedule });
        toast(t('d.scheduled'), 'success');
      },
    });
  }

  async function unschedule() {
    const ok = await confirmDialog({ title: t('d.unschedule'), message: t('d.unscheduleConfirm'), confirmText: t('d.unschedule') });
    if (!ok) return;
    try {
      await patch({ schedule: null });
      toast(t('d.unscheduled'), 'success');
    } catch (err) {
      toast(t('common.error', { msg: errorText(err) }), 'error');
    }
  }

  function addToCalendar() {
    const name = s.project.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'meeting';
    downloadFile(`${name}.ics`, calendarFile(s.project), 'text/calendar;charset=utf-8');
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(s.project.link);
    } catch {
      const area = h('textarea', { class: 'sr-only' }, s.project.link);
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast(t('d.copied'), 'success');
  }

  function setRange(day, oldStart, oldEnd, newStart, newEnd) {
    const base = day * PER_DAY;
    for (let k = oldStart; k < oldEnd; k++) s.slots[base + k] = 0;
    for (let k = newStart; k < newEnd; k++) s.slots[base + k] = 1;
    changed();
  }

  // A new block an hour after the day's last one (09:00–12:00 on an empty
  // day), or the first free spot that doesn't touch an existing block.
  function freeSpot(day) {
    const base = day * PER_DAY;
    const runs = dayRuns(s.slots, day);
    const len = runs.length ? 2 : 6;
    const free = k => k < 0 || k >= PER_DAY || !s.slots[base + k];
    const fits = start => {
      if (start < 0 || start + len > PER_DAY) return false;
      for (let k = start - 1; k <= start + len; k++) if (!free(k)) return false;
      return true;
    };
    const preferred = runs.length ? runs[runs.length - 1][1] + 2 : 18;
    if (fits(preferred)) return [preferred, preferred + len];
    for (let start = 0; start + len <= PER_DAY; start++) if (fits(start)) return [start, start + len];
    return null;
  }

  function copyDay(from, targets) {
    for (const day of targets) {
      if (day === from) continue;
      for (let k = 0; k < PER_DAY; k++) s.slots[day * PER_DAY + k] = s.slots[from * PER_DAY + k];
    }
    changed();
  }

  function clearDay(day) {
    s.slots.fill(0, day * PER_DAY, (day + 1) * PER_DAY);
    changed();
  }

  function shiftWeek(delta) {
    s.weekStart = delta === 0 ? null : addDays(s.grid.monday, delta * 7);
    s.selectedStart = null;
    s.showAllBest = false;
    hideTooltip();
    loadEditorWeek();
    renderEditor();
    renderChart();
    renderBest();
  }

  function jumpToWeek(date) {
    const monday = mondayForDate(date);
    if (!monday) return;
    const current = mondayOf(s.grid.tz, 0, serverNow());
    s.weekStart = sameDate(monday, current) ? null : monday;
    s.selectedStart = null;
    s.showAllBest = false;
    hideTooltip();
    loadEditorWeek();
    renderEditor();
    renderChart();
    renderBest();
  }

  // ---------------------------------------------------------- rendering --

  function build() {
    headBox = h('header', { class: 'detail-head rise' });
    overviewBox = h('div', { class: 'meeting-details rise' });
    editorBody = h('div', { class: 'editor-body' });
    saveBar = h('div', { class: 'save-bar' });
    chartTools = h('div', { class: 'chart-tools' });
    chartFoot = h('div', { class: 'chart-foot' });
    bestBox = h('section', { class: 'panel p-best' });
    selectionBox = h('div', { class: 'week-selection', 'aria-live': 'polite' });
    futureBox = h('section', { class: 'future-meetings rise', 'aria-label': tr('Future meetings') });

    const editor = h('section', { class: `panel p-editor ${memberClass(ctx.me.index)}` },
      h('div', { class: 'panel-head' },
        h('h3', { class: 'panel-title' }, tr('My hours')),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: clearAll }, t('p.clearAll'))),
      editorBody,
      saveBar);
    const chart = h('section', { class: 'panel panel-solid p-chart' }, chartTools, grid.el, selectionBox, chartFoot);
    schedulingSection = h('section', { class: 'sched rise', id: 'meeting-availability' },
        h('div', { class: 'sched-head' },
          h('h2', { class: 'display section-title' }, tr('Weekly availability')),
          h('p', { class: 'section-sub' }, tr('Availability is saved by date. Choose a week, then select a meeting time.'))),
        h('div', { class: 'p-layout' }, editor, chart, bestBox));
    fill(el, headBox, schedulingSection, futureBox, overviewBox);

    renderHead();
    renderOverview();
    renderEditor();
    renderChart();
    renderBest();
    renderSaveBar();
    renderFuture();
  }

  function renderHead() {
    const p = s.project;
    fill(headBox,
      h('a', { class: 'back-link', href: parentRoute() }, icon('arrowLeft'), t(p.workspaceId ? 'flow.backProject' : 'flow.backMeetings')),
      h('div', { class: 'detail-title-row' },
        h('div', { class: 'detail-titles' },
          h('div', { class: 'eyebrow' }, t('item.by', { name: ctx.nameOf(p.createdBy) }), h('i', { class: 'sep' }), duration(p.duration)),
          h('h1', { class: 'display detail-title' }, p.title),
          p.description ? h('p', { class: 'detail-desc' }, p.description) : null),
        h('div', { class: 'detail-actions' },
          h('button', { class: 'btn', type: 'button', onclick: editMeeting }, icon('pencil', 15), t('meeting.edit')),
          isOwner() ? h('button', {
            class: 'btn-icon', type: 'button', 'aria-label': t('p.dayMenu'),
            onclick: e => openMenu(e.currentTarget, [
              { label: t('meeting.delete'), icon: 'trash', danger: true, onClick: deleteMeeting },
            ]),
          }, icon('more')) : null)));
  }

  // -- overview

  function renderOverview() {
    fill(overviewBox, linkCard(), inviteesCard());
  }

  const cardHead = (label, mark = null) => h('div', { class: 'card-head' }, h('span', { class: 'eyebrow' }, label), mark);

  function renderFuture() {
    if (!futureBox || !s.project) return;
    const rows = upcomingMeetings(s.futureMeetings, s.project, serverNow());
    const tz = s.viewTz || s.editorTz;
    fill(futureBox,
      h('div', { class: 'future-head' },
        h('div', {}, h('h2', { class: 'display section-title' }, tr('Future meetings')),
          h('p', { class: 'section-sub' }, tr("Confirmed times in {v0}. Weekly meetings show their next occurrence.", {v0: cityName(tz)}))),
        s.project.workspaceId ? h('a', { class: 'btn btn-ghost btn-sm', href: parentRoute() }, tr('All project meetings'), icon('arrowRight', 14)) : null),
      s.futureError ? h('div', { class: 'future-status future-error', role: 'status' },
        h('span', {}, s.futureLoaded ? tr('Could not refresh future meetings. Showing the last saved list.') : tr('Could not load other future meetings.')),
        h('button', { class: 'btn btn-sm', type: 'button', disabled: s.futureLoading, onclick: refreshFuture }, s.futureLoading ? tr('Retrying…') : tr('Retry'))) : null,
      rows.length ? h('div', { class: 'future-list' }, rows.map(({ meeting, occurrence }) => futureRow(meeting, occurrence, tz)))
        : h('p', { class: 'future-empty' }, !s.futureLoaded && s.futureLoading
          ? tr('Loading future meetings…')
          : tr('No confirmed future meetings yet. Select a time in Weekly availability to schedule this meeting.')));
  }

  function futureRow(meeting, occurrence, tz) {
    const current = meeting.id === s.project.id;
    const members = meeting.invitees.map(key => ctx.members.find(member => member.key === key)).filter(Boolean);
    const names = meeting.invitees.map(key => ctx.members.find(member => member.key === key)?.name || tr('Participant'));
    const start = zonedParts(occurrence.start, tz);
    return h('article', { class: `future-meeting${current ? ' current' : ''}` },
      h('div', { class: 'future-date', 'aria-hidden': 'true' },
        h('span', {}, monthDay(start.month, start.day).replace(String(start.day), '').trim()),
        h('strong', {}, String(start.day)),
        h('small', {}, String(start.year))),
      h('div', { class: 'future-main' },
        h('div', { class: 'future-title' }, h('a', { href: `#/m/${meeting.id}` }, meeting.title),
          current ? h('span', { class: 'tag' }, tr('This meeting')) : null,
          h('span', { class: 'future-repeat' }, occurrence.weekly ? tr('Weekly') : tr('Once'))),
        h('p', { class: 'future-time' }, cellRange(occurrence.start, occurrence.end, tz)),
        h('div', { class: 'future-people' },
          h('div', { class: 'avatar-stack', 'aria-hidden': 'true' }, members.slice(0, 5).map(member => avatar(member, { size: 'sm' }))),
          h('span', {}, names.join(', ')))),
      h('div', { class: 'future-actions' },
        h('span', { class: 'future-relative' }, relativeTime(occurrence, serverNow())),
        current ? h('div', { class: 'future-buttons' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: addToCalendar }, icon('calendarPlus', 14), tr('Calendar')),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !clockReady(), onclick: () => openSchedule(occurrence.start, tz) }, tr('Change')),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: unschedule }, tr('Clear')))
          : h('a', { class: 'btn btn-sm', href: `#/m/${meeting.id}` }, tr('View meeting'), icon('arrowRight', 14))));
  }

  function linkCard() {
    const p = s.project;
    const info = p.link ? linkInfo(p.link) : null;
    if (!info) {
      return h('section', { class: 'panel ov-link empty-link' },
        cardHead(t('d.link')),
        h('p', { class: 'ov-lead' }, t('d.noLink')),
        h('div', { class: 'ov-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: editLink }, icon('plus', 14), t('d.addLink'))));
    }
    return h('section', { class: 'panel ov-link' },
      cardHead(t('d.link'), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: editLink }, t('d.editLink'))),
      h('div', { class: 'display ov-provider' }, info.provider || info.host),
      h('a', { class: 'ov-url', href: p.link, target: '_blank', rel: 'noopener noreferrer' }, info.short),
      h('div', { class: 'ov-actions' },
        h('a', { class: 'btn btn-primary btn-sm', href: p.link, target: '_blank', rel: 'noopener noreferrer' }, t('d.join'), icon('external', 14)),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: copyLink }, icon('copy', 14), t('d.copy'))));
  }

  function editLink() {
    linkDialog({ project: s.project, onSave: link => patch({ link }) });
  }

  function inviteesCard() {
    const who = invitees();
    return h('section', { class: 'panel ov-people' },
      cardHead(t('d.people'), h('span', { class: 'count' }, String(who.length).padStart(2, '0'))),
      h('div', { class: 'people-list' }, who.map(m => {
        const isMe = m.key === ctx.me.key;
        const filled = isMe ? Boolean(s.mine) : Boolean(s.records[m.key]);
        const tz = memberTz(m);
        return h('div', { class: `person ${memberClass(m.index)}` },
          avatar(m, { hollow: !filled }),
          h('div', { class: 'person-text' },
            h('div', { class: 'person-name' }, m.name,
              m.key === s.project.createdBy ? h('span', { class: 'tag' }, t('meeting.organizer')) : null),
            h('div', { class: 'person-sub' }, tz ? `${cityName(tz)} · ${clock(tz, serverNow())}` : '—')),
          h('span', { class: `mark ${filled ? 'mark-done' : 'mark-wait'}` }, h('i', { class: 'mark-glyph' }),
            filled ? t('d.responded') : t('d.waiting')));
      })),
      h('button', {
        class: 'btn btn-sm ov-manage', type: 'button',
        onclick: editInvitees,
      }, icon('users', 14), t('d.editPeople')));
  }

  // -- editor

  function renderEditor() {
    const focusKey = document.activeElement && editorBody.contains(document.activeElement)
      ? document.activeElement.dataset.focus : null;
    const tz = s.editorTz;
    const tzRow = h('div', { class: 'tz-box' },
      h('div', { class: 'tz-box-text' },
        h('span', { class: 'tz-box-label' }, t('p.tz')),
        h('span', { class: 'tz-box-value' }, icon('pin', 14), h('b', {}, cityName(tz)),
          countryOf(tz) ? h('span', { class: 'tz-box-country' }, countryOf(tz)) : null),
        h('span', { class: 'tz-box-meta' }, `${clock(tz, serverNow())} · ${formatOffset(offsetMinutes(tz, serverNow()))}`)),
      h('button', { class: 'btn btn-sm', type: 'button', 'data-focus': 'tz', onclick: changeTz }, t('p.change')));

    const profileTz = ctx.me.tz;
    const mismatch = profileTz && !sameClock(profileTz, tz, serverNow()) && isValidTimeZone(profileTz)
      ? h('div', { class: 'notice' },
        h('span', {}, t('p.tzMismatch', { city: cityName(tz), current: cityName(profileTz) })),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setEditorTz(profileTz) },
          t('p.useTz', { city: cityName(profileTz) })))
      : null;

    fill(editorBody,
      h('p', { class: 'hint' }, tr('Enter hours for the dates below. Other weeks stay unchanged.')),
      tzRow,
      mismatch,
      h('div', { class: 'days' }, Array.from({ length: 7 }, (_, d) => dayRow(d))));

    if (focusKey) {
      const target = editorBody.querySelector(`[data-focus="${focusKey}"]`);
      if (target) target.focus();
    }
  }

  function dayRow(day) {
    const date = addDays(editorMonday(), day);
    const runs = dayRuns(s.slots, day);
    const total = runs.reduce((sum, [a, b]) => sum + (b - a), 0) * SLOT;
    const spot = freeSpot(day);
    return h('div', { class: 'day' },
      h('div', { class: 'day-label' },
        h('span', { class: 'day-name' }, weekday(day)),
        h('time', { class: 'day-date', datetime: dateKey(date), title: dateKey(date) }, monthDay(date.month, date.day)),
        total ? h('span', { class: 'day-total' }, duration(total)) : null),
      runs.length
        ? h('div', { class: 'ranges' }, runs.map(([a, b], k) => rangeRow(day, a, b, k)))
        : h('div', { class: 'day-empty' }, t('p.none')),
      h('div', { class: 'day-actions' },
        h('button', {
          class: 'btn-icon', type: 'button', title: t('p.add'), 'aria-label': `${weekday(day)} ${t('p.add')}`,
          disabled: !spot, 'data-focus': `add-${day}`, onclick: () => spot && setRange(day, 0, 0, spot[0], spot[1]),
        }, icon('plus')),
        h('button', {
          class: 'btn-icon', type: 'button', title: t('p.dayMenu'), 'aria-label': `${weekday(day)} ${t('p.dayMenu')}`,
          'data-focus': `menu-${day}`,
          onclick: e => openMenu(e.currentTarget, [
            { label: t('p.copyWeekdays'), icon: 'copy', onClick: () => copyDay(day, [0, 1, 2, 3, 4]) },
            { label: t('p.copyAll'), icon: 'copy', onClick: () => copyDay(day, [0, 1, 2, 3, 4, 5, 6]) },
            { label: t('p.clearDay'), icon: 'trash', danger: true, onClick: () => clearDay(day) },
          ]),
        }, icon('more'))));
  }

  function rangeRow(day, start, end, k) {
    const len = end - start;
    const onStart = v => setRange(day, start, end, v, v < end ? end : Math.min(PER_DAY, v + len));
    const onEnd = v => setRange(day, start, end, v > start ? start : Math.max(0, v - len), v);
    return h('div', { class: 'range' },
      timeSelect(0, PER_DAY - 1, start, onStart, `r-${day}-${k}-s`, `${weekday(day)} ${t('p.start')}`),
      h('span', { class: 'range-dash' }, '–'),
      timeSelect(1, PER_DAY, end, onEnd, `r-${day}-${k}-e`, `${weekday(day)} ${t('p.end')}`),
      h('button', {
        class: 'btn-icon', type: 'button', title: t('p.remove'), 'aria-label': t('p.remove'),
        onclick: () => setRange(day, start, end, 0, 0),
      }, icon('x', 15)));
  }

  function timeSelect(from, to, value, onChange, focusKey, label) {
    const select = h('select', {
      class: 'input time-select', 'aria-label': label, 'data-focus': focusKey,
      onchange: e => onChange(Number(e.target.value)),
    });
    for (let slot = from; slot <= to; slot++) select.append(h('option', { value: String(slot) }, hm(slot * SLOT)));
    select.value = String(value);
    return select;
  }

  function renderSaveBar() {
    let status;
    if (s.saving) status = t('p.saving');
    else if (s.dirty) status = t('p.unsaved');
    else if (s.mine) status = t('p.savedAgo', { ago: ago(s.mine.updatedAt) });
    else status = t('p.neverSaved');
    fill(saveBar,
      h('span', { class: `save-status${s.dirty ? ' dirty' : ''}` }, s.dirty ? h('i', { class: 'dot' }) : null, status),
      h('button', {
        class: 'btn btn-primary', type: 'button', disabled: !s.dirty || s.saving, onclick: save, title: 'Ctrl+S',
      }, icon('check'), t('p.save')));
  }

  // -- chart

  function renderChart() {
    if (loadEditorWeek()) renderEditor();
    const overlapTz = s.viewTz || s.editorTz;
    const gridTz = s.tab === 'mine' ? s.editorTz : overlapTz;
    s.grid = compute(gridTz);
    s.overlap = gridTz === overlapTz ? s.grid : compute(overlapTz);

    const data = s.grid;
    const total = invitees().length;
    s.starts = new Map(availableStarts(data).map(start => [start.start, start]));
    const selectedIndex = s.selectedStart == null ? -1 : data.instants.indexOf(s.selectedStart);
    if (!s.starts.has(selectedIndex)) s.selectedStart = null;
    let others = null;
    if (s.tab === 'mine') {
      const myBit = bitOf(ctx.me);
      const othersFilled = popcount(data.filled & ~myBit);
      others = new Uint8Array(CELLS);
      if (othersFilled) {
        for (let i = 0; i < CELLS; i++) {
          const k = popcount(data.masks[i] & ~myBit);
          others[i] = k ? Math.ceil((k / othersFilled) * 3) : 0;
        }
      }
    }
    const currentDate = today(gridTz);
    grid.update({
      mode: s.tab,
      label: s.tab === 'mine' ? tr('My weekly availability') : tr('Meeting times for the selected week'),
      days: Array.from({ length: 7 }, (_, d) => {
        const date = addDays(data.monday, d);
        return { label: weekday(d), date: String(date.day), isToday: sameDate(date, currentDate) };
      }),
      now: nowPosition(gridTz, data.monday),
      mine: s.slots,
      mineClass: memberClass(ctx.me.index),
      mineColor: memberColor(ctx.me.index),
      others,
      masks: data.masks,
      people: data.people,
      total,
      count: popcount,
      rampStep: mask => rampStep(popcount(mask), total),
      isAll: mask => total > 0 && popcount(mask) === total,
      selectedIndex: s.selectedStart == null ? null : selectedIndex,
      durationSlots: Math.ceil(s.project.duration / SLOT),
      canSelect: index => clockReady() && s.starts.has(index) && data.instants[index] >= serverNow(),
    });
    renderChartTools();
    renderSelection();
    renderChartFoot();
  }

  function renderSelection() {
    if (s.tab === 'mine') {
      selectionBox.hidden = true;
      return;
    }
    selectionBox.hidden = false;
    if (!clockReady()) {
      fill(selectionBox, h('p', { class: 'week-select-empty' }, tr('Current time needs to be synced. Reconnect to continue.')));
      return;
    }
    const index = s.selectedStart == null ? -1 : s.grid.instants.indexOf(s.selectedStart);
    const choice = s.starts.get(index);
    if (!choice) {
      fill(selectionBox, h('p', { class: 'week-select-empty' },
        s.starts.size ? tr("Select a colored time that fits this {v0} meeting.", {v0: duration(s.project.duration)})
          : tr('No future time fits this meeting in the selected week. Add availability or choose another week.')));
      return;
    }
    const available = s.grid.people.filter(person => choice.group & person.bit);
    const unavailable = invitees().filter(member => !available.some(person => person.member.key === member.key));
    const total = invitees().length;
    const end = s.selectedStart + s.project.duration * 60000;
    fill(selectionBox,
      h('div', { class: 'week-selection-top' },
        h('div', {},
          h('strong', { class: 'week-selection-time' }, cellRange(s.selectedStart, end, s.grid.tz)),
          h('p', { class: 'week-selection-count' }, tr("{v0}/{v1} available for the full {v2}", {v0: choice.count, v1: total, v2: duration(s.project.duration)}),
            s.dirty ? tr(' · Includes your unsaved hours') : '')),
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: openSelected }, tr('Set meeting time'), icon('arrowRight', 14))),
      h('div', { class: 'week-selection-people' }, available.map(person => h('span', { class: memberClass(person.member.index) },
        h('i', { class: 'tip-key' }), h('b', {}, person.member.name), localRange(s.selectedStart, end, person.tz)))),
      unavailable.length ? h('p', { class: 'week-selection-missing' }, tr("Unavailable or not responded: {v0}", {v0: unavailable.map(member => member.name).join(', ')})) : null);
  }

  function nowPosition(tz, monday) {
    const p = zonedParts(serverNow(), tz);
    for (let d = 0; d < 7; d++) {
      if (sameDate(addDays(monday, d), p)) return { day: d, minute: p.hour * 60 + p.minute };
    }
    return null;
  }

  function renderChartTools() {
    const total = invitees().length;
    const filledCount = popcount(s.grid.filled);
    const tabs = segmented([
      { id: 'mine', label: tr('My availability') },
      { id: 'overlap', label: tr('Meeting times'), badge: filledCount ? `${filledCount}/${total}` : null },
    ], s.tab, id => { s.tab = id; hideTooltip(); renderChart(); renderBest(); }, tr('Weekly availability view'));

    const monday = s.grid.monday;
    const weekNav = weekPicker({
      monday, today: today(s.grid.tz), onChange: jumpToWeek,
      onToday: () => shiftWeek(0), onPrevious: () => shiftWeek(-1), onNext: () => shiftWeek(1),
    });

    let legend;
    if (s.tab === 'mine') {
      const othersFilled = popcount(s.grid.filled & ~bitOf(ctx.me));
      legend = h('div', { class: 'legend' },
        h('span', { class: 'legend-item' }, h('i', { class: `sw sw-mine ${memberClass(ctx.me.index)}` }), t('p.legendMine')),
        othersFilled ? h('span', { class: 'legend-item' }, h('i', { class: 'sw sw-others' }), t('p.legendOthers')) : null);
    } else {
      legend = h('div', { class: 'legend' },
        invitees().map(member => h('span', { class: 'legend-item' },
          h('i', { class: 'sw sw-person', style: { '--mc': memberColor(member.index) } }), member.name)),
        h('span', { class: 'legend-item' }, h('i', { class: 'sw sw-everyone' }), tr('Everyone available')));
    }
    fill(chartTools,
      h('div', { class: 'chart-row' }, tabs, weekNav),
      h('div', { class: 'chart-row' }, legend, s.tab === 'overlap' ? viewTzSelect() : null));
  }

  function viewTzSelect() {
    const zones = new Map(); // tz -> names of people there
    const add = (tz, name) => {
      if (!tz || !isValidTimeZone(tz)) return;
      if (!zones.has(tz)) zones.set(tz, []);
      if (name) zones.get(tz).push(name);
    };
    add(s.editorTz, null);
    for (const m of invitees()) add(memberTz(m), m.name);
    if (s.viewTz) add(s.viewTz, null);
    add('UTC', null);
    const current = s.viewTz || s.editorTz;
    const select = h('select', {
      class: 'input', 'aria-label': t('p.viewIn'),
      onchange: async e => {
        let tz = e.target.value;
        if (tz === '__pick') {
          e.target.value = current;
          tz = await pickTimeZone({ current });
          if (!tz) return;
        }
        s.viewTz = tz === s.editorTz ? null : tz;
        hideTooltip();
        renderChart();
        renderBest();
        renderFuture();
      },
    },
    [...zones].map(([tz, names]) => h('option', { value: tz },
      t('p.viewInCity', { city: cityName(tz) }) + (names.length ? ` · ${names.join(', ')}` : ''))),
    h('option', { value: '__pick' }, t('p.otherZone')));
    select.value = current;
    return h('label', { class: 'view-tz' }, icon('globe', 14), select);
  }

  function renderChartFoot() {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    fill(chartFoot,
      h('span', {}, icon('info', 13), s.tab === 'mine' ? t(coarse ? 'p.hintTouch' : 'p.hintMine') : tr('Counts show availability. Select a time to check the full meeting.')),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !clockReady(), onclick: () => openSchedule(null) }, tr('Set time manually')));
  }

  function showCellTip(i, x, y) {
    const data = s.grid;
    if (!data) return;
    const day = Math.floor(i / PER_DAY), slot = i % PER_DAY;
    const date = addDays(data.monday, day);
    const instant = data.instants[i];
    const mask = data.masks[i];
    const who = invitees();
    const rows = who.map(m => {
      const person = data.people.find(p => p.member.key === m.key);
      const tz = person ? person.tz : memberTz(m);
      let local = '—';
      if (tz) {
        const z = zonedParts(instant, tz);
        local = `${weekday(z.weekday)} ${hm(z.hour * 60 + z.minute)}`;
      }
      const state = !person ? 'none' : (mask & person.bit) ? 'free' : 'busy';
      return h('div', { class: `tip-row ${memberClass(m.index)} ${state}` },
        h('i', { class: 'tip-key' }),
        h('span', { class: 'tip-name' }, m.name),
        h('span', { class: 'tip-local' }, local),
        h('span', { class: 'tip-state' },
          state === 'free' ? t('p.tipFree') : state === 'busy' ? t('p.tipBusy') : t('p.tipNotFilled')));
    });
    showTooltip(h('div', { class: 'tip' },
      h('div', { class: 'tip-head' },
        `${weekday(day)} ${monthDay(date.month, date.day)} · ${hm(slot * SLOT)}–${hm(slot * SLOT + SLOT)} · ${cityName(data.tz)}`),
      h('div', { class: 'tip-count' }, t('p.tipCount', { n: popcount(mask), total: who.length })),
      rows), x, y);
  }

  // -- best times

  function renderBest() {
    const data = s.overlap;
    const total = invitees().length;
    const who = people();
    const filledCount = who.filter(person => Object.values(person.weeks).some(ranges => ranges.length)).length;
    const head = h('div', { class: 'best-head' },
      h('h3', { class: 'panel-title' }, tr('Suggested times')),
      h('span', {}, `${duration(s.project.duration)} · ${cityName(data.tz)}`));

    if (!filledCount) {
      fill(bestBox, head, h('p', { class: 'best-empty' }, tr('Save availability to see suggested meeting times.')));
      return;
    }
    const cacheKey = JSON.stringify([who, data.tz, s.project.duration, Math.floor(serverNow() / 30000)],
      (_, value) => typeof value === 'bigint' ? String(value) : value);
    if (cacheKey !== s.bestCacheKey) {
      s.bestCache = suggestedTimes(who, data.tz, s.project.duration, serverNow());
      s.bestCacheKey = cacheKey;
    }
    const windows = s.bestCache.filter(window => window.startMs >= serverNow());
    const shown = windows.slice(0, s.bestLimit);
    fill(bestBox,
      head,
      !windows.length ? h('p', { class: 'best-empty' }, tr('No future time fits this meeting in the saved availability.')) : null,
      shown.length ? h('ol', { class: 'best-list' }, shown.map(w => bestItem(w, w.data, total))) : null,
      windows.length > shown.length ? h('button', {
        class: 'btn btn-ghost btn-sm best-toggle', type: 'button',
        onclick: () => { s.bestLimit += 30; renderBest(); },
      }, `${t('p.more')} (${windows.length - shown.length})`) : null,
      s.bestLimit > BEST_SHOWN ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => { s.bestLimit = BEST_SHOWN; renderBest(); } }, t('p.less')) : null);
  }

  function bestItem(w, data, total) {
    const startMs = data.instants[w.start];
    const endMs = startMs + s.project.duration * 60000;
    const free = data.people.filter(p => w.group & p.bit);
    const missing = invitees().filter(m => !free.some(p => p.member.key === m.key));
    return h('li', { class: `best-item${w.count === total ? ' all' : ''}` },
      h('div', { class: 'best-top' },
        h('i', { class: `sw rp-${rampStep(w.count, total)}` }),
        h('span', { class: 'best-time' }, cellRange(startMs, endMs, data.tz)),
        h('span', { class: 'best-len' }, duration(s.project.duration)),
        h('span', { class: `best-count${w.count === total ? ' all' : ''}` },
          w.count === total ? t('p.bestEveryone') : t('p.bestCount', { n: w.count, total })),
        h('button', {
          class: 'btn btn-sm best-pick', type: 'button', disabled: !clockReady(), onclick: () => {
            s.tab = 'overlap';
            s.viewTz = data.tz;
            s.weekStart = data.monday;
            if (loadEditorWeek()) renderEditor();
            s.selectedStart = startMs;
            renderChart();
            openSelected();
          },
        }, t('d.pick'))),
      h('div', { class: 'best-locals' }, free.map(p => h('span', { class: `best-local ${memberClass(p.member.index)}` },
        h('i', { class: 'tip-key' }), h('b', {}, p.member.name), localRange(startMs, endMs, p.tz)))),
      missing.length ? h('div', { class: 'best-missing' }, t('p.bestMissing', { names: missing.map(m => m.name).join(', ') })) : null);
  }

  // Year and both dates remain explicit when a meeting crosses midnight.
  function cellRange(startMs, endMs, tz) {
    const start = zonedParts(startMs, tz);
    const end = zonedParts(endMs, tz);
    const dateLabel = date => `${weekday(date.weekday)}, ${monthDay(date.month, date.day)} ${date.year}`;
    const from = hm(start.hour * 60 + start.minute);
    const to = hm(end.hour * 60 + end.minute);
    if (sameDate(start, end)) return `${dateLabel(start)} · ${from}–${to}`;
    return `${dateLabel(start)} ${from} – ${dateLabel(end)} ${to}`;
  }

  function errorState(err) {
    const notFound = err.status === 404;
    return h('div', { class: 'error-state' },
      h('p', {}, notFound ? t('meeting.notFound') : t('common.error', { msg: errorText(err) })),
      h('a', { class: 'btn', href: parentRoute() }, icon('arrowLeft'), t(s.project?.workspaceId ? 'flow.backProject' : 'flow.backMeetings')));
  }

  function stopTimers() {
    clearInterval(pollTimer);
    unsubscribeClock();
  }

  return {
    el,
    async guard() {
      if (!s.dirty) return true;
      return confirmDialog({ title: t('p.unsaved'), message: t('p.leaveConfirm'), confirmText: t('p.leave'), danger: true });
    },
    onMeChanged() {
      if (!s.project) return;
      renderOverview();
      renderEditor();
      renderFuture();
    },
    destroy() {
      destroyed = true;
      stopTimers();
      grid.destroy();
      hideTooltip();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
    },
  };
}
