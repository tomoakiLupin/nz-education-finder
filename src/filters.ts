import type { Category, Dataset, Institution } from './types';
import { NONE, districtLabel, noneLabel, normalize } from './format';

export interface Filters {
  q: string;
  cat: 'all' | Category;
  region: string;
  district: string;
  suburb: string;
  type: string; // "<cat>|<type>"
  group: string;
  missing: boolean; // include records no longer in the latest source batch
  sort: 'name' | 'suburb' | 'roll';
  page: number;
  view: 'list' | 'map';
}

export const DEFAULT_FILTERS: Filters = {
  q: '', cat: 'all', region: '', district: '', suburb: '', type: '', group: '', missing: false, sort: 'name', page: 1, view: 'list',
};

export function filtersFromQuery(qs: string): Filters {
  const p = new URLSearchParams(qs);
  const f = { ...DEFAULT_FILTERS };
  for (const k of ['q', 'region', 'district', 'suburb', 'type', 'group'] as const) f[k] = p.get(k) ?? '';
  const cat = p.get('cat');
  if (cat === 'school' || cat === 'ece') f.cat = cat;
  const sort = p.get('sort');
  if (sort === 'suburb' || sort === 'roll') f.sort = sort;
  f.missing = p.get('missing') === '1';
  f.page = Math.max(1, Number(p.get('page')) || 1);
  f.view = p.get('view') === 'map' ? 'map' : 'list';
  return f;
}

export function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams();
  (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).forEach((k) => {
    const v = f[k];
    if (v === DEFAULT_FILTERS[k]) return;
    p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  });
  return p.toString();
}

const val = (v: string | null) => v ?? NONE;

interface Ctx { groupMembers: Set<string> | null; tokens: string[] }

function matches(ds: Dataset, r: Institution, f: Filters, ctx: Ctx, skip?: keyof Filters): boolean {
  if (!f.missing && r.sourceStatus === 'source_missing') return false;
  if (f.cat !== 'all' && r.cat !== f.cat) return false;
  if (skip !== 'region' && f.region && val(r.region) !== f.region) return false;
  if (skip !== 'district' && f.district && val(districtLabel(r)) !== f.district) return false;
  if (skip !== 'suburb' && f.suburb && val(r.suburb) !== f.suburb) return false;
  if (skip !== 'type' && f.type && `${r.cat}|${val(r.type)}` !== f.type) return false;
  if (ctx.groupMembers && !ctx.groupMembers.has(r.key)) return false;
  if (ctx.tokens.length) {
    const s = ds.search.get(r.key)!;
    if (!ctx.tokens.every((t) => s.includes(t))) return false;
  }
  return true;
}

function context(ds: Dataset, f: Filters): Ctx {
  const g = f.group ? ds.overlays.groups.find((x) => x.id === f.group) : null;
  return { groupMembers: g ? new Set(g.members) : null, tokens: normalize(f.q).split(' ').filter(Boolean) };
}

export function applyFilters(ds: Dataset, f: Filters): Institution[] {
  const ctx = context(ds, f);
  const out = ds.records.filter((r) => matches(ds, r, f, ctx));
  const cmp = new Intl.Collator('en', { sensitivity: 'base', numeric: true }).compare;
  if (f.sort === 'name') out.sort((a, b) => cmp(a.name, b.name));
  else if (f.sort === 'suburb') out.sort((a, b) => cmp(a.suburb ?? '￿', b.suburb ?? '￿') || cmp(a.name, b.name));
  else out.sort((a, b) => (b.roll ?? -1) - (a.roll ?? -1) || cmp(a.name, b.name));
  return out;
}

export interface Option { value: string; label: string; count: number; group?: string }

/**
 * Cascading options: each level is computed from the records matching all *other* active filters
 * and its parent levels, so children only ever offer values that are still valid.
 */
export function optionsFor(ds: Dataset, f: Filters) {
  const ctx = context(ds, f);
  const count = (field: 'region' | 'district' | 'suburb' | 'type', get: (r: Institution) => string) => {
    const scope: Filters = { ...f };
    if (field === 'region') Object.assign(scope, { region: '', district: '', suburb: '' });
    if (field === 'district') Object.assign(scope, { district: '', suburb: '' });
    if (field === 'suburb') scope.suburb = '';
    if (field === 'type') scope.type = '';
    const m = new Map<string, number>();
    for (const r of ds.records) if (matches(ds, r, scope, ctx, field)) m.set(get(r), (m.get(get(r)) ?? 0) + 1);
    return m;
  };
  const toOpts = (m: Map<string, number>, label = (v: string) => v): Option[] =>
    [...m].map(([value, c]) => ({ value, label: value === NONE ? noneLabel() : label(value), count: c }))
      .sort((a, b) => (a.value === NONE ? 1 : b.value === NONE ? -1 : a.label.localeCompare(b.label, 'en')));
  return {
    region: toOpts(count('region', (r) => val(r.region))),
    district: f.region ? toOpts(count('district', (r) => val(districtLabel(r)))) : [],
    suburb: f.district ? toOpts(count('suburb', (r) => val(r.suburb))) : [],
    type: toOpts(count('type', (r) => `${r.cat}|${val(r.type)}`), (v) => v.split('|')[1]).map((o) => ({ ...o, group: o.value.split('|')[0] })),
  };
}

/** Drop child selections that are no longer valid after a parent changed (PRD F03). */
export function pruneInvalid(ds: Dataset, f: Filters): Filters {
  let next = f;
  const opts = optionsFor(ds, next);
  if (next.region && !opts.region.some((o) => o.value === next.region)) next = { ...next, region: '', district: '', suburb: '' };
  const o2 = optionsFor(ds, next);
  if (next.district && !o2.district.some((o) => o.value === next.district)) next = { ...next, district: '', suburb: '' };
  const o3 = optionsFor(ds, next);
  if (next.suburb && !o3.suburb.some((o) => o.value === next.suburb)) next = { ...next, suburb: '' };
  if (next.type && !o3.type.some((o) => o.value === next.type)) next = { ...next, type: '' };
  return next;
}
