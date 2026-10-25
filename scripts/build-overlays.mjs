// Build public overlays from admin-maintained files in data/: published enrichments, geo groups and AEWV matches.
// Runs offline at deploy time; the official snapshot in public/data/institutions.json is never modified.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { safeUrl, parseCsv, normNzbn, matchAewv } from './lib.mjs';

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
