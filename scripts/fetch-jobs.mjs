// Download current Education Gazette vacancies (Ministry of Education, https://gazette.education.govt.nz/vacancies/).
// The vacancies page loads all live listings from one JSON file; we fetch that same file once per build.
// Only listing facts are kept (title, school, region, categories, closing date) — the ad text is not stored or
// republished; the site links to the Gazette for the full advertisement. Output is git-ignored.
import { writeFile, mkdir, rename } from 'node:fs/promises';
import { sha256 } from './lib.mjs';

export const GAZETTE = 'https://gazette.education.govt.nz/vacancies/';
const DIR = new URL('../data/jobs/', import.meta.url);
const MIN_JOBS = 100;

async function main() {
  const res = await fetch(GAZETTE + 'data.json', { headers: { 'user-agent': 'nz-education-finder (github actions)' } });
  if (!res.ok) throw new Error(`data.json: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const raw = JSON.parse(buf.toString('utf8'));
  if (!Array.isArray(raw)) throw new Error('data.json is not a list');
  if (raw.length < MIN_JOBS) throw new Error(`only ${raw.length} vacancies, refusing`);
  const bad = raw.filter((j) => !j.id || !j.slug || !j.title || !j.institute || !j.closing?.iso);
  if (bad.length > raw.length * 0.05) throw new Error(`${bad.length} vacancies missing required fields`);

  const jobs = raw
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
      beginning: Boolean(j.beginning),
      closing: j.closing.iso,
      closingTime: j.closingTime ?? null,
      url: `${GAZETTE}${encodeURIComponent(j.slug)}/`,
    }));

  await mkdir(DIR, { recursive: true });
  const out = { source: { name: 'Education Gazette', url: GAZETTE, sha256: sha256(buf), count: jobs.length, fetchedAt: new Date().toISOString() }, jobs };
  await writeFile(new URL('gazette.json.tmp', DIR), JSON.stringify(out));
  await rename(new URL('gazette.json.tmp', DIR), new URL('gazette.json', DIR));
  console.log(`Education Gazette: ${jobs.length} vacancies (${bad.length} skipped), sha256 ${out.source.sha256.slice(0, 12)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
