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

/** What a pre-filled search on another job site should look for. Every part is optional. */
export interface JobQuery { keywords?: string; region?: string | null; sector?: JobSector }
export type JobSector = 'ece' | 'primary' | 'secondary' | 'tertiary' | null;

// One NZ region → SEEK `where` text and Trade Me category slug. Gazette ("Manawatu/Whanganui", "Chatham Is.") and
// directory ("Manawatū-Whanganui Region") spellings both resolve; multi-region or unknown values give no region.
const REGIONS: [RegExp, string, string][] = [
  [/^northland/, 'Northland', 'northland'], [/^auckland/, 'Auckland', 'auckland'], [/^waikato/, 'Waikato', 'waikato'],
  [/^bay of plenty/, 'Bay of Plenty', 'bay-of-plenty'], [/^gisborne/, 'Gisborne', 'gisborne'], [/^hawkes bay/, 'Hawkes Bay', 'hawkes-bay'],
  [/^taranaki/, 'Taranaki', 'taranaki'], [/^manawatu/, 'Manawatu-Whanganui', 'manawatu-whanganui'], [/^wellington/, 'Wellington', 'wellington'],
  [/^(nelson|tasman)/, 'Nelson Tasman', 'nelson-tasman'], [/^marlborough/, 'Marlborough', 'marlborough'], [/^west coast/, 'West Coast', 'west-coast'],
  [/^canterbury/, 'Canterbury', 'canterbury'], [/^otago/, 'Otago', 'otago'], [/^southland/, 'Southland', 'southland'],
];
function region(v: string | null | undefined): { seek: string; trademe: string } | null {
  if (!v || v.includes(',')) return null;
  const n = v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const hit = REGIONS.find(([re]) => re.test(n));
  return hit ? { seek: hit[1], trademe: hit[2] } : null;
}

const SEEK_WORDS: Record<NonNullable<JobSector>, string> = { ece: 'early childhood teacher', primary: 'primary teacher', secondary: 'secondary teacher', tertiary: 'tutor' };
const TM_SUB: Record<NonNullable<JobSector>, string> = { ece: 'early-childhood', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary' };

/**
 * External job search entry points (F10). Links only open each site's own public search page with the filters
 * filled in; nothing is fetched from SEEK or Trade Me. URL shapes checked 2026-11-25: SEEK redirects
 * nz.seek.com/jobs?keywords&where to its search page; Trade Me paths are the education categories in its own
 * jobs sitemap (/a/jobs/education/<sub>/<region>), so Trade Me gets category + region but no keywords.
 */
export const JOB_SITES: { id: string; name: string; entry: string; deepLink: (q: JobQuery) => string }[] = [
  {
    id: 'gazette', name: 'Education Gazette', entry: 'https://gazette.education.govt.nz/vacancies/',
    deepLink: (q) => (q.keywords ? `https://gazette.education.govt.nz/vacancies?q=${encodeURIComponent(q.keywords)}` : 'https://gazette.education.govt.nz/vacancies/'),
  },
  {
    id: 'seek', name: 'SEEK', entry: 'https://nz.seek.com/',
    deepLink: (q) => {
      const p = new URLSearchParams({ keywords: q.keywords || (q.sector ? SEEK_WORDS[q.sector] : 'teacher') });
      const r = region(q.region);
      if (r) p.set('where', r.seek);
      return `https://nz.seek.com/jobs?${p}`;
    },
  },
  {
    id: 'trademe', name: 'Trade Me Jobs', entry: 'https://www.trademe.co.nz/a/jobs',
    deepLink: (q) => ['https://www.trademe.co.nz/a/jobs/education', q.sector && TM_SUB[q.sector], region(q.region)?.trademe].filter(Boolean).join('/'),
  },
];

/** Gazette sector label ("Early learning / kōhanga reo") → search sector. */
export function sectorOf(label: string | null | undefined): JobSector {
  const s = (label ?? '').toLowerCase();
  return s.startsWith('early') ? 'ece' : s.startsWith('primary') ? 'primary' : s.startsWith('secondary') ? 'secondary' : s.startsWith('tertiary') ? 'tertiary' : null;
}

/** Directory institution → search sector (ECE, or school type). */
export function sectorOfInstitution(r: { cat: 'school' | 'ece'; type?: string | null }): JobSector {
  if (r.cat === 'ece') return 'ece';
  const t = (r.type ?? '').toLowerCase();
  return /secondary/.test(t) ? 'secondary' : /primary|intermediate/.test(t) ? 'primary' : null;
}
