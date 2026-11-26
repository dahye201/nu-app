// Home screen widget (ios/App/NuWidget). Two jobs on the web side:
//
// 1. Tell the widget when the last entry was written. The widget only shows a question and how long
//    ago the last entry was, so only that one time is shared (no entry text). Sent from the journal
//    copy (journalMirror.js), which runs after every add, edit, delete and restore.
// 2. A tap on the widget opens nu://write. The native side keeps that request until the web app takes
//    it (on launch, or on the `nuWrite` window event while running); then the input gets focus and
//    the keyboard comes up.
import { Capacitor, registerPlugin } from '@capacitor/core';

const NuWidget = registerPlugin('NuWidget');
const native = Capacitor.isNativePlatform();

const DAY_KEY = /^ij_(\d{4})_(\d{1,2})_(\d{1,2})$/;

/**
 * When an entry was written, in ms. Entry ids are their creation time (Date.now(), or the reply's
 * time for notification replies); an id that is not a time on that day falls back to the day and
 * the entry's HH:MM.
 */
export function entryTime(key, entry) {
  const m = DAY_KEY.exec(key);
  if (!m || !entry) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const id = Number(entry.id);
  if (Number.isFinite(id) && id > 0) {
    const at = new Date(id);
    if (at.getFullYear() === y && at.getMonth() === mo && at.getDate() === d) return id;
  }
  const hm = /^(\d{1,2}):(\d{2})$/.exec(entry.time || '');
  if (!hm) return null;
  return new Date(y, mo, d, Number(hm[1]), Number(hm[2])).getTime();
}

/** Latest entry time across all days ({ ij_YYYY_M_D: [entries] }), or null when there are none. */
export function lastEntryTime(days) {
  let last = null;
  for (const [key, list] of Object.entries(days || {})) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const at = entryTime(key, entry);
      if (at !== null && (last === null || at > last)) last = at;
    }
  }
  return last;
}

let sent; // last value handed to the widget (undefined: nothing sent yet this launch)

/** Hands the latest entry time to the widget when it changed (an edit keeps it, so no reload). */
export async function syncWidget(days) {
  if (!native) return;
  const at = lastEntryTime(days);
  if (at === sent) return;
  try {
    await NuWidget.setLastEntry({ at });
    sent = at;
  } catch (err) {
    console.error('widget:', err);
  }
}

/** Calls `onWrite()` when the app was opened from the widget: now (launch) and while running. */
export function initWidgetLaunch({ onWrite }) {
  if (!native) return;
  const take = async () => {
    try {
      const { write } = await NuWidget.takeWriteRequest();
      if (write) onWrite();
    } catch (err) {
      console.error('widget:', err);
    }
  };
  window.addEventListener('nuWrite', take);
  take();
}
