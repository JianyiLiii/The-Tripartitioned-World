import { tr } from '../locale.js';
import { h, fill, icon } from '../dom.js';
import { api, errorText } from '../api.js';
import { avatar, meetingForm, workspaceForm, workspaceInviteDialog, toast } from '../ui.js';
import { cityName } from '../tz.js';
import { nextOccurrence } from '../meeting.js';
import { meetingRow } from './home.js';

export function WorkspaceView(ctx, id) {
  let data, tab = 'meetings', filter = 'all', destroyed = false;
  const el = h('div', { class: 'workspace-page project-page' }, h('div', { class: 'page-loading' }, tr('Loading project…')));
  load();
  const timer = setInterval(() => { if (!document.hidden && !document.querySelector('.overlay')) load(true); }, 15000);
  async function load(quiet = false) {
    try {
      const result = await api.workspace(id);
      if (destroyed) return;
      data = result;
      const profiles = new Map(ctx.members.map(m => [m.key, m]));
      data.members.forEach(m => profiles.set(m.key, m)); ctx.members = [...profiles.values()];
      render();
    } catch (err) {
      if (destroyed || quiet) return;
      fill(el, h('div', { class: 'error-state' }, h('h2', {}, err.status === 404 ? tr('Project unavailable') : tr('Unable to load project')), h('p', {}, err.status === 404 ? tr('Join using an invite link or return to your projects.') : errorText(err)), h('a', { class: 'btn', href: '#/projects' }, tr('Back to projects'))));
    }
  }
  function invite() {
    workspaceInviteDialog({ workspace: data.workspace, onInvite: async names => {
      await api.updateWorkspace(id, { inviteNames: names }); await ctx.refresh(); await load();
    }});
  }
  async function newMeeting() {
    try {
      const current = await api.workspace(id);
      if (destroyed) return;
      data = current;
      meetingForm({ ctx: { ...ctx, members: data.members }, title: tr('Create meeting'), submitText: tr('Create meeting'), onSubmit: async values => {
        const { project } = await api.createProject({ ...values, workspaceId: id });
        ctx.navigate(`#/m/${project.id}`); toast(tr('Meeting created. Add your availability.'), 'success');
      }});
    } catch (err) { toast(errorText(err), 'error'); }
  }
  function render() {
    const w = data.workspace;
    const head = h('header', { class: 'project-heading' }, h('a', { class: 'back-link', href: '#/projects' }, icon('arrowLeft', 15), tr('All projects')),
      h('div', { class: 'project-title-row' }, h('span', { class: 'project-symbol large', style: { '--project-color': w.color } }, icon('folder', 29)), h('div', { class: 'project-title-copy' }, h('div', { class: 'page-kicker' }, 'PROJECT'), h('h1', {}, w.title), w.description ? h('p', {}, w.description) : null),
        h('div', { class: 'project-heading-actions' }, w.owner === ctx.me.key ? h('button', { class: 'btn-icon', type: 'button', title: tr('Edit project'), 'aria-label': tr('Edit project'), onclick: () => workspaceForm({ initial: w, onSubmit: async values => { await api.updateWorkspace(id, values); await ctx.refresh(); await load(); toast(tr('Project updated'), 'success'); } }) }, icon('pencil', 17)) : null,
          h('button', { class: 'btn', type: 'button', onclick: invite }, icon('users', 16), tr('Invite members')), h('button', { class: 'btn btn-primary', type: 'button', onclick: newMeeting }, icon('plus', 17), tr('Create meeting'))))),
      meta = h('div', { class: 'project-meta' }, h('div', { class: 'avatar-stack' }, data.members.slice(0, 5).map(m => avatar(m, { size: 'sm' }))), h('span', {}, tr("{v0} member{v1}", {v0: w.members.length, v1: w.members.length === 1 ? '' : 's'})), h('span', { class: 'footer-dot' }), h('span', {}, tr("{v0} visible meeting{v1}", {v0: data.meetings.length, v1: data.meetings.length === 1 ? '' : 's'})), h('span', { class: 'project-owner' }, tr("Created by {v0}", {v0: ctx.nameOf(w.owner)})));
    const tabs = h('div', { class: 'project-tabs', role: 'group', 'aria-label': tr('Project content') }, [['meetings', tr('Meetings'), 'video', data.meetings.length], ['members', tr('Members'), 'users', w.members.length]].map(([key, title, glyph, count]) => h('button', { class: `project-tab${tab === key ? ' active' : ''}`, type: 'button', 'aria-pressed': tab === key ? 'true' : 'false', onclick: () => { tab = key; render(); } }, icon(glyph, 17), title, h('span', { class: 'counter' }, count))));
    fill(el, head, meta, tabs, tab === 'members' ? memberList() : meetingList());
  }
  function memberList() {
    return h('section', { class: 'members-section' }, h('div', { class: 'block-title' }, h('div', {}, h('h2', {}, tr('Members')), h('p', {}, tr('Project members can create meetings and choose participants for each meeting.'))), h('button', { class: 'btn', type: 'button', onclick: invite }, icon('plus', 16), tr('Add members'))),
      h('div', { class: 'member-grid' }, data.members.map(m => h('div', { class: 'member-card' }, avatar(m), h('div', {}, h('strong', {}, m.name, m.key === ctx.me.key ? h('span', { class: 'tag' }, tr('You')) : null), h('p', {}, m.tz ? cityName(m.tz) : tr('Time zone not set'))), h('span', { class: 'member-role' }, m.key === data.workspace.owner ? tr('Owner') : tr('Member'))))));
  }
  function meetingList() {
    const list = data.meetings.filter(m => {
      const n = nextOccurrence(m.schedule, m.duration);
      return filter === 'all' || (filter === 'pending' ? !n : filter === 'upcoming' ? n && !n.past : n?.past);
    });
    const filters = h('div', { class: 'filter-tabs', role: 'group', 'aria-label': tr('Filter project meetings') }, [['all', tr('All meetings')], ['pending', tr('Unscheduled')], ['upcoming', tr('Scheduled')], ['past', tr('Past')]].map(([key, label]) => h('button', { class: `filter-tab${filter === key ? ' active' : ''}`, type: 'button', 'aria-pressed': filter === key ? 'true' : 'false', onclick: () => { filter = key; render(); } }, label)));
    if (!data.meetings.length) return h('section', { class: 'project-first-meeting' },
      data.members.length === 1 ? h('div', { class: 'project-next-step' }, h('span', { class: 'next-step-icon' }, icon('users', 22)), h('div', {}, h('strong', {}, tr('Invite project members')), h('p', {}, tr('Add people by name or share an invite link.'))), h('button', { class: 'btn btn-sm', type: 'button', onclick: invite }, tr('Invite members'), icon('arrowRight', 14))) : null,
      h('div', { class: 'project-empty meeting-empty' }, h('span', { class: 'empty-icon' }, icon('video', 30)), h('h2', {}, tr('No meetings yet')), h('p', {}, tr('Create a meeting or ask a member to add you to an existing one.')), h('button', { class: 'btn btn-primary', type: 'button', onclick: newMeeting }, icon('plus', 16), tr('Create meeting')), h('small', {}, tr('You can add participants and confirm the time later.'))));
    return h('section', { class: 'meetings-section' }, filters, h('div', { class: 'meeting-list' }, list.length ? list.map(m => meetingRow(m, ctx)) : h('div', { class: 'search-empty' }, tr('No matching meetings.'))));
  }
  return { el, onMeChanged: () => {
    if (!data) return;
    data.members = data.members.map(m => m.key === ctx.me.key ? ctx.me : m);
    render();
  }, destroy: () => { destroyed = true; clearInterval(timer); } };
}

export function InviteView(ctx, code) {
  let destroyed = false;
  const el = h('div', { class: 'invite-page' }, h('div', { class: 'page-loading' }, tr('Loading invitation…')));
  api.invite(code).then(data => {
    if (destroyed) return;
    const error = h('p', { class: 'form-error', role: 'alert' });
    const joined = ctx.workspaces.some(w => w.id === data.workspace.id);
    const button = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: async () => {
      button.disabled = true;
      try { const { workspace } = await api.joinWorkspace(code); await ctx.refresh(); ctx.navigate(`#/w/${workspace.id}`); toast(tr('Project joined'), 'success'); }
      catch (err) { error.textContent = errorText(err); button.disabled = false; }
    } }, joined ? tr('Open project') : tr('Join project'), icon('arrowRight', 17));
    fill(el, h('div', { class: 'invite-landing' }, h('span', { class: 'empty-icon' }, icon('users', 30)), h('h1', {}, tr('Project invitation')), h('p', {}, tr("You have been invited to {v0}.", {v0: data.workspace.title})), data.workspace.description ? h('p', { class: 'invite-description' }, data.workspace.description) : null, h('div', { class: 'invite-identity' }, avatar(ctx.me), h('span', {}, tr("Joining as {v0} · {v1} member{v2}", {v0: ctx.me.name, v1: data.memberCount, v2: data.memberCount === 1 ? '' : 's'}))), error, button, h('a', { class: 'text-link', href: '#/' }, tr('Back to overview'))));
  }).catch(err => { if (!destroyed) fill(el, h('div', { class: 'error-state' }, h('h2', {}, tr('Invitation unavailable')), h('p', {}, err.status === 404 ? tr('Ask a project member for a new invite link.') : errorText(err)), h('a', { class: 'btn', href: '#/' }, tr('Back to overview')))); });
  return { el, destroy: () => { destroyed = true; } };
}
