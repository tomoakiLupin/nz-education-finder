// Import School + ECE directories from the Ministry of Education open data (data.govt.nz CKAN datastore, CC-BY 4.0).
// Pipeline: fetch → validate in memory (staging) → sanity gate → merge over last good snapshot → write public files.
// If any step fails the process exits non-zero and the previously committed snapshot stays in place.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { sha256, toPublicRecord, mergeBatch } from './lib.mjs';

const CKAN = 'https://catalogue.data.govt.nz/api/3/action';
const PACKAGE = 'directory-of-educational-institutions';
const SOURCES = {
  school: { resource: '4b292323-9fcc-41f8-814b-3c7b19cf14b3', label: 'Schools Directory' },
  ece: { resource: 'a9d65b07-8483-4b05-bdfd-d2abe4f38827', label: 'Early Childhood Services (ECEs) Directory' },
};
const OUT = new URL('../public/data/', import.meta.url);
const MIN_RATIO = 0.8; // a batch shrinking by more than 20% is treated as a bad source file
const PAGE = 1000;

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'nz-education-finder (github actions data import)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const body = await res.json();
      if (!body.success) throw new Error(`CKAN error for ${url}`);
      return body.result;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function fetchAll(resource) {
  const rows = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += PAGE) {
    const r = await getJson(`${CKAN}/datastore_search?resource_id=${resource}&limit=${PAGE}&offset=${offset}&sort=_id%20asc`);
    total = r.total;
    rows.push(...r.records);
    if (!r.records.length) break;
  }
  if (rows.length !== total) throw new Error(`row count mismatch: got ${rows.length}, datastore reports ${total}`);
  return rows;
}

const readJson = async (u, fallback) => (existsSync(u) ? JSON.parse(await readFile(u, 'utf8')) : fallback);

async function main() {
  await mkdir(OUT, { recursive: true });
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const prevFile = await readJson(new URL('institutions.json', OUT), { records: [] });
  const batches = await readJson(new URL('batches.json', OUT), []);
  const pkg = await getJson(`${CKAN}/package_show?id=${PACKAGE}`);

  let records = prevFile.records;
  const reports = [];
  for (const [kind, src] of Object.entries(SOURCES)) {
    const meta = pkg.resources.find((r) => r.id === src.resource);
    if (!meta) throw new Error(`resource ${src.resource} (${kind}) no longer listed in ${PACKAGE}`);
    const raw = await fetchAll(src.resource);
    const checksum = sha256(JSON.stringify(raw.map(({ _id, ...rest }) => rest)));
    const last = [...batches].reverse().find((b) => b.sourceType === kind && b.status === 'published');
    if (last?.checksum === checksum) {
      console.log(`${kind}: unchanged (checksum ${checksum.slice(0, 12)}), skipping`);
      continue; // idempotent re-import
    }

    const issues = [];
    const fresh = [];
    const seen = new Set();
    for (const row of raw) {
      const { record, issues: is } = toPublicRecord(kind, row);
      issues.push(...is);
      if (!record) continue;
      if (seen.has(record.key)) { issues.push(`${record.key} duplicate row in source`); continue; }
      seen.add(record.key);
      fresh.push(record);
    }

    const prevPresent = prevFile.records.filter((r) => r.cat === kind && r.sourceStatus === 'present').length;
    if (fresh.length < 100 || (prevPresent && fresh.length < prevPresent * MIN_RATIO)) {
      throw new Error(`${kind}: batch rejected, ${fresh.length} valid rows vs ${prevPresent} previously; last good data kept`);
    }

    const batchId = `${kind}-${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
    const { records: merged, report } = mergeBatch(records, fresh, batchId, today);
    records = merged;
    const batch = {
      id: batchId,
      sourceType: kind,
      sourceLabel: src.label,
      sourceUrl: `https://catalogue.data.govt.nz/dataset/${PACKAGE}/resource/${src.resource}`,
      sourceAsOf: meta.last_modified ? `${meta.last_modified.replace(/(\.\d+)?$/, '')}Z` : null,
      importedAt: now.toISOString(),
      checksum,
      status: 'published',
      counts: {
        sourceRows: raw.length, valid: fresh.length, rejected: raw.length - fresh.length,
        added: report.added.length, changed: report.changed.length, missing: report.missing.length, returned: report.returned.length,
      },
      importer: process.env.GITHUB_ACTOR ? `github:${process.env.GITHUB_ACTOR}` : 'local',
    };
    batches.push(batch);
    reports.push({ batch: batchId, ...report, issues });
    console.log(`${kind}: ${JSON.stringify(batch.counts)}`);
  }

  if (!reports.length) { console.log('No source changes.'); return; }
  // One record per line keeps git diffs readable, so the commit history doubles as the change audit.
  const lines = records.map((r) => JSON.stringify(r)).join(',\n');
  await writeFile(new URL('institutions.json', OUT), `{"generatedAt":${JSON.stringify(now.toISOString())},"records":[\n${lines}\n]}\n`);
  await writeFile(new URL('batches.json', OUT), JSON.stringify(batches.slice(-60), null, 1));
  await writeFile(new URL('import-report.json', OUT), JSON.stringify({ generatedAt: now.toISOString(), reports }, null, 1));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
