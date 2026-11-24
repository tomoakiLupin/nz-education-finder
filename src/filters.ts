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
  aewv: '' | 'any' | 'strong'; // any AEWV candidate · medium/high confidence only
  near: string; // "lat,lon" of the viewer (rounded), '' = no distance filter
  at: string; // label of a searched place for `near` ('' = the viewer's own location)
  radius: number; // km around `near`
  sort: 'name' | 'suburb' | 'roll' | 'distance';
  page: number;
  view: 'list' | 'map';
}

export const DEFAULT_FILTERS: Filters = {
  q: '', cat: 'all', region: '', district: '', suburb: '', type: '', group: '', missing: false, aewv: '', near: '', at: '', radius: 10, sort: 'name', page: 1, view: 'list',
};

export function filtersFromQuery(qs: string): Filters {
  const p = new URLSearchParams(qs);
  const f = { ...DEFAULT_FILTERS };
  for (const k of ['q', 'region', 'district', 'suburb', 'type', 'group'] as const) f[k] = p.get(k) ?? '';
  f.at = (p.get('at') ?? '').slice(0, 120);
  const cat = p.get('cat');
  if (cat === 'school' || cat === 'ece') f.cat = cat;
  const sort = p.get('sort');
  if (sort === 'suburb' || sort === 'roll' || sort === 'distance') f.sort = sort;
  f.missing = p.get('missing') === '1';
  const a = p.get('aewv');
  if (a === 'any' || a === 'strong') f.aewv = a;
  if (parseNear(p.get('near') ?? '')) f.near = p.get('near')!;
  const radius = Number(p.get('radius'));
  if (RADII.includes(radius)) f.radius = radius;
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

export const RADII = [2, 5, 10, 20, 50, 100];

/** "lat,lon" → coordinates, or null when malformed / outside a plausible range. */
export function parseNear(s: string): { lat: number; lon: number } | null {
  const m = s.match(/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** ~100 m precision: enough for a radius search, and a shared link does not reveal an exact address. */
export const formatNear = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance from the viewer's location, or null when no location is set or the record has no coordinates. */
export function distanceOf(f: Filters, r: Institution): number | null {
  const c = parseNear(f.near);
  return c && r.lat !== null && r.lon !== null ? haversineKm(c, { lat: r.lat, lon: r.lon }) : null;
}

interface Ctx { groupMembers: Set<string> | null; tokens: string[]; near: { lat: number; lon: number } | null }

function matches(ds: Dataset, r: Institution, f: Filters, ctx: Ctx, skip?: keyof Filters): boolean {
  if (!f.missing && r.sourceStatus === 'source_missing') return false;
  if (f.cat !== 'all' && r.cat !== f.cat) return false;
  if (skip !== 'region' && f.region && val(r.region) !== f.region) return false;
  if (skip !== 'district' && f.district && val(districtLabel(r)) !== f.district) return false;
  if (skip !== 'suburb' && f.suburb && val(r.suburb) !== f.suburb) return false;
  if (skip !== 'type' && f.type && `${r.cat}|${val(r.type)}` !== f.type) return false;
  if (ctx.groupMembers && !ctx.groupMembers.has(r.key)) return false;
  if (f.aewv) {
    const m = ds.overlays.aewv.matches[r.key];
    if (!m || (f.aewv === 'strong' && m.level !== 'high' && m.level !== 'medium')) return false;
  }
  if (ctx.near) {
    if (r.lat === null || r.lon === null) return false;
    if (haversineKm(ctx.near, { lat: r.lat, lon: r.lon }) > f.radius) return false;
  }
  if (ctx.tokens.length) {
    const s = ds.search.get(r.key)!;
    if (!ctx.tokens.every((t) => s.includes(t))) return false;
  }
  return true;
}

function context(ds: Dataset, f: Filters): Ctx {
  const g = f.group ? ds.overlays.groups.find((x) => x.id === f.group) : null;
  return { groupMembers: g ? new Set(g.members) : null, tokens: normalize(f.q).split(' ').filter(Boolean), near: parseNear(f.near) };
}

export function applyFilters(ds: Dataset, f: Filters): Institution[] {
  const ctx = context(ds, f);
  const out = ds.records.filter((r) => matches(ds, r, f, ctx));
  const cmp = new Intl.Collator('en', { sensitivity: 'base', numeric: true }).compare;
  if (f.sort === 'distance' && ctx.near) {
    const d = new Map(out.map((r) => [r.key, distanceOf(f, r) ?? Infinity]));
    out.sort((a, b) => d.get(a.key)! - d.get(b.key)! || cmp(a.name, b.name));
  } else if (f.sort === 'name' || f.sort === 'distance') out.sort((a, b) => cmp(a.name, b.name));
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
