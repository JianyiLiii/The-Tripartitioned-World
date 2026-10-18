import { tr } from '../locale.js';
import { h } from '../dom.js';
import { api, errorText } from '../api.js';
import { brandLink } from '../brand.js';
import { openModal, toast } from '../ui.js';

function passwordForm({ name, onChanged, onCancel, onSessionExpired, mandatory = false }) {
  const id = mandatory ? 'setup-password' : 'change-password';
  const field = (suffix, autocomplete) => h('input', {
    class: 'input login-input', id: `${id}-${suffix}`, name: suffix,
    type: 'password', inputmode: 'numeric', minlength: '6', maxlength: '6',
    pattern: '[0-9]{6}', autocomplete, required: true, 'aria-describedby': `${id}-hint`,
  });
  const current = field('current', 'current-password');
  const next = field('new', 'new-password');
  const confirm = field('confirm', 'new-password');
  const inputs = [current, next, confirm];
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, mandatory ? tr('Save and continue') : tr('Save password'));
  const cancel = h('button', { class: 'btn', type: 'button', onclick: onCancel }, mandatory ? tr('Switch user') : tr('Cancel'));
  const label = (text, target) => h('label', { class: 'field-label', for: target.id, style: { display: 'block', 'margin-bottom': '8px', 'margin-top': '18px' } }, text);
  const el = h('form', { novalidate: true, onsubmit: save },
    h('p', { class: 'field-hint' }, tr("Signed in as {v0}.", {v0: name})),
    h('input', { type: 'hidden', name: 'username', autocomplete: 'username', value: name }),
    label(tr('Current password'), current), current,
    label(tr('New password'), next), next,
    label(tr('Confirm new password'), confirm), confirm,
    h('p', { class: 'field-hint', id: `${id}-hint`, style: { 'margin-top': '10px' } }, tr('Use exactly six digits. The new password cannot be 123456.')),
    error,
    h('div', { style: { display: 'flex', gap: '10px', 'margin-top': '22px' } }, submit, cancel));

  function invalid(input, message) {
    error.textContent = message; input.setAttribute('aria-invalid', 'true'); input.focus();
  }
  function clear() { inputs.forEach(input => { input.value = ''; }); }
  async function save(event) {
    event.preventDefault();
    inputs.forEach(input => input.removeAttribute('aria-invalid'));
    error.textContent = '';
    if (!/^[0-9]{6}$/.test(current.value)) { invalid(current, tr('Enter your current six-digit password.')); return; }
    if (!/^[0-9]{6}$/.test(next.value)) { invalid(next, tr('Enter a new password containing exactly six digits.')); return; }
    if (next.value === '123456') { invalid(next, tr('Choose a password other than 123456.')); return; }
    if (next.value === current.value) { invalid(next, tr('Choose a password different from your current password.')); return; }
    if (next.value !== confirm.value) { invalid(confirm, tr('The new passwords do not match.')); return; }
    submit.disabled = true; cancel.disabled = true;
    try {
      const { user } = await api.changePassword(current.value, next.value);
      clear();
      await onChanged(user);
    } catch (err) {
      if (err.status === 401) { clear(); onSessionExpired?.(); return; }
      error.textContent = errorText(err);
      if (err.code === 'incorrect_password') { current.setAttribute('aria-invalid', 'true'); current.focus(); }
    } finally { submit.disabled = false; cancel.disabled = false; }
  }
  return { el, focus: () => current.focus(), clear };
}

export function PasswordSetupView({ name, onChanged, onSignOut }) {
  const form = passwordForm({ name, onChanged, onCancel: onSignOut, mandatory: true });
  const el = h('div', { class: 'entry-page', style: { 'grid-template-columns': '1fr' } },
    h('section', { class: 'entry-left' }, brandLink('entry-brand'),
      h('div', { class: 'entry-form' }, h('h1', { style: { 'font-size': '32px', 'letter-spacing': '-1px' } }, tr('Set your password')),
        h('p', { class: 'entry-description' }, tr('Replace your default password before opening the workspace.')), form.el)));
  return { el, focus: form.focus, destroy: form.clear };
}

export function changePasswordDialog({ name, onChanged }) {
  const form = passwordForm({ name, onCancel: () => modal.close(), onSessionExpired: () => modal.close(), onChanged: async user => {
    await onChanged(user); modal.close(); toast(tr('Password updated'), 'success');
  } });
  const modal = openModal({ title: tr('Change password'), body: form.el, onClose: form.clear });
  return modal;
}
