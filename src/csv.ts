import type { Dataset, Institution } from './types';
import { CAT_LABEL, districtLabel } from './format';
import { careersOf } from './data';

// Public fields only (F06): no contact names, private notes, applications or documents.
const COLUMNS: [string, (r: Institution, ds: Dataset) => string | number | null][] = [
  ['category', (r) => CAT_LABEL[r.cat]],
  ['official_id', (r) => r.id],
  ['official_name', (r) => r.name],
  ['type', (r) => r.type],
  ['authority', (r) => r.authority],
  ['region', (r) => r.region],
  ['territorial_authority_official', (r) => r.district],
  ['city_district_label', (r) => districtLabel(r)],
  ['suburb', (r) => r.suburb],
  ['city', (r) => r.city],
  ['address', (r) => r.address],
  ['latitude', (r) => r.lat],
  ['longitude', (r) => r.lon],
  ['website_official', (r) => r.url],
  ['website_verified', (r, ds) => ds.overlays.enrichments[r.key]?.website?.value ?? null],
  ['careers_url', (r, ds) => careersOf(ds, r)?.value ?? null],
  ['careers_verified_at', (r, ds) => careersOf(ds, r)?.verifiedAt ?? null],
  ['source_status', (r) => r.sourceStatus],
  ['source', (r, ds) => ds.batchById.get(r.batch)?.sourceUrl ?? null],
  ['source_as_of', (r, ds) => ds.batchById.get(r.batch)?.sourceAsOf ?? null],
  ['imported_at', (r, ds) => ds.batchById.get(r.batch)?.importedAt ?? null],
  ['aewv_evidence_level', (r, ds) => ds.overlays.aewv.matches[r.key]?.level ?? 'unmatched_unknown'],
];

const esc = (v: string | number | null) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function downloadCsv(ds: Dataset, rows: Institution[]) {
  const lines = [COLUMNS.map((c) => c[0]).join(',')];
  for (const r of rows) lines.push(COLUMNS.map(([, get]) => esc(get(r, ds))).join(','));
  const notice = `# Data: Ministry of Education (Education Counts / data.govt.nz), CC BY 4.0. Exported ${new Date().toISOString()}. AEWV level is project evidence grade, not an INZ rating; unmatched does not mean not accredited.`;
  const blob = new Blob(['﻿' + notice + '\r\n' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nz-education-finder-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
