// Stand-in for @capacitor/core in UI tests: the app runs as if on iPhone, with nu.'s native
// plugins faked in the page. Test pages control them through localStorage/sessionStorage:
//   localStorage  __mockSkip = '1'                 → "Not today" was tapped today
//   localStorage  __mockPermission = 'denied' | …  → iOS notification permission (default 'granted')
//   sessionStorage __journal                       → the native journal file (survives reloads,
//                                                     and localStorage.clear(), like the real file)
// Calls are recorded in window.__calls; scheduled reminders in window.__scheduled.
const pad = n => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

window.__calls = [];
window.__skip = localStorage.getItem('__mockSkip') === '1' ? today : null;
const permission = () => localStorage.getItem('__mockPermission') || 'granted';

const reminders = {
  takePending: async () => ({ entries: [], skipDay: window.__skip }),
  ackPending: async () => ({}),
  getPermission: async () => ({ display: permission() }),
  askPermission: async () => ({ display: permission() === 'prompt' ? 'granted' : permission() }),
  schedule: async ({ reminders: list }) => { window.__scheduled = list; window.__calls.push('schedule'); return { count: list.length }; },
  cancelAll: async () => { window.__scheduled = []; window.__calls.push('cancelAll'); return {}; },
  getTimeFormat: async () => ({ hour12: false }),
  openSettings: async () => ({}),
  clearSkipDay: async () => { window.__calls.push('clearSkipDay'); window.__skip = null; return {}; },
};

const journal = {
  save: async ({ data }) => { sessionStorage.setItem('__journal', data); return {}; },
  load: async () => { await new Promise(r => setTimeout(r, 50)); return { data: sessionStorage.getItem('__journal') }; },
};

export const Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: () => true };
export function registerPlugin(name) {
  if (name === 'NuReminders') return reminders;
  if (name === 'NuJournal') return journal;
  return new Proxy({}, { get: () => async () => ({}) });
}
export class WebPlugin {}
export const buildRequestInit = () => ({});
export const CapacitorException = Error;
export const ExceptionCode = {};
export const registerWebPlugin = () => {};
