// Stand-in for @capacitor/core in UI tests: the app runs as if on iPhone, with nu.'s native
// plugins faked in the page. Test pages control them through localStorage/sessionStorage:
//   localStorage  __mockSkip = '1'                 → "Not today" was tapped today
//   localStorage  __mockPermission = 'denied' | …  → iOS notification permission (default 'granted')
//   sessionStorage __journal                       → the native journal file (survives reloads,
//                                                     and localStorage.clear(), like the real file)
//   sessionStorage __widgetWrite = '1'             → the app was opened from the widget (taken once);
//                                                     window.__openFromWidget() does the same while running
// The widget's latest entry time is recorded in window.__widgetAt (one entry per send in __widgetSends).
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
  schedule: async ({ reminders: list, recap = null, recapBodies = [] }) => { window.__scheduled = list; window.__recap = recap; window.__recapBodies = recapBodies; window.__calls.push('schedule'); return { count: list.length }; },
  cancelAll: async () => { window.__scheduled = []; window.__recap = null; window.__calls.push('cancelAll'); return {}; },
  getTimeFormat: async () => ({ hour12: false }),
  openSettings: async () => ({}),
  clearSkipDay: async () => { window.__calls.push('clearSkipDay'); window.__skip = null; return {}; },
};

const journal = {
  save: async ({ data }) => { sessionStorage.setItem('__journal', data); return {}; },
  load: async () => { await new Promise(r => setTimeout(r, 50)); return { data: sessionStorage.getItem('__journal') }; },
};

window.__widgetSends = [];
const widget = {
  setLastEntry: async ({ at }) => { window.__widgetAt = at; window.__widgetSends.push(at); return {}; },
  takeWriteRequest: async () => {
    const write = sessionStorage.getItem('__widgetWrite') === '1';
    sessionStorage.removeItem('__widgetWrite');
    return { write };
  },
};
// Like AppDelegate on nu://write while the app is running: request kept, then the window event
window.__openFromWidget = () => { sessionStorage.setItem('__widgetWrite', '1'); window.dispatchEvent(new Event('nuWrite')); };

export const Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: () => true };
export function registerPlugin(name) {
  if (name === 'NuReminders') return reminders;
  if (name === 'NuJournal') return journal;
  if (name === 'NuWidget') return widget;
  return new Proxy({}, { get: () => async () => ({}) });
}
export class WebPlugin {}
export const buildRequestInit = () => ({});
export const CapacitorException = Error;
export const ExceptionCode = {};
export const registerWebPlugin = () => {};
