import { tr } from '../locale.js';
import { h, fill } from '../dom.js';
import { api, errorText } from '../api.js';
import { openModal, toast, confirmDialog } from '../ui.js';

export function editProfileDialog({ user, onChanged }) {
  const name = h('input', { class: 'input', id: 'profile-display-name',
    value: user.name, maxlength: '80', required: true, autocomplete: 'nickname',
    'aria-describedby': 'profile-name-hint' });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, tr('Save name'));
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, tr('Cancel'));
  const form = h('form', { onsubmit: async event => {
    event.preventDefault(); error.textContent = ''; name.removeAttribute('aria-invalid');
    if (!name.value.trim()) { error.textContent = tr('Enter your username.'); name.setAttribute('aria-invalid', 'true'); name.focus(); return; }
    save.disabled = true; cancel.disabled = true;
    try {
      const result = await api.setDisplayName(name.value);
      try { localStorage.setItem('overlap.name', result.user.loginName); } catch { /* optional */ }
      await onChanged(result.user); modal.close(); toast(tr('Username updated'), 'success');
    } catch (err) {
      if (err.status === 401) { modal.close(); return; }
      error.textContent = errorText(err);
    } finally { save.disabled = false; cancel.disabled = false; }
  } },
  h('label', { class: 'field-label', for: name.id, style: { display: 'block', 'margin-bottom': '8px' } }, tr('Username')), name,
  h('p', { class: 'field-hint', id: 'profile-name-hint', style: { 'margin-top': '10px' } }, tr('Use your new username the next time you sign in. Your password, projects and meetings stay the same.')), error,
  h('div', { style: { display: 'flex', gap: '10px', 'justify-content': 'flex-end', 'margin-top': '22px' } }, cancel, save));
  const modal = openModal({ title: tr('Edit profile'), body: form });
  return modal;
}

export function addUsersDialog({ onAdded, admin = false }) {
  const quota = h('p', { class: 'field-hint', role: 'status' }, tr('Your team can have up to 50 members. Deleting a member frees a place.'));
  api.me().then(result => {
    if (result.user?.userQuota) quota.textContent = tr('Team capacity: {used}/50 members · {remaining} places available', result.user.userQuota);
  }).catch(() => {});
  const names = h('textarea', { class: 'input', id: 'new-user-names', rows: '4', required: true,
    placeholder: tr('One username per line'), 'aria-describedby': 'new-user-hint' });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, tr(admin ? 'Add administrators' : 'Add users'));
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, tr('Cancel'));
  const form = h('form', { onsubmit: async event => {
    event.preventDefault(); error.textContent = '';
    const list = names.value.split(/[,，\r\n]+/).map(name => name.trim()).filter(Boolean);
    if (!list.length || list.length > 20) { error.textContent = tr('Enter between 1 and 20 usernames.'); return; }
    submit.disabled = true; cancel.disabled = true;
    try {
      const result = await api.addUsers(list, admin);
      await onAdded(); modal.close(); toast(tr("{v0} user(s) added. Initial password: 123456", {v0: result.names.length}), 'success');
    } catch (err) { error.textContent = errorText(err); }
    finally { submit.disabled = false; cancel.disabled = false; }
  } }, quota, h('label', { class: 'field-label', for: names.id }, tr('Usernames')), names,
  h('p', { class: 'field-hint', id: 'new-user-hint' }, tr(admin
    ? 'New administrators sign in with 123456 and can manage their own 50-member team. They cannot appoint administrators.'
    : 'Names are case-insensitive. New users sign in with 123456 and can change it later. New users cannot add other users.')), error,
  h('div', { style: { display: 'flex', gap: '10px', 'justify-content': 'flex-end', 'margin-top': '22px' } }, cancel, submit));
  const modal = openModal({ title: tr(admin ? 'Add administrators' : 'Add users'), body: form });
  return modal;
}

export function manageUsersDialog({ onChanged }) {
  const summary = h('p', { class: 'field-hint', role: 'status' });
  const list = h('div', { class: 'managed-users-list' });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const body = h('div', {}, summary,
    h('p', { class: 'field-hint' }, tr('Only accounts you added appear here. Deleted accounts cannot sign in. Meeting history is kept.')),
    list, error);
  const modal = openModal({ title: tr('Manage team'), body });
  function render(data) {
    summary.textContent = tr('Team capacity: {used}/50 members · {remaining} places available', data.quota);
    const members = [...data.users].sort((a,b) => Number(a.deleted)-Number(b.deleted) || a.name.localeCompare(b.name));
    fill(list, members.length ? members.map(user => h('div', { class: 'managed-user-row' },
      h('div', { class: 'managed-user-name' }, h('strong', {}, user.name),
        h('small', {}, tr(user.deleted ? 'Deleted' : user.enabled ? 'Active' : 'Disabled'))),
      user.canManage ? h('button', { class: 'btn btn-sm', type: 'button',
        disabled: user.deleted && !data.quota.remaining,
        onclick: async event => {
          const button = event.currentTarget;
          if (!user.deleted && !await confirmDialog({ title: tr('Delete account'),
            message: tr('Delete {name}? Sign-in access will stop immediately and one team place will be freed. Meeting history stays available. You can restore this account later if there is space.', {name:user.name}),
            confirmText: tr('Delete account'), danger: true })) return;
          button.disabled = true; error.textContent = '';
          try {
            const result = await api.setUserDeleted(user.key, !user.deleted);
            render(result); await onChanged();
            toast(tr(user.deleted ? 'Account restored' : 'Account deleted'), 'success');
          } catch (err) { error.textContent = errorText(err); button.disabled = false; }
        } }, tr(user.deleted ? 'Restore' : 'Delete account')) : null))
      : h('p', { class: 'field-hint' }, tr('You have not added any accounts yet.')));
  }
  api.createdUsers().then(render).catch(err => { error.textContent = errorText(err); });
  return modal;
}

export function manageAdminsDialog({ onChanged }) {
  const list = h('div', { class:'managed-users-list' });
  const error = h('p', { class:'form-error', role:'alert' });
  const body = h('div', {}, h('p', {class:'field-hint'}, tr('Only the owner can appoint administrators. Each administrator manages a team of up to 50 members.')),
    h('button', {class:'btn btn-primary', type:'button', onclick: () => addUsersDialog({admin:true, onAdded:async () => {
      await refresh(); await onChanged();
    }})}, tr('Add administrators')), list, error);
  const modal = openModal({title:tr('Manage administrators'), body});
  async function refresh() {
    try {
      const data = await api.adminAccounts();
      fill(list, data.users.map(user => h('div', {class:'managed-user-row'},
        h('div', {class:'managed-user-name'}, h('strong', {}, user.name), h('small', {}, tr(user.owner ? 'Owner' : user.admin ? 'Administrator' : 'Member'))),
        user.owner ? null : h('button', {class:'btn btn-sm', type:'button', onclick:async event => {
          const button = event.currentTarget;
          if (!await confirmDialog({title:tr('Change administrator access'), message:tr(user.admin
            ? 'Remove administrator access from {name}? Their team records are kept, but they cannot manage accounts until restored.'
            : 'Make {name} an administrator? They will be able to add and manage up to 50 team members.', {name:user.name})})) return;
          button.disabled = true; error.textContent = '';
          try { await api.setAdmin(user.key,!user.admin); await refresh(); await onChanged(); }
          catch (err) { error.textContent = errorText(err); button.disabled = false; }
        }}, tr(user.admin ? 'Remove admin access' : 'Make administrator')))));
    } catch(err) { error.textContent = errorText(err); }
  }
  refresh();
  return modal;
}
