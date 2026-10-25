// Download the latest accredited-employer snapshot published by NZ Accredited Employer Inspector
// (https://nzaei.zemo.bio/open-data/). Snapshots are full, dated, immutable CSVs (≈30k employers, every ~3 days),
// built from MBIE's OIA release plus live INZ verifications, each with a SHA-256 checksum and row count.
// Reuse licence is NOASSERTION, so the file stays out of git (data/aewv/ is ignored) and the site only
// publishes per-institution match results. Fails without touching the previous file if anything is off.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { sha256, parseCsv } from './lib.mjs';

const BASE = 'https://data.nzaei.zemo.bio';
const DIR = new URL('../data/aewv/', import.meta.url);
const CSV = new URL('snapshot.csv', DIR);
const META = new URL('snapshot.json', DIR);
const REQUIRED = ['employer_name', 'trading_name', 'nzbn', 'expiry_date_of_accreditation', 'status_as_at_snapshot', 'last_verified_at'];
const MIN_ROWS = 20000;

async function get(path, as = 'json') {
  const res = await fetch(BASE + path, { headers: { 'user-agent': 'nz-education-finder (github actions)' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return as === 'json' ? res.json() : Buffer.from(await res.arrayBuffer());
}

async function main() {
  const catalog = await get('/catalog.json');
  if (catalog.schema_version !== 1) throw new Error(`unsupported catalog schema ${catalog.schema_version}`);
  const latest = [...catalog.snapshots].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];
  if (!latest) throw new Error('catalog lists no snapshots');

  const current = existsSync(META) ? JSON.parse(await readFile(META, 'utf8')) : null;
  if (current?.sha256 === latest.sha256 && existsSync(CSV)) {
    console.log(`AEWV snapshot ${latest.snapshot_date} already present, skipping`);
    return;
  }

  const buf = await get(latest.csv_path, 'buffer');
  const sum = sha256(buf);
  if (sum !== latest.sha256) throw new Error(`checksum mismatch for ${latest.csv_path}: ${sum}`);
  const rows = parseCsv(buf.toString('utf8'));
  if (rows.length !== latest.row_count) throw new Error(`row count ${rows.length} ≠ catalog ${latest.row_count}`);
  if (rows.length < MIN_ROWS) throw new Error(`only ${rows.length} rows, refusing snapshot`);
  const missing = REQUIRED.filter((c) => !(c in rows[0]));
  if (missing.length) throw new Error(`snapshot missing columns: ${missing.join(', ')}`);

  await mkdir(DIR, { recursive: true });
  await writeFile(new URL('snapshot.csv.tmp', DIR), buf);
  await rename(new URL('snapshot.csv.tmp', DIR), CSV);
  await writeFile(META, JSON.stringify({
    ...latest,
    source: 'NZ Accredited Employer Inspector — Employer Records Snapshot',
    sourceUrl: 'https://nzaei.zemo.bio/open-data/',
    downloadUrl: BASE + latest.csv_path,
    licence: 'NOASSERTION',
    fetchedAt: new Date().toISOString(),
  }, null, 1));
  console.log(`AEWV snapshot ${latest.snapshot_date}: ${rows.length} employers, sha256 ${sum.slice(0, 12)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
