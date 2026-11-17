// Entries that came from notification replies carry a `pid`. The native queue keeps
// acknowledged replies for 7 days and hands them back on every sync, and the merge only
// skips a reply whose pid is still in the journal. So when the user deletes such an entry,
// its pid is remembered here (a little longer than the native retention) so it isn't re-added.

const KEY = 'nu_deleted_pids';
const KEEP_MS = 8 * 24 * 60 * 60 * 1000;

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY)) || [];
    const cutoff = Date.now() - KEEP_MS;
    return list.filter(item => item && item.pid && item.at > cutoff);
  } catch {
    return [];
  }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export function rememberDeletedReply(pid) {
  if (!pid) return;
  save([...load().filter(item => item.pid !== pid), { pid, at: Date.now() }]);
}

export function forgetDeletedReply(pid) {
  if (!pid) return;
  save(load().filter(item => item.pid !== pid));
}

export function isDeletedReply(pid) {
  return !!pid && load().some(item => item.pid === pid);
}
