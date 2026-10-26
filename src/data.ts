import type { Batch, Dataset, Institution, JobsData, Overlays } from './types';
import { normalize } from './format';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(new URL(path, document.baseURI));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function loadDataset(): Promise<Dataset> {
  const [inst, batches, overlays, jobs] = await Promise.all([
    getJson<{ generatedAt: string; records: Institution[] }>('data/institutions.json'),
    getJson<Batch[]>('data/batches.json'),
    getJson<Overlays>('data/overlays.json'),
    // Vacancies are optional: the directory still works if this file is missing.
    getJson<JobsData>('data/jobs.json').catch((): JobsData => ({ source: null, jobs: [] })),
  ]);
  const records = inst.records;
  const jobsByKey = new Map<string, JobsData['jobs']>();
  for (const j of jobs.jobs) if (j.key) (jobsByKey.get(j.key) ?? jobsByKey.set(j.key, []).get(j.key)!).push(j);
  return {
    generatedAt: inst.generatedAt,
    records,
    batches,
    overlays,
    jobs,
    jobsByKey,
    byKey: new Map(records.map((r) => [r.key, r])),
    batchById: new Map(batches.map((b) => [b.id, b])),
    search: new Map(records.map((r) => [r.key, `${normalize(r.name)} ${r.id}`])),
  };
}

/** Official baseline + published admin enrichment. The source label travels with the value. */
export function websiteOf(ds: Dataset, r: Institution) {
  const e = ds.overlays.enrichments[r.key]?.website;
  return { official: r.url, enriched: e ?? null };
}

export const careersOf = (ds: Dataset, r: Institution) => ds.overlays.enrichments[r.key]?.careers ?? null;
