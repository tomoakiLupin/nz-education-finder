// Build public overlays from admin-maintained files in data/: published enrichments, geo groups and AEWV matches.
// Runs offline at deploy time; the official snapshot in public/data/institutions.json is never modified.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { safeUrl, parseCsv, normNzbn, matchAewv, matchJobs } from './lib.mjs';

const DATA = new URL('../data/', import.meta.url);
const OUT = new URL('../public/data/', import.meta.url);
const ENRICH_FIELDS = new Set(['website', 'careers']);
const readJson = async (u) => JSON.parse(await readFile(u, 'utf8'));

function buildEnrichments(entries, known) {
  const out = {};
  const problems = [];
  for (const [key, list] of Object.entries(entries)) {
    if (!known.has(key)) { problems.push(`enrichment for unknown institution ${key}`); continue; }
    const current = {};
    for (const e of list) {
      if (!ENRICH_FIELDS.has(e.field)) { problems.push(`${key}: unsupported field ${e.field}`); continue; }
      current[e.field] = e; // later entries supersede earlier ones
    }
    for (const [field, e] of Object.entries(current)) {
      if (e.publish_status !== 'published') continue;
      const value = safeUrl(e.value);
      if (!value) { problems.push(`${key}.${field}: value is not an http(s) URL`); continue; }
      (out[key] ??= {})[field] = {
        value,
        sourceUrl: safeUrl(e.source_url),
        verifiedAt: e.verified_at ?? null,
        updatedBy: e.updated_by ?? null,
      };
    }
  }
  return { out, problems };
}

function buildGroups(groups, records) {
  return groups.map((g) => {
    const subs = new Set(g.suburbs);
    const members = records.filter((r) => (!g.region || r.region === g.region) && r.suburb && subs.has(r.suburb)).map((r) => r.key);
    const { suburbs, ...meta } = g;
    return { ...meta, suburbs, members };
  });
}

/** Full accredited-employer snapshot downloaded by scripts/fetch-aewv.mjs. Expired accreditations are excluded. */
async function loadAewv() {
  const csv = new URL('aewv/snapshot.csv', DATA);
  const metaFile = new URL('aewv/snapshot.json', DATA);
  if (!existsSync(csv) || !existsSync(metaFile)) return { employers: [], meta: null };
  const snap = await readJson(metaFile);
  const today = new Date().toISOString().slice(0, 10);
  const rows = parseCsv(await readFile(csv, 'utf8'));
  const employers = rows
    .filter((r) => r.expiry_date_of_accreditation && r.expiry_date_of_accreditation >= today)
    .map((r) => ({
      legal_name: r.employer_name,
      trading_name: r.trading_name,
      nzbn: normNzbn(r.nzbn),
      expiry: r.expiry_date_of_accreditation,
      city: r.city || null,
      sector: r.subsector || r.sector || null,
      source_as_of: r.last_verified_at || r.official_snapshot_date || null,
      batch: `nzaei-${snap.snapshot_date}`,
    }));
  const meta = {
    name: snap.source,
    url: snap.sourceUrl,
    licence: snap.licence,
    snapshotDate: snap.snapshot_date,
    sha256: snap.sha256,
    rows: rows.length,
    employers: employers.length,
    expiredExcluded: rows.length - employers.length,
    fetchedAt: snap.fetchedAt,
  };
  return { employers, meta };
}

/** Vacancies from scripts/fetch-jobs.mjs, linked to institutions; closed ones dropped. Missing file → empty list. */
async function buildJobs(records) {
  const file = new URL('jobs/gazette.json', DATA);
  if (!existsSync(file)) return { source: null, jobs: [] };
  const { source, jobs } = await readJson(file);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
  const open = jobs.filter((j) => j.closing >= today);
  const keys = matchJobs(open, records);
  return { source, jobs: open.map((j, i) => ({ ...j, key: keys[i] })) };
}

const SITE_URL = (process.env.SITE_URL ?? '').replace(/\/?$/, '/').replace(/^\/$/, '');
const LEVEL_TEXT = { high: '高可信', medium: '中可信', low: '低可信·待核实', conflict: '多个候选·待核实' };
const xml = (v) => String(v ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

/**
 * Atom feed of the newest vacancies, so feed readers (Feedly, Inoreader, Outlook…) can notify about new jobs.
 * Gazette ids increase with each listing, so "newest" = highest id. Entry ids are stable across builds.
 */
function atomFeed({ id, title, jobs, matches, records, fetchedAt }) {
  const byKey = new Map(records.map((r) => [r.key, r]));
  const entries = [...jobs].sort((a, b) => b.id - a.id).slice(0, 150).map((j) => {
    const r = j.key && byKey.get(j.key);
    const m = j.key && matches[j.key];
    const aewv = m ? `AEWV ${LEVEL_TEXT[m.level]}：${m.candidates[0].employer}${m.candidates[0].expiry ? `（有效至 ${m.candidates[0].expiry}）` : ''}` : 'AEWV 未知';
    const place = r ? [r.suburb, r.city].filter(Boolean).join(', ') : j.region;
    const summary = `${j.institute} · ${place ?? ''} · ${j.positions.join(' / ')} · 截止 ${j.closing}${j.closingTime ? ` ${j.closingTime}` : ''} · ${aewv}`;
    return `<entry><id>tag:nz-education-finder,2026:gazette-${j.id}</id><title>${xml(`${j.title} — ${j.institute}`)}</title>` +
      `<link href="${xml(SITE_URL ? `${SITE_URL}#/j/${j.id}` : j.url)}"/><updated>${fetchedAt}</updated><summary>${xml(summary)}</summary>` +
      j.roles.map((x) => `<category term="${xml(x)}"/>`).join('') + (j.region ? `<category term="${xml(j.region)}"/>` : '') + '</entry>';
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>${xml(title)}</title>` +
    `<id>tag:nz-education-finder,2026:${id}</id><updated>${fetchedAt}</updated>` +
    `<link href="https://gazette.education.govt.nz/vacancies/"/><author><name>NZ Education Finder</name></author>${entries.join('')}</feed>
`;
}

async function main() {
  const { records } = await readJson(new URL('institutions.json', OUT));
  const known = new Set(records.map((r) => r.key));
  const { entries } = await readJson(new URL('enrichments.json', DATA));
  const { groups } = await readJson(new URL('geo-groups.json', DATA));
  const { links } = await readJson(new URL('employer-links.json', DATA));
  const { reviews } = await readJson(new URL('aewv-reviews.json', DATA));

  const enrich = buildEnrichments(entries, known);
  const aewv = await loadAewv();
  const matches = aewv.employers.length ? matchAewv({ institutions: records, employers: aewv.employers, links, reviews }) : {};

  const overlays = {
    generatedAt: new Date().toISOString(),
    enrichments: enrich.out,
    groups: buildGroups(groups, records),
    aewv: { source: aewv.meta, matches },
  };
  await writeFile(new URL('overlays.json', OUT), JSON.stringify(overlays));
  const jobs = await buildJobs(records);
  await writeFile(new URL('jobs.json', OUT), JSON.stringify(jobs));
  if (jobs.source) {
    const common = { matches, records, fetchedAt: jobs.source.fetchedAt };
    await writeFile(new URL('feed.xml', OUT), atomFeed({ ...common, id: 'gazette-all', title: 'Education Gazette 新职位', jobs: jobs.jobs }));
    await writeFile(new URL('feed-aewv.xml', OUT), atomFeed({ ...common, id: 'gazette-aewv', title: 'Education Gazette 新职位（雇主有 AEWV 认证候选）', jobs: jobs.jobs.filter((j) => j.key && matches[j.key]) }));
  }
  const linked = jobs.jobs.filter((j) => j.key);
  console.log(`jobs: ${jobs.jobs.length} open, ${linked.length} linked to institutions, ${linked.filter((j) => matches[j.key]).length} with AEWV candidates`);
  const levels = Object.values(matches).reduce((a, m) => ((a[m.level] = (a[m.level] ?? 0) + 1), a), {});
  console.log(`enrichments: ${Object.keys(enrich.out).length} institutions; groups: ${overlays.groups.map((g) => `${g.id}=${g.members.length}`).join(', ')}; aewv employers: ${aewv.employers.length}, matches: ${JSON.stringify(levels)}`);
  if (enrich.problems.length) {
    console.error('Enrichment problems:\n  ' + enrich.problems.join('\n  '));
    process.exit(1); // block publishing until fixed
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
