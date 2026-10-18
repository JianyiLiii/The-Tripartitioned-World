import { tr, getLanguage, setLanguage, dateLocale } from './locale.js';
import { h, icon } from './dom.js';
import { api, ApiError, errorText, setUnauthorizedHandler } from './api.js';
import { cityName, clock, detectTimeZone, isValidTimeZone } from './tz.js';
import { avatar, openMenu, pickTimeZone, toast, workspaceForm } from './ui.js';
import { LoginView } from './views/login.js';
import { HomeView } from './views/home.js';
import { WorkspaceView, InviteView } from './views/workspace.js';
import { ProjectView } from './views/project.js';
import { brandLink } from './brand.js';
import { DemoView } from './views/demo.js';
import { PasswordSetupView, changePasswordDialog } from './views/password.js';
import { editProfileDialog, addUsersDialog, manageUsersDialog, manageAdminsDialog } from './views/profile.js';
import { now, startClock, subscribeClock, syncClock } from './time.js';

const root = document.getElementById('app');
document.documentElement.lang = getLanguage() === 'zh' ? 'zh-CN' : 'en';
document.title = tr('The Tripartitioned World');
function languageButton() {
  return h('button', { class: 'btn btn-sm language-switch', type: 'button',
    lang: getLanguage() === 'zh' ? 'en' : 'zh-CN',
    'aria-label': getLanguage() === 'zh' ? 'Switch to English' : '切换为中文',
    onclick: async () => {
      if (view?.guard && !(await view.guard())) return;
      setLanguage(getLanguage() === 'zh' ? 'en' : 'zh');
      view?.destroy?.(); location.reload();
    } }, getLanguage() === 'zh' ? 'English' : '中文');
}
let view, sidebar, bar, main, timer, shownHash, ignoreHash = false, showingLogin = false;
const ctx = {
  me: null, members: [], workspaces: [], config: null,
  nameOf(key) { return this.members.find(m => m.key === key)?.name || key; },
  navigate(hash) { location.hash = hash; },
  async refresh() {
    const identity = await api.me();
    this.me = identity.user; this.members = identity.members || [];
    if (this.me.mustChangePassword) { this.workspaces = []; return; }
    this.workspaces = (await api.workspaces()).workspaces;
    renderShell();
  },
  async setMyTimeZone(tz) {
    this.me = (await api.setTimeZone(tz)).user;
    this.members = this.members.map(m => m.key === this.me.key ? this.me : m);
    renderShell(); view?.onMeChanged?.(); return this.me;
  },
  newWorkspace() {
    workspaceForm({ onSubmit: async values => {
      const { workspace } = await api.createWorkspace(values);
      await ctx.refresh(); ctx.navigate(`#/w/${workspace.id}`);
      toast(tr('Project created'), 'success');
    }});
  },
};
setUnauthorizedHandler(showLogin);
window.addEventListener('hashchange', async () => {
  if (ignoreHash) { ignoreHash = false; return; }
  if (!ctx.me) { showingLogin = false; showLogin(); return; }
  if (view?.guard && !(await view.guard())) { ignoreHash = true; location.hash = shownHash || '#/'; return; }
  route();
});
boot();

async function boot() {
  try {
    const config = await api.config();
    if (!['local', 'restricted'].includes(config?.authMode) || !['local', 'cloud'].includes(config?.hosting)) throw new ApiError(0, 'invalid_config');
    ctx.config = config;
  } catch (err) { fatal(err); return; }
  try { await syncClock(); startClock(); subscribeClock(renderClock); }
  catch { fatal(new ApiError(0, 'time_unavailable')); return; }
  try { await enterWorkspace(); }
  catch (err) { if (err.status === 401) showLogin(); else fatal(err); }
}
async function enterWorkspace() {
  await ctx.refresh();
  if (!ctx.me.mustChangePassword) await rememberZone();
  route();
}
async function rememberZone() {
  if (!ctx.me.tz) { try { await ctx.setMyTimeZone(detectTimeZone()); } catch { /* retry next visit */ } }
}
function route() {
  if (ctx.me?.mustChangePassword) { showPasswordSetup(); return; }
  view?.destroy?.(); showingLogin = false; document.body.classList.remove('is-login');
  if (!main?.isConnected) {
    sidebar = h('aside', { class: 'sidebar', 'aria-label': tr('Main navigation') });
    bar = h('header', { class: 'app-topbar' });
    main = h('main', { class: 'app-main', id: 'main-content', tabindex: '-1' });
    root.replaceChildren(h('a', { class: 'skip-link', href: '#main-content', onclick: e => { e.preventDefault(); main.focus(); } }, tr('Skip to content')), sidebar, h('div', { class: 'app-body' }, bar, main));
    clearInterval(timer); timer = setInterval(renderClock, 30000);
  }
  shownHash = location.hash || '#/';
  const path = shownHash.match(/^#\/(w|m|p|invite)\/([A-Za-z0-9_-]+)$/);
  if (shownHash === '#/preview') view = DemoView(ctx);
  else if (path?.[1] === 'w') view = WorkspaceView(ctx, path[2]);
  else if (path?.[1] === 'invite') view = InviteView(ctx, path[2]);
  else if (path) view = ProjectView(ctx, path[2]);
  else view = HomeView(ctx, shownHash === '#/meetings' ? 'meetings' : shownHash === '#/projects' ? 'projects' : 'overview');
  main.replaceChildren(view.el); renderShell(); window.scrollTo(0, 0);
}
function renderShell() {
  if (!ctx.me || ctx.me.mustChangePassword || !sidebar?.isConnected) return;
  const hash = location.hash || '#/';
  const navItem = (href, glyph, title) => h('a', { href, class: `nav-item${hash === href ? ' active' : ''}`, 'aria-current': hash === href ? 'page' : null }, icon(glyph, 18), title);
  sidebar.replaceChildren(
    brandLink(),
    h('nav', { class: 'main-nav' }, navItem('#/', 'grid', tr('Overview')), navItem('#/projects', 'folder', tr('Projects')), navItem('#/meetings', 'calendar', tr('Meetings')), navItem('#/preview', 'layers', tr('Availability preview'))),
    h('div', { class: 'side-section-title' }, tr('Your projects'), h('button', { class: 'btn-icon', type: 'button', 'aria-label': tr('New project'), onclick: () => ctx.newWorkspace() }, icon('plus', 15))),
    h('nav', { class: 'project-nav', 'aria-label': tr('Project list') }, ctx.workspaces.length ? ctx.workspaces.map(w => h('a', { class: `nav-item${hash === `#/w/${w.id}` ? ' active' : ''}`, href: `#/w/${w.id}` }, h('span', { class: 'project-dot', style: { '--project-color': w.color || '#4f6ef7' } }), h('span', { class: 'truncate' }, w.title))) : h('p', { class: 'side-empty' }, tr('No projects yet.'))),
    h('div', { class: 'sidebar-bottom' },
      h('div', { class: 'local-card' }, h('span', { class: 'local-indicator' }), h('div', {}, h('strong', {}, ctx.config.hosting === 'cloud' || ctx.config.authMode === 'restricted' ? tr('Private workspace') : tr('Local workspace')), h('p', {}, ctx.config.hosting === 'cloud' || ctx.config.authMode === 'restricted' ? tr('Access approved by administrator') : tr('Data stored on this computer')))),
      h('button', { class: 'profile-button', type: 'button', onclick: e => openMenu(e.currentTarget, [
        ...(ctx.me.canManageAdmins ? [{ label: tr('Manage administrators'), icon: 'users', onClick: () => manageAdminsDialog({ onChanged: async () => {
          await ctx.refresh(); view?.onMeChanged?.();
        } }) }] : []),
        ...(ctx.me.canAddUsers ? [{ label: tr('Add users'), icon: 'users', onClick: () => addUsersDialog({ onAdded: async () => {
          await ctx.refresh(); view?.onMeChanged?.();
        } }) }, { label: tr('Manage team'), icon: 'users', onClick: () => manageUsersDialog({ onChanged: async () => {
          await ctx.refresh(); view?.onMeChanged?.();
        } }) }] : []),
        { label: tr('Edit profile'), icon: 'pencil', onClick: () => editProfileDialog({ user: ctx.me, onChanged: user => {
          ctx.me = user; ctx.members = ctx.members.map(m => m.key === user.key ? user : m);
          renderShell(); view?.onMeChanged?.();
        } }) },
        ...(ctx.config.authMode === 'restricted' ? [{ label: tr('Change password'), icon: 'pencil', onClick: () => changePasswordDialog({ name: ctx.me.name, onChanged: user => { ctx.me = user; renderShell(); } }) }] : []),
        { label: tr('Switch user'), icon: 'logOut', onClick: signOut },
      ]) }, avatar(ctx.me), h('span', {}, h('strong', {}, ctx.me.name), h('small', {}, tr('Signed in'))), icon('chevronDown', 15))));
  const current = ctx.workspaces.find(w => hash === `#/w/${w.id}`);
  const title = current?.title || (hash === '#/preview' ? tr('Availability preview') : hash === '#/meetings' ? tr('Meetings') : hash === '#/projects' ? tr('Projects') : /^#\/(m|p)\//.test(hash) ? tr('Meeting details') : hash.startsWith('#/invite/') ? tr('Project invitation') : tr('Overview'));
  bar.replaceChildren(h('div', { class: 'breadcrumbs' }, icon('layers', 17), h('span', {}, tr('Workspace')), icon('chevronRight', 13), h('strong', {}, title)), h('button', { class: 'timezone-button', type: 'button', onclick: changeZone, 'aria-label': tr('Change your time zone') }, icon('globe', 16), h('span', { id: 'shell-clock' })));
  renderClock();
  bar.append(languageButton());
}
function renderClock() {
  const el = document.getElementById('shell-clock');
  if (el && ctx.me) {
    const tz = isValidTimeZone(ctx.me.tz) ? ctx.me.tz : detectTimeZone();
    const date = new Intl.DateTimeFormat(dateLocale(), { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(now());
    el.textContent = `${cityName(tz)} · ${date} · ${clock(tz, now())}`;
    el.title = tr('Date and time synced with the server');
  }
}
async function changeZone() {
  const tz = await pickTimeZone({ current: ctx.me.tz });
  if (tz && tz !== ctx.me.tz) { try { await ctx.setMyTimeZone(tz); toast(tr('Time zone updated'), 'success'); } catch (err) { toast(errorText(err), 'error'); } }
}
async function signOut() {
  if (view?.guard && !(await view.guard())) return;
  try {
    await api.logout();
    if (!location.hash.startsWith('#/invite/')) history.replaceState(null, '', '#/');
    showLogin();
  } catch (err) { toast(errorText(err), 'error'); }
}
function showLogin() {
  if (showingLogin || !ctx.config) return;
  showingLogin = true; view?.destroy?.(); view = null; ctx.me = null; clearInterval(timer);
  document.body.classList.add('is-login');
  const login = LoginView({ config: ctx.config, onSignedIn: enterWorkspace });
  root.replaceChildren(login.el, h('div', { class: 'entry-language' }, languageButton())); login.focus();
}
function showPasswordSetup() {
  view?.destroy?.(); showingLogin = false; clearInterval(timer);
  document.body.classList.add('is-login');
  view = PasswordSetupView({ name: ctx.me.name, onChanged: enterWorkspace, onSignOut: signOut });
  root.replaceChildren(view.el, h('div', { class: 'entry-language' }, languageButton())); view.focus();
}
function fatal(err) {
  document.body.append(h('div', { class: 'entry-language' }, languageButton()));
  root.replaceChildren(h('div', { class: 'error-state fatal' }, h('h1', {}, tr('Unable to load workspace')), h('p', {}, errorText(err)), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, tr('Try again'))));
}
