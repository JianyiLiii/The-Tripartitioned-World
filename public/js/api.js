import { tr } from './locale.js';
// JSON API client. The session lives in an HttpOnly cookie set by the server.

import { t } from './i18n.js';

export class ApiError extends Error {
  constructor(status, code, data) {
    super(code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

let onUnauthorized = null;

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login' && path !== '/api/config' && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, data && data.error, data);
  }
  return data;
}

const project = id => `/api/projects/${encodeURIComponent(id)}`;

export const api = {
  time: () => call('GET', '/api/time'),
  config: () => call('GET', '/api/config'),
  login: (name, password) => call('POST', '/api/login', { name, ...(password === undefined ? {} : { password }) }),
  changePassword: (currentPassword, newPassword) => call('POST', '/api/password', { currentPassword, newPassword }),
  logout: () => call('POST', '/api/logout'),
  me: () => call('GET', '/api/me'),
  setTimeZone: tz => call('PUT', '/api/me', { tz }),
  setDisplayName: displayName => call('PUT', '/api/me', { displayName }),
  addUsers: (names, admin = false) => call('POST', '/api/users', { names, admin }),
  createdUsers: () => call('GET', '/api/users'),
  setUserDeleted: (key, deleted) => call('POST', '/api/users/status', { key, deleted }),
  adminAccounts: () => call('GET', '/api/admins'),
  setAdmin: (key, admin) => call('POST', '/api/admins', { key, admin }),
  projects: () => call('GET', '/api/projects'),
  createProject: fields => call('POST', '/api/projects', fields),
  project: id => call('GET', project(id)),
  updateProject: (id, fields) => call('PATCH', project(id), fields),
  deleteProject: id => call('DELETE', project(id)),
  saveAvailability: (id, record) => call('PUT', `${project(id)}/availability`, record),
  workspaces: () => call('GET', '/api/workspaces'),
  createWorkspace: fields => call('POST', '/api/workspaces', fields),
  workspace: id => call('GET', `/api/workspaces/${encodeURIComponent(id)}`),
  updateWorkspace: (id, fields) => call('PATCH', `/api/workspaces/${encodeURIComponent(id)}`, fields),
  invite: code => call('GET', `/api/invites/${encodeURIComponent(code)}`),
  joinWorkspace: code => call('POST', `/api/invites/${encodeURIComponent(code)}/join`),
};

export function errorText(err) {
  if (err?.code === 'admin_quota_reached') return tr('Your team has a capacity of 50 members. {remaining} place(s) remain. Delete a member to free a place.', { remaining: err.data?.remaining ?? 0 });
  if (err?.code === 'user_limit_reached') return tr('The user limit is {limit}. Only {remaining} account(s) can still be added. No users were added.', { limit: err.data?.limit ?? 1000, remaining: err.data?.remaining ?? 0 });
  if (err?.code === 'storage_full') return tr('Server storage is full. No users were added. Ask an administrator to free space or upgrade hosting.');
  if (err?.status >= 500) return tr('The server is temporarily unavailable. Please try again.');
  if (err && err.code === 'network') return t('error.network');
  const messages = {
    owner_required: tr('Only the owner can manage administrators.'),
    owner_protected: tr('The owner account cannot be demoted.'),
    user_not_owned: tr('You can only manage accounts you added.'),
    availability_conflict: tr('Availability changed on another device. Refresh the page before editing again.'),
    invalid_weeks: tr('Choose valid calendar weeks and time ranges.'),
    access_denied: tr('The name or password is incorrect, or access has not been approved.'),
    access_config_error: tr('Sign-in is unavailable. Contact the administrator.'),
    auth_unavailable: tr('Sign-in is unavailable. Contact the administrator.'),
    invalid_config: tr('The workspace configuration could not be loaded. Try again.'),
    time_unavailable: tr('Could not sync the current date with the server. Try again.'),
    user_not_approved: tr('This person has not been approved for access. Contact the administrator.'),
    https_required: tr('Use the HTTPS address provided by the administrator.'),
    invalid_password: tr('Enter a password containing exactly six digits.'),
    password_change_required: tr('Change your default password before continuing.'),
    default_password_not_allowed: tr('Choose a password other than 123456.'),
    password_unchanged: tr('Choose a password different from your current password.'),
    incorrect_password: tr('Your current password is incorrect.'),
    rate_limited: tr('Too many attempts. Try again later.'),
    invalid_name: tr('Enter a name of 1–80 characters without control characters.'),
    name_in_use: tr('This username is already in use. Choose another name.'),
    name_changed: tr('This username has changed. Use your current username.'),
    admin_required: tr('Only administrators can add users.'),
    invalid_names: tr('Enter between 1 and 20 usernames.'),
    invalid_color: tr('Select a valid project color.'),
    invalid_workspace: tr('Select a project for this meeting.'),
    workspace_not_found: tr('Project not found, or you have not joined it.'),
    invite_not_found: tr('This invitation link is invalid. Request a new link.'),
    invitee_not_in_workspace: tr('Add participants to the project first.'),
    not_owner: tr('Only the creator can change this setting.'),
    invalid_title: tr('Enter a valid name.'),
    invalid_invitees: tr('Select valid participants.'),
  };
  if (messages[err?.code]) return messages[err.code];
  return (err && (err.code || err.message)) || t('error.unknown');
}
