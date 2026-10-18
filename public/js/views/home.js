import { tr, dateLocale } from '../locale.js';
import { fill, h, icon } from '../dom.js';
import { api, errorText } from '../api.js';
import { duration } from '../i18n.js';
import { nextOccurrence } from '../meeting.js';
import { detectTimeZone } from '../tz.js';
import { avatar, openModal, meetingForm, toast } from '../ui.js';
import { now as serverNow } from '../time.js';

export function statusMark(kind) {
  return h('span', { class: `mark mark-${kind}` }, h('i', { class: 'mark-glyph' }), kind === 'upcoming' ? tr('Scheduled') : kind === 'past' ? tr('Past') : tr('Unscheduled'));
}
export function meetingRow(p, ctx, { showProject = false } = {}) {
  const occurrence = nextOccurrence(p.schedule, p.duration);
  const kind = !occurrence ? 'pending' : occurrence.past ? 'past' : 'upcoming';
  const tz = ctx.me.tz || detectTimeZone();
  const when = occurrence ? new Intl.DateTimeFormat(dateLocale(), { timeZone: tz, month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(occurrence.start) : tr('Awaiting availability');
  const workspace = ctx.workspaces.find(w => w.id === p.workspaceId);
  return h('a', { class: 'meeting-row', href: `#/m/${p.id}` },
    h('span', { class: `meeting-icon ${kind}` }, icon(occurrence ? 'calendar' : 'clock', 20)),
    h('div', { class: 'meeting-row-main' }, h('h3', {}, p.title), h('p', {}, showProject && workspace ? `${workspace.title} · ` : '', when)),
    h('div', { class: 'meeting-row-meta' }, h('span', {}, duration(p.duration)), h('span', {}, tr("{v0} participant{v1}", {v0: p.invitees.length, v1: p.invitees.length === 1 ? '' : 's'}))), statusMark(kind), icon('chevronRight', 17));
}
export function HomeView(ctx, mode = 'overview') {
  let meetings = [], workspaces = [], loaded = false, destroyed = false, query = '', filter = 'all';
  const el = h('div', { class: `workspace-page home-page mode-${mode}` });
  load();
  async function load() {
    try {
      await ctx.refresh();
      const data = await api.projects();
      if (destroyed) return;
      meetings = data.projects; workspaces = ctx.workspaces; loaded = true; render();
    } catch (err) { if (!destroyed) fill(el, h('div', { class: 'error-state' }, h('p', {}, errorText(err)), h('button', { class: 'btn', onclick: load }, tr('Retry')))); }
  }
  fill(el, h('div', { class: 'page-loading' }, tr('Loading workspace…')));
  function createMeeting() {
    if (!workspaces.length) { ctx.newWorkspace(); return; }
    if (workspaces.length === 1) { launchMeeting(workspaces[0]); return; }
    const picker = openModal({ title: tr('Select a project'), body: h('div', { class: 'project-picker' }, workspaces.map(w => h('button', { class: 'project-picker-item', type: 'button', onclick: () => { picker.close(); launchMeeting(w); } }, icon('folder', 18), w.title, icon('arrowRight', 16)))) });
  }
  async function launchMeeting(workspace) {
    try {
      const data = await api.workspace(workspace.id);
      if (destroyed) return;
      meetingForm({ ctx: { ...ctx, members: data.members }, title: tr('Create meeting'), submitText: tr('Create meeting'), onSubmit: async values => {
        const { project } = await api.createProject({ ...values, workspaceId: workspace.id });
        ctx.navigate(`#/m/${project.id}`); toast(tr('Meeting created'), 'success');
      }});
    } catch (err) { toast(errorText(err), 'error'); }
  }
  function render() {
    if (!loaded) return;
    const now = serverNow();
    const scheduled = meetings.filter(m => { const n = nextOccurrence(m.schedule, m.duration, now); return n && !n.past; });
    const pending = meetings.filter(m => !m.schedule && !m.filled.includes(ctx.me.key));
    const heading = mode === 'meetings' ? tr('Meetings') : mode === 'projects' ? tr('Projects') : tr('Overview');
    const header = h('header', { class: 'workspace-heading' }, h('div', {}, h('h1', {}, heading)),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: mode === 'meetings' ? createMeeting : () => ctx.newWorkspace() }, icon('plus', 17), mode === 'meetings' ? tr('Create meeting') : tr('Create project')));
    const stats = h('div', { class: 'workspace-stats' },
      stat('folder', tr('Projects'), workspaces.length, tr('Projects you belong to'), '#/projects'),
      stat('calendar', tr('Upcoming meetings'), scheduled.length, tr('Meetings with a confirmed time'), '#/meetings'),
      stat('clock', tr('Availability needed'), pending.length, pending.length ? tr('Add your availability to these meetings') : tr('No availability requests'), '#/meetings'));
    if (mode === 'meetings') { fill(el, header, meetingSection()); return; }
    const list = projectSection();
    if (mode === 'projects') { fill(el, header, list); return; }
    const next = scheduled.sort((a, b) => nextOccurrence(a.schedule, a.duration).start - nextOccurrence(b.schedule, b.duration).start).slice(0, 3);
    const rail = h('aside', { class: 'dashboard-rail' }, h('section', { class: 'rail-panel' }, h('div', { class: 'block-title' }, h('h2', {}, tr('Upcoming meetings')), icon('calendar', 17)), next.length ? next.map(m => meetingRow(m, ctx)) : h('div', { class: 'rail-empty' }, h('span', { class: 'empty-icon small' }, icon('calendar', 25)), h('strong', {}, tr('No upcoming meetings')), h('p', {}, tr('Scheduled meetings will appear here.')))));
    fill(el, header, stats, !workspaces.length ? welcome() : null, h('div', { class: 'dashboard-columns' }, list, rail));
  }
  function stat(glyph, label, value, caption, href) {
    return h('a', { class: 'stat-card', href }, h('div', { class: 'stat-top' }, h('span', {}, label), icon(glyph, 18)), h('strong', {}, String(value).padStart(2, '0')), h('p', {}, caption));
  }
  function welcome() {
    return h('section', { class: 'welcome-panel' }, h('div', { class: 'welcome-copy' }, h('h2', {}, tr('Get started')), h('p', {}, tr('Create a project to organize members and meetings.'))),
      h('div', { class: 'welcome-steps' }, [['01', tr('Create a project'), tr('Add a name and description'), 'folder'], ['02', tr('Invite members'), tr('Add names or share an invite link'), 'users'], ['03', tr('Schedule a meeting'), tr('Collect availability and confirm a time'), 'calendar']].map(([n, title, desc, glyph]) => h('div', { class: 'welcome-step' }, h('span', { class: 'welcome-step-icon' }, icon(glyph, 19)), h('small', {}, n), h('strong', {}, title), h('p', {}, desc)))));
  }
  function projectSection() {
    const grid = h('div', { class: 'project-grid' });
    const search = h('input', { class: 'input', type: 'search', placeholder: tr('Search projects…'), 'aria-label': tr('Search projects'), value: query, oninput: e => { query = e.target.value; draw(); } });
    const section = h('section', { class: 'projects-section' }, h('div', { class: 'block-title' }, h('h2', {}, tr('Projects'), h('span', { class: 'counter' }, workspaces.length)), workspaces.length ? h('div', { class: 'search-field' }, icon('search', 15), search) : null), grid);
    function draw() {
      const shown = workspaces.filter(w => w.title.toLowerCase().includes(query.toLowerCase()));
      if (!workspaces.length) { fill(grid, h('div', { class: 'project-empty' }, h('span', { class: 'empty-icon' }, icon('folder', 28)), h('h3', {}, tr('No projects yet')), h('p', {}, tr('Create a project or join one using an invite link.')), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.newWorkspace() }, icon('plus', 16), tr('Create project')))); return; }
      fill(grid, shown.length ? shown.map(w => {
        const meetingCount = meetings.filter(m => m.workspaceId === w.id).length;
        return h('a', { class: 'project-card', href: `#/w/${w.id}`, style: { '--project-color': w.color } }, h('div', { class: 'project-card-top' }, h('span', { class: 'project-symbol' }, icon('folder', 22)), icon('arrowRight', 17)), h('h3', {}, w.title), h('p', {}, w.description || tr('No description')), h('div', { class: 'project-card-bottom' }, h('div', { class: 'avatar-stack' }, w.members.slice(0, 3).map(key => avatar(ctx.members.find(m => m.key === key) || { name: ctx.nameOf(key), index: 0 }, { size: 'sm' })), h('span', {}, tr("{v0} member{v1}", {v0: w.members.length, v1: w.members.length === 1 ? '' : 's'}))), h('span', {}, icon('video', 14), tr("{v0} meeting{v1}", {v0: meetingCount, v1: meetingCount === 1 ? '' : 's'}))));
      }) : h('div', { class: 'search-empty' }, tr('No matching projects.')));
    }
    draw(); return section;
  }
  function meetingSection() {
    const list = h('div', { class: 'meeting-list' });
    const controls = h('div', { class: 'filter-tabs', role: 'group', 'aria-label': tr('Filter meetings') });
    const draw = () => {
      fill(controls, [['all', tr('All meetings')], ['upcoming', tr('Scheduled')], ['pending', tr('Unscheduled')], ['past', tr('Past')]].map(([id, title]) => h('button', { class: `filter-tab${filter === id ? ' active' : ''}`, type: 'button', 'aria-pressed': filter === id ? 'true' : 'false', onclick: () => { filter = id; draw(); } }, title)));
      const shown = meetings.filter(m => { const n = nextOccurrence(m.schedule, m.duration); const k = !n ? 'pending' : n.past ? 'past' : 'upcoming'; return filter === 'all' || filter === k; });
      fill(list, shown.length ? shown.map(m => meetingRow(m, ctx, { showProject: true })) : h('div', { class: 'project-empty' }, h('span', { class: 'empty-icon' }, icon('calendar', 28)), h('h3', {}, meetings.length ? tr('No matching meetings') : tr('No meetings yet')), h('p', {}, meetings.length ? tr('Select another filter to view meetings.') : tr('Create a meeting in a project to collect availability.')), !meetings.length ? h('button', { class: 'btn btn-primary', type: 'button', onclick: createMeeting }, icon('plus'), workspaces.length ? tr('Create meeting') : tr('Create project')) : null));
    };
    draw(); return h('section', { class: 'meetings-section' }, controls, list);
  }
  return { el, onMeChanged: render, destroy: () => { destroyed = true; } };
}
