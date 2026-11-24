// Download current Education Gazette vacancies (Ministry of Education, https://gazette.education.govt.nz/vacancies/).
//
// Since the Gazette redesign (Nov 2026) there is no data.json any more. The public sitemap lists every live vacancy
// with its last-modified time, so one sitemap request per build tells us what is open; a vacancy page is then read
// only when it is new to us or the Gazette changed it. Facts come from the page's schema.org JobPosting plus its
// "Role details" list (see parseGazetteVacancy in lib.mjs). /api is disallowed by robots.txt and is not used.
//
// Kept per vacancy: listing facts (title, school, region, categories, closing date), the ad text and the sentences of
// it that talk about visas / residency / overseas applicants, so the ad can still be read after the Gazette removes
// it. Email addresses and phone numbers are removed from the stored text; the contact block of the page is never read.
//
// Ids: the Gazette reference (e.g. 1HB1qt) encodes the numeric listing id the old data.json used (refToId), so
// existing archive rows, #/j/<id> links and data/ad/<id>.json files carry on unchanged.
//
// Outputs:
//   data/archive/jobs.jsonl  committed archive, one vacancy per line, kept after it closes (firstSeen / delisted).
//                            Lines only change when a vacancy appears, is edited or disappears, so commits stay small.
//   data/jobs/gazette.json   current snapshot for the build (git-ignored)
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extractVisa, redactContacts, parseGazetteVacancy, gazetteSitemap, gazetteFingerprint, refToId } from './lib.mjs';

export const GAZETTE = 'https://gazette.education.govt.nz/vacancies/';
export const SITEMAP = 'https://gazette.education.govt.nz/sitemap.xml';
const DIR = new URL('../data/jobs/', import.meta.url);
const ARCHIVE = new URL('../data/archive/jobs.jsonl', import.meta.url);
const MIN_JOBS = 100;
const PAGE_LIMIT = 1500; // vacancy pages read per run (the first run after the redesign reads every open vacancy once)
const CONCURRENCY = 3;
const UA = { 'user-agent': 'nz-education-finder (github actions; reads each vacancy page once, then only when it changes)' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readArchive() {
  if (!existsSync(ARCHIVE)) return new Map();
  const lines = (await readFile(ARCHIVE, 'utf8')).split('\n').filter(Boolean);
  return new Map(lines.map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
}

/** Parsed vacancy page; 'gone' for 404; null when it could not be read or parsed (retried next run). */
async function readVacancy(ref) {
  try {
    const res = await fetch(GAZETTE + encodeURIComponent(ref), { headers: UA });
    if (res.status === 404) return 'gone';
    if (!res.ok) return null;
    const v = parseGazetteVacancy(await res.text());
    return v && v.ref === ref && v.title && v.institute && v.closing ? v : null;
  } catch {
    return null;
  }
}

async function main() {
  const res = await fetch(SITEMAP, { headers: UA });
  if (!res.ok) throw new Error(`sitemap.xml: HTTP ${res.status}`);
  const entries = gazetteSitemap(await res.text()).filter((e) => refToId(e.ref) !== null);
  if (entries.length < MIN_JOBS) throw new Error(`sitemap lists only ${entries.length} vacancies, refusing`);

  const now = new Date().toISOString();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
  const archive = await readArchive();
  const live = new Map(entries.map((e) => [refToId(e.ref), e]));

  // New, changed, or never read with this reader (old rows have no `modified`) → read the page. Newest first.
  const todo = [...live].filter(([id, e]) => {
    const r = archive.get(id);
    return !r || r.modified !== e.modified || !r.visaCheckedAt || !('text' in r);
  }).sort((a, b) => b[0] - a[0]).slice(0, PAGE_LIMIT);

  let read = 0, failed = 0, gone = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(todo.slice(i, i + CONCURRENCY).map(async ([id, e]) => {
      const v = await readVacancy(e.ref);
      if (v === null) { failed++; return; }
      if (v === 'gone') { gone++; live.delete(id); return; } // listed in the sitemap but already removed
      const prev = archive.get(id);
      const { closesAt, posted, address, text: raw, ...facts } = v;
      archive.set(id, {
        ...prev, id, ...facts, url: GAZETTE + e.ref, modified: e.modified,
        firstSeen: prev?.firstSeen ?? today, visa: extractVisa(raw), visaCheckedAt: today, text: raw ? redactContacts(raw) : null,
      });
      read++;
    }));
    await sleep(300);
  }
  if (failed > todo.length * 0.5 && failed > 20) throw new Error(`${failed} of ${todo.length} vacancy pages could not be read or parsed — page layout changed?`);

  // Open = listed in the sitemap, facts known, not past its closing date. Everything else that was open is delisted.
  const open = [];
  for (const [id] of live) {
    const r = archive.get(id);
    if (!r?.title || !r.closing || r.closing < today) continue;
    delete r.delisted;
    open.push(r);
  }
  const openIds = new Set(open.map((r) => r.id));
  for (const r of archive.values()) if (!openIds.has(r.id) && !r.delisted) r.delisted = today; // closed or withdrawn
  if (open.length < MIN_JOBS) throw new Error(`only ${open.length} open vacancies with known facts, refusing`);

  await mkdir(DIR, { recursive: true });
  await mkdir(new URL('.', ARCHIVE), { recursive: true });
  const rows = [...archive.values()].sort((a, b) => a.id - b.id);
  await writeFile(new URL('jobs.jsonl.tmp', ARCHIVE), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await rename(new URL('jobs.jsonl.tmp', ARCHIVE), ARCHIVE);

  open.sort((a, b) => b.id - a.id);
  const out = { source: { name: 'Education Gazette', url: GAZETTE, sha256: gazetteFingerprint(entries), count: open.length, fetchedAt: now }, jobs: open };
  await writeFile(new URL('gazette.json.tmp', DIR), JSON.stringify(out));
  await rename(new URL('gazette.json.tmp', DIR), new URL('gazette.json', DIR));
  const withVisa = open.filter((j) => j.visa?.length).length;
  console.log(`Education Gazette: sitemap ${entries.length}, open ${open.length}; pages read ${read}, failed ${failed}, gone ${gone}, still to read ${Math.max(0, live.size - open.length)}; ${withVisa} mention visas; archive ${rows.length} vacancies`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
