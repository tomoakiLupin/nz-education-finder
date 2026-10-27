// Download current Education Gazette vacancies (Ministry of Education, https://gazette.education.govt.nz/vacancies/).
// The vacancies page loads all live listings from one JSON file; we fetch that same file once per build.
//
// Kept per vacancy: listing facts (title, school, region, categories, closing date), the ad text and the sentences of
// it that talk about visas / residency / overseas applicants. The ad text comes from the vacancy page, which is read
// once per vacancy (new ones only), so the ad can still be read after the Gazette removes it. Email addresses and
// phone numbers are removed from the stored text; the contact block of the page is never read.
//
// Outputs:
//   data/archive/jobs.jsonl  committed archive, one vacancy per line, kept after it closes (firstSeen / delisted).
//                            Lines only change when a vacancy appears, is edited or disappears, so commits stay small.
//   data/jobs/gazette.json   current snapshot for the build (git-ignored)
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { sha256, extractVisa, gazetteDescription, redactContacts } from './lib.mjs';

export const GAZETTE = 'https://gazette.education.govt.nz/vacancies/';
const DIR = new URL('../data/jobs/', import.meta.url);
const ARCHIVE = new URL('../data/archive/jobs.jsonl', import.meta.url);
const MIN_JOBS = 100;
const PAGE_LIMIT = 1500; // vacancy pages read per run (first run reads every open vacancy once)
const CONCURRENCY = 3;
const UA = { 'user-agent': 'nz-education-finder (github actions; reads each vacancy once)' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readArchive() {
  if (!existsSync(ARCHIVE)) return new Map();
  const lines = (await readFile(ARCHIVE, 'utf8')).split('\n').filter(Boolean);
  return new Map(lines.map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
}

/**
 * Ad text (contacts removed) and visa-related sentences of one vacancy; text null once the page is gone (404).
 * Returns null if the page could not be read, so it is retried next run.
 */
async function adFor(url) {
  try {
    const res = await fetch(url, { headers: UA });
    if (res.status === 404) return { text: null, visa: [] };
    if (!res.ok) return null;
    const text = gazetteDescription(await res.text());
    return text === null ? null : { text: redactContacts(text), visa: extractVisa(text) };
  } catch {
    return null;
  }
}

async function main() {
  const res = await fetch(GAZETTE + 'data.json', { headers: UA });
  if (!res.ok) throw new Error(`data.json: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const raw = JSON.parse(buf.toString('utf8'));
  if (!Array.isArray(raw)) throw new Error('data.json is not a list');
  if (raw.length < MIN_JOBS) throw new Error(`only ${raw.length} vacancies, refusing`);
  const bad = raw.filter((j) => !j.id || !j.slug || !j.title || !j.institute || !j.closing?.iso);
  if (bad.length > raw.length * 0.05) throw new Error(`${bad.length} vacancies missing required fields`);

  const now = new Date().toISOString();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
  const archive = await readArchive();
  const current = raw
    .filter((j) => !bad.includes(j))
    .map((j) => ({
      id: j.id,
      ref: j.ref ?? null,
      title: String(j.title).trim(),
      institute: String(j.institute).trim(),
      region: j.region ?? null,
      sectors: j.sectors ?? [],
      roles: j.roles ?? [],
      positions: j.positions ?? [],
      learning: j.learning ?? [],
      allowances: j.allowances ?? null,
      beginning: Boolean(j.beginning),
      closing: j.closing.iso,
      closingTime: j.closingTime ?? null,
      url: `${GAZETTE}${encodeURIComponent(j.slug)}/`,
    }));

  // Merge into the archive: listing facts follow the latest Gazette data; firstSeen / delisted are ours (NZ dates).
  const live = new Set();
  for (const j of current) {
    live.add(j.id);
    const prev = archive.get(j.id);
    const { delisted, ...rest } = prev ?? {};
    archive.set(j.id, { ...rest, ...j, firstSeen: prev?.firstSeen ?? today, visa: prev?.visa ?? null, visaCheckedAt: prev?.visaCheckedAt ?? null });
  }
  for (const r of archive.values()) if (!live.has(r.id) && !r.delisted) r.delisted = today; // closed or withdrawn

  // Read the vacancy page once for anything not yet read (rows archived before ad text was kept have no `text` key;
  // their pages are tried once too, and stay without text if the Gazette has removed them).
  const todo = [...archive.values()].filter((r) => !r.visaCheckedAt || !('text' in r)).sort((a, b) => b.id - a.id).slice(0, PAGE_LIMIT);
  let read = 0, failed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(todo.slice(i, i + CONCURRENCY).map(async (r) => {
      const ad = await adFor(r.url);
      if (ad === null) { failed++; return; }
      // A removed page keeps the visa sentences read while it was live.
      Object.assign(r, ad.text === null && r.visaCheckedAt ? { text: null } : { ...ad, visaCheckedAt: today });
      read++;
    }));
    await sleep(300);
  }

  await mkdir(DIR, { recursive: true });
  await mkdir(new URL('.', ARCHIVE), { recursive: true });
  const rows = [...archive.values()].sort((a, b) => a.id - b.id);
  await writeFile(new URL('jobs.jsonl.tmp', ARCHIVE), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await rename(new URL('jobs.jsonl.tmp', ARCHIVE), ARCHIVE);

  const out = { source: { name: 'Education Gazette', url: GAZETTE, sha256: sha256(buf), count: current.length, fetchedAt: now }, jobs: current.map((j) => archive.get(j.id)) };
  await writeFile(new URL('gazette.json.tmp', DIR), JSON.stringify(out));
  await rename(new URL('gazette.json.tmp', DIR), new URL('gazette.json', DIR));
  const withVisa = out.jobs.filter((j) => j.visa?.length).length;
  console.log(`Education Gazette: ${current.length} open (${bad.length} skipped); pages read ${read}, failed ${failed}; ${withVisa} mention visas; archive ${rows.length} vacancies`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
