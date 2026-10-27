// History entries and scroll positions for the hash router.
//
// Every history entry gets an id in history.state. A hashchange onto an entry that already has an id is a
// back/forward traversal: its saved scroll position is restored once the page has rendered. A new entry (link
// click or pushState) starts at the top for detail pages and keeps the position for list filter changes.
// Positions live in sessionStorage, so they also survive a reload of the tab.

interface EntryState { navId: string; inApp: boolean }

const KEY = 'nav.scroll';
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const current = (): EntryState | null => (history.state && typeof history.state.navId === 'string' ? history.state : null);

let positions: Record<string, number> = {};
try { positions = JSON.parse(sessionStorage.getItem(KEY) ?? '{}'); } catch { /* storage blocked */ }
let pending: number | 'top' | null = null;
let saveTimer = 0;

function save() {
  const s = current();
  if (!s) return;
  positions[s.navId] = Math.round(scrollY);
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      const ids = Object.keys(positions);
      if (ids.length > 200) for (const id of ids.slice(0, ids.length - 200)) delete positions[id];
      sessionStorage.setItem(KEY, JSON.stringify(positions));
    } catch { /* storage blocked: positions kept for this page load only */ }
  }, 200);
}

/** Call once at startup, before the first render. */
export function initNav() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const s = current();
  if (s) pending = positions[s.navId] ?? null; // reload: back to where the tab was
  else history.replaceState({ navId: newId(), inApp: false } satisfies EntryState, '');
  window.addEventListener('scroll', save, { passive: true });
}

const isDetail = (hash: string) => /^#\/(j|i)\//.test(hash);

/** Call on hashchange, before updating the route. */
export function onHashChange() {
  const s = current();
  if (s) { pending = positions[s.navId] ?? 0; return; } // back / forward
  history.replaceState({ navId: newId(), inApp: true } satisfies EntryState, '');
  pending = isDetail(location.hash) ? 'top' : null;
}

/** In-app navigation without a hashchange event: a new entry, or (typing) an update of the current one. */
export function pushHash(next: string, replace: boolean) {
  if (replace) history.replaceState(current() ?? { navId: newId(), inApp: true }, '', next);
  else {
    history.pushState({ navId: newId(), inApp: true } satisfies EntryState, '', next);
    pending = isDetail(next) ? 'top' : null;
  }
}

/** Call after the page for the current route has rendered with its data. */
export function applyScroll() {
  if (pending === null) return;
  scrollTo(0, pending === 'top' ? 0 : pending);
  pending = null;
}

/** True when the previous history entry is a page of this site, so "Back" can use history.back(). */
export const canGoBack = () => current()?.inApp === true;
