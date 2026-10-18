// Server time is the calendar anchor. Between syncs a monotonic clock keeps
// elapsed time independent of changes to the computer's wall clock.
import { zonedParts } from './tz.js';

export function createClock({ monotonic = () => performance.now(), wall = () => Date.now() } = {}) {
  let anchor = null, anchoredAt = 0, wallAt = 0;
  return {
    now() { return anchor == null ? wall() : anchor + Math.max(0, monotonic() - anchoredAt); },
    get synced() { return anchor != null; },
    get ready() {
      return anchor != null && Math.abs((wall() - wallAt) - (monotonic() - anchoredAt)) < 120000;
    },
    async sync(fetchTime) {
      const sent = monotonic();
      const value = await fetchTime();
      const received = monotonic();
      if (!Number.isSafeInteger(value?.unixMs) || !Number.isFinite(Date.parse(value?.utc))
          || Math.abs(Date.parse(value.utc) - value.unixMs) > 1) {
        throw new Error('Invalid server time');
      }
      anchor = value.unixMs + Math.max(0, received - sent) / 2;
      anchoredAt = received;
      wallAt = wall();
      return this.now();
    },
  };
}

const clock = createClock();
const listeners = new Set();
let pending = null, refreshTimer = null, tickTimer = null;
const notify = () => listeners.forEach(listener => listener());

export const now = () => clock.now();
export const clockReady = () => clock.ready;
export function today(tz) {
  const { year, month, day } = zonedParts(now(), tz);
  return { year, month, day };
}
export function subscribeClock(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
async function fetchTime() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('/api/time', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
    if (!response.ok) throw new Error('Server time is unavailable');
    return await response.json();
  } finally { clearTimeout(timeout); }
}
export function syncClock() {
  if (!pending) pending = clock.sync(fetchTime).then(value => { notify(); return value; })
    .finally(() => { pending = null; });
  return pending;
}
export function startClock() {
  if (refreshTimer != null) return;
  // A failed refresh retains the last server anchor and retries later.
  const refresh = () => { notify(); syncClock().catch(notify); };
  refreshTimer = setInterval(refresh, 5 * 60 * 1000);
  tickTimer = setInterval(() => { if (!document.hidden) notify(); }, 30000);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}
