import { tr } from '../locale.js';
import { h, icon } from '../dom.js';
import { api, errorText } from '../api.js';
import { brandLink } from '../brand.js';

export function LoginView({ onSignedIn, config }) {
  const restricted = config.authMode === 'restricted';
  const cloud = config.hosting === 'cloud';
  const code = location.hash.match(/^#\/invite\/([A-Za-z0-9_-]+)$/)?.[1];
  let lastName = '';
  try { lastName = localStorage.getItem('overlap.name') || ''; } catch { /* optional */ }
  const input = h('input', { class: 'input login-input', id: 'login-name', name: 'name', maxlength: '80', autocomplete: restricted ? 'username' : 'name', placeholder: tr('Enter your name'), value: lastName, required: true, 'aria-describedby': 'login-hint' });
  const passwordInput = restricted ? h('input', { class: 'input login-input', id: 'login-password', name: 'password', type: 'password', inputmode: 'numeric', maxlength: '6', minlength: '6', pattern: '[0-9]{6}', autocomplete: 'current-password', placeholder: tr('Enter your six-digit password'), required: true, 'aria-describedby': 'login-hint' }) : null;
  const error = h('p', { class: 'form-error', role: 'alert' });
  const inviteNote = h('div', { class: 'login-invite', hidden: !code });
  const button = h('button', { class: 'btn btn-primary btn-lg login-submit', type: 'submit' }, code ? tr('Continue to invitation') : tr('Sign in'), icon('arrowRight', 18));
  const form = h('form', { class: 'entry-form', novalidate: true, onsubmit: submit },
    h('h1', {}, tr('Sign in')),
    h('p', { class: 'entry-description' }, tr('Access your projects and meetings.')),
    inviteNote,
    h('label', { class: 'field-label', for: 'login-name' }, tr('Your name')), input,
    restricted ? h('label', { class: 'field-label', for: 'login-password', style: { 'margin-top': '18px' } }, tr('Password')) : null, passwordInput,
    h('p', { class: 'field-hint', id: 'login-hint' }, restricted ? tr('Use your current username and six-digit password. You stay signed in on this device for 30 days.') : tr('Use your current username to return to your profile.')), error, button,
    h('div', { class: 'entry-note' }, icon('monitor', 15), cloud ? tr('Cloud workspace · Access by approval') : restricted ? tr('Private workspace · Access by approval') : tr('Local mode · No password required')));
  const illustration = h('div', { class: 'entry-art', 'aria-hidden': 'true' },
    h('div', { class: 'art-orbit orbit-one' }), h('div', { class: 'art-orbit orbit-two' }),
    h('div', { class: 'art-float art-float-one' }, h('span', { class: 'art-avatar tone-0' }, 'J'), h('span', {}, tr('Availability saved')), icon('check', 14)),
    h('div', { class: 'art-meeting' }, h('div', { class: 'art-card-top' }, h('span', { class: 'art-app-icon' }, icon('video', 20)), h('span', { class: 'soft-badge' }, tr('Scheduled'))),
      h('h3', {}, tr('Project review')), h('p', {}, tr('Team meeting · 30 min')),
      h('div', { class: 'art-calendar' }, [tr('MON'), tr('TUE'), tr('WED'), tr('THU'), tr('FRI')].map((day, i) => h('div', {}, h('small', {}, day), h('span', { class: i === 2 ? 'selected' : '' }, 12 + i)))),
      h('div', { class: 'art-slots' }, h('i'), h('i'), h('i'), h('i'), h('i')),
      h('div', { class: 'art-card-bottom' }, h('div', { class: 'art-avatars' }, ['J', 'A', 'L'].map((v, i) => h('span', { class: `art-avatar tone-${i}` }, v))), h('span', {}, tr('3 participants')))),
    h('div', { class: 'art-float art-float-two' }, icon('globe', 20), h('div', {}, h('strong', {}, tr('Local time zones')), h('small', {}, tr('AUTOMATIC CONVERSION')))));
  const el = h('div', { class: 'entry-page' },
    h('section', { class: 'entry-left' }, brandLink('entry-brand'), form),
    h('section', { class: 'entry-right' }, illustration, h('div', { class: 'entry-art-caption' }, h('h2', {}, tr('Meeting scheduling')), h('p', {}, tr('Compare availability across time zones.')))));
  if (code) {
    if (restricted || cloud) inviteNote.textContent = tr('Sign in to view the invitation.');
    else api.invite(code).then(data => { inviteNote.textContent = tr("You are invited to {v0}. Sign in to view the invitation.", {v0: data.workspace.title}); }).catch(() => { inviteNote.textContent = tr('This invitation is unavailable. You can still sign in to your workspace.'); });
  }
  async function submit(e) {
    e.preventDefault(); const name = input.value.trim();
    if (!name) { error.textContent = tr('Enter your name.'); input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    input.removeAttribute('aria-invalid');
    if (restricted && !/^[0-9]{6}$/.test(passwordInput.value)) { error.textContent = tr('Enter a password containing exactly six digits.'); passwordInput.setAttribute('aria-invalid', 'true'); passwordInput.focus(); return; }
    button.disabled = true; error.textContent = ''; passwordInput?.removeAttribute('aria-invalid');
    try {
      await api.login(name, passwordInput?.value);
      if (passwordInput) passwordInput.value = '';
      try { localStorage.setItem('overlap.name', name); } catch { /* optional */ }
      await onSignedIn();
    } catch (err) { button.disabled = false; error.textContent = err.status === 429 ? tr('Too many attempts. Try again later.') : errorText(err); }
  }
  return { el, focus: () => input.focus() };
}
