// Site configuration. Values that differ per deployment come from VITE_* env vars set in the GitHub workflow.

/** e.g. https://github.com/owner/repo — enables the admin "edit on GitHub" links. */
export const REPO_URL: string = import.meta.env.VITE_REPO_URL ?? '';

/** Tile provider is configurable (PRD §6). Respect the provider's usage policy. */
export const TILES = {
  url: import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

/** Supplementary data older than this many days is flagged as possibly stale (PRD §9). */
export const STALE_DAYS = 30;

/**
 * External job search entry points (F10). Pre-filled deep links stay disabled until each platform's
 * terms are checked (PRD §10, A08); until then we link to the site entry and offer copyable keywords.
 */
export const JOB_SITES: { id: string; name: string; entry: string; deepLink: ((q: string) => string) | null }[] = [
  { id: 'gazette', name: 'Education Gazette', entry: 'https://gazette.education.govt.nz/vacancies/', deepLink: null },
  { id: 'seek', name: 'SEEK', entry: 'https://www.seek.co.nz/', deepLink: null },
  { id: 'trademe', name: 'Trade Me Jobs', entry: 'https://www.trademe.co.nz/a/jobs', deepLink: null },
];
