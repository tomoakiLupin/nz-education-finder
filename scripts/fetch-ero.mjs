// Latest ERO (Education Review Office) report for each school / ECE service, kept in data/ero.json.
//
// Polite and incremental: one request at a time with a pause between them, institutions never checked first, then the
// ones checked longest ago (older than MAX_AGE_DAYS). A run stops after --limit pages or --minutes, so the full
// directory (~7 000 pages) is refreshed over a few weekly runs. ERO reviews a service every 1–4 years, so that is ample.
//
// Akarangi quality-evaluation reports (ECE, 2024+) only give their judgements in a PDF; those are read with poppler's
// `pdftohtml` when it is installed (CI installs poppler-utils). Without it the report link is still recorded.
//
// Usage: node scripts/fetch-ero.mjs [--limit 1500] [--minutes 50] [--only school:24,ece:46992]
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize, parseEroPage, parseAkarangiXml } from './lib.mjs';

const ROOT = new URL('../', import.meta.url);
const CACHE = new URL('data/ero.json', ROOT);
const UA = { 'user-agent': 'nz-education-finder (github actions; weekly, one page at a time)' };
const PAUSE_MS = 1000;
const MAX_AGE_DAYS = 30;

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const LIMIT = Number(arg('limit', 1500));
const MINUTES = Number(arg('minutes', 50));
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (d) => (Date.parse(today) - Date.parse(d)) / 86_400_000;

let pdftohtml = true;
try { execFileSync('pdftohtml', ['-v'], { stdio: 'ignore' }); } catch { pdftohtml = false; console.warn('pdftohtml not found: Akarangi PDF judgements will be skipped.'); }

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(45_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(5000 * attempt);
    }
  }
}

async function pdfJudgements(url, dir) {
  const res = await get(url);
  if (!res) return [];
  const file = join(dir, 'report.pdf');
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  const xml = execFileSync('pdftohtml', ['-xml', '-i', '-q', '-f', '1', '-l', '1', '-stdout', file], { encoding: 'utf8', maxBuffer: 20 << 20 });
  return parseAkarangiXml(xml);
}

const { records } = JSON.parse(await readFile(new URL('public/data/institutions.json', ROOT), 'utf8'));
let cache = {};
try { cache = JSON.parse(await readFile(CACHE, 'utf8')).items ?? {}; } catch { /* first run */ }

const present = records.filter((r) => r.sourceStatus === 'present' && (!ONLY || ONLY.has(r.key)));
const due = present
  .filter((r) => ONLY || !cache[r.key] || daysAgo(cache[r.key].checkedAt) >= MAX_AGE_DAYS)
  .sort((a, b) => (cache[a.key]?.checkedAt ?? '') .localeCompare(cache[b.key]?.checkedAt ?? ''));
console.log(`${present.length} institutions, ${due.length} due, checking up to ${LIMIT} within ${MINUTES} min.`);

const save = async () => {
  const known = new Set(records.map((r) => r.key));
  const items = Object.fromEntries(Object.entries(cache).filter(([k]) => known.has(k)).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(CACHE, `${JSON.stringify({ source: 'https://www.ero.govt.nz/', updatedAt: today, items }, null, 0)}\n`);
};

const tmp = await mkdtemp(join(tmpdir(), 'ero-'));
const deadline = Date.now() + MINUTES * 60_000;
let done = 0, failed = 0, streak = 0, withReport = 0;
try {
  for (const r of due.slice(0, LIMIT)) {
    if (Date.now() > deadline) { console.log('Time budget used up.'); break; }
    const url = `https://www.ero.govt.nz/institution/${r.id}/${normalize(r.name).replace(/ /g, '-') || 'institution'}`;
    try {
      const res = await get(url);
      const page = res ? parseEroPage(await res.text(), url) : null;
      const prev = cache[r.key];
      const entry = { checkedAt: today, url };
      if (page) {
        Object.assign(entry, page);
        if (page.kind === 'quality' && page.pdf && !page.rows.length) {
          if (prev?.pdf === page.pdf && prev.ratings?.length) entry.ratings = prev.ratings; // same report: no need to read the PDF again
          else if (pdftohtml) { await sleep(PAUSE_MS); entry.ratings = await pdfJudgements(page.pdf, tmp).catch(() => []); }
        }
        withReport++;
      }
      for (const k of Object.keys(entry)) if (entry[k] === null || entry[k] === false || (Array.isArray(entry[k]) && !entry[k].length)) delete entry[k];
      cache[r.key] = entry;
      streak = 0;
    } catch (e) {
      failed++; streak++;
      console.warn(`${r.key}: ${e.message}`);
      if (streak >= 8) throw new Error('ERO looks unreachable (8 failures in a row); stopping, data so far is kept.');
    }
    if (++done % 100 === 0) { await save(); console.log(`${done} checked (${withReport} with a report, ${failed} failed)`); }
    await sleep(PAUSE_MS);
  }
} finally {
  await save();
  await rm(tmp, { recursive: true, force: true });
}
console.log(`Done: ${done} checked, ${withReport} with a report, ${failed} failed. ${Object.keys(cache).length} cached.`);
if (done && failed > done / 2) process.exit(1);
