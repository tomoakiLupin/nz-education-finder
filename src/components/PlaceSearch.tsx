import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset } from '../types';
import { normalize } from '../format';
import { t } from '../i18n';

export interface Place { label: string; detail: string; lat: number; lon: number }

// Address search for the map page.
// - While typing: suburbs and institution names from the directory already loaded in the browser (no network),
//   plus street addresses from Photon (komoot's OpenStreetMap geocoder, built for search-as-you-type), debounced.
// - Fallback on Enter when Photon has nothing: OpenStreetMap Nominatim (its policy forbids autocomplete, so it is only
//   called on submit).

const NZ_BBOX = '166.3,-47.4,178.7,-34.3';
const DEBOUNCE_MS = 450;

/** Suburb and town centroids from institution coordinates: "Takapuna, Auckland" → mean position of its institutions. */
function suburbPlaces(ds: Dataset): (Place & { n: string })[] {
  const acc = new Map<string, { label: string; detail: string; lat: number; lon: number; c: number }>();
  const add = (label: string, detail: string, lat: number, lon: number) => {
    const k = `${label}|${detail}`;
    const a = acc.get(k) ?? acc.set(k, { label, detail, lat: 0, lon: 0, c: 0 }).get(k)!;
    a.lat += lat; a.lon += lon; a.c++;
  };
  for (const r of ds.records) {
    if (r.lat === null || r.lon === null) continue;
    const region = (r.region ?? '').replace(/ Region$/, '');
    if (r.suburb && r.suburb !== r.city) add(r.suburb, r.city ?? region, r.lat, r.lon);
    if (r.city) add(r.city, region, r.lat, r.lon); // towns too: "Matakana", "Warkworth"
  }
  return [...acc.values()].map((a) => ({ label: a.label, detail: a.detail, lat: a.lat / a.c, lon: a.lon / a.c, n: normalize(`${a.label} ${a.detail}`) }));
}

async function photon(q: string, signal: AbortSignal): Promise<Place[]> {
  const p = new URLSearchParams({ q, limit: '6', lang: 'en', bbox: NZ_BBOX });
  const res = await fetch(`https://photon.komoot.io/api/?${p}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  type Props = { name?: string; housenumber?: string; street?: string; district?: string; locality?: string; city?: string; state?: string; countrycode?: string };
  const data = (await res.json()) as { features: { properties: Props; geometry: { coordinates: [number, number] } }[] };
  return data.features.filter((f) => f.properties.countrycode === 'NZ').map((f) => {
    const pr = f.properties;
    const street = [pr.housenumber, pr.street].filter(Boolean).join(' ');
    const label = pr.name || street || pr.district || pr.city || '';
    const detail = [...new Set([pr.name ? street : '', pr.district, pr.locality, pr.city, pr.state])].filter((x) => x && x !== label).slice(0, 3).join(', ');
    return { label, detail, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
  }).filter((x) => x.label && Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

async function nominatim(q: string, signal: AbortSignal): Promise<Place[]> {
  const p = new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'nz', limit: '6', addressdetails: '0', 'accept-language': 'en' });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${p}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string; name?: string }[];
  return rows.map((r) => {
    const parts = r.display_name.split(', ');
    const street = /^\d+[a-z]?$/i.test(parts[0]) ? 2 : 1; // "21, Yates Road, …" → "21 Yates Road"
    const label = r.name || parts.slice(0, street).join(' ');
    return { label, detail: parts.slice(r.name ? 1 : street, (r.name ? 1 : street) + 3).join(', '), lat: Number(r.lat), lon: Number(r.lon) };
  }).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

export function PlaceSearch({ ds, onPick }: { ds: Dataset; onPick: (p: Place) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const lastQuery = useRef('');
  const suburbs = useMemo(() => suburbPlaces(ds), [ds]);

  const local = useMemo((): Place[] => {
    const tokens = normalize(q).split(' ').filter(Boolean);
    if (!tokens.length || q.trim().length < 2) return [];
    const hit = (s: string) => tokens.every((tk) => s.split(' ').some((w) => w.startsWith(tk)));
    const subs = suburbs.filter((s) => hit(s.n)).slice(0, 5);
    const insts = ds.records.filter((r) => r.lat !== null && r.lon !== null && r.sourceStatus === 'present' && hit(ds.search.get(r.key)!)).slice(0, 5)
      .map((r) => ({ label: r.name, detail: [r.suburb, r.city].filter(Boolean).join(', '), lat: r.lat!, lon: r.lon! }));
    return [...subs, ...insts];
  }, [q, suburbs, ds]);

  const pick = (p: Place) => { onPick(p); setOpen(false); setQ(p.label); setRemote(null); lastQuery.current = p.label; };

  /** Looks up street addresses. `submit` = the person pressed Enter: also try Nominatim when Photon finds nothing. */
  const lookup = async (query: string, submit: boolean): Promise<Place[] | null> => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true); setErr(null);
    try {
      let rows = await photon(query, ctrl.signal).catch((e) => { if ((e as Error).name === 'AbortError' || !submit) throw e; return [] as Place[]; });
      if (!rows.length && submit) rows = await nominatim(query, ctrl.signal);
      if (ctrl.signal.aborted) return null;
      lastQuery.current = query;
      setRemote(rows);
      if (!rows.length && submit) setErr(t('没找到这个地址，试试加上 Suburb 或城市名，或直接在地图上点击。', 'Address not found; try adding the suburb or city, or click the map.'));
      return rows;
    } catch (e) {
      if ((e as Error).name !== 'AbortError' && submit) setErr(t('地址搜索暂时不可用，可以输入 Suburb 或学校名，或直接在地图上点击。', 'Address search is unavailable right now; type a suburb or school name, or click the map.'));
      return null;
    } finally {
      if (abort.current === ctrl) setBusy(false);
    }
  };

  // Search-as-you-type for addresses (Photon allows it), after a short pause.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) { abort.current?.abort(); setRemote(null); lastQuery.current = ''; return; }
    if (query === lastQuery.current) return;
    const id = setTimeout(() => { lookup(query, false); }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter: go straight to the best match instead of making the person click it.
  const submit = async () => {
    const query = q.trim();
    if (query.length < 2) return;
    const exact = local.find((p) => normalize(p.label) === normalize(query));
    if (exact) { pick(exact); return; }
    let rows = query === lastQuery.current ? remote : null;
    if (!rows && query.length >= 3) { setOpen(true); rows = await lookup(query, true); }
    const first = rows?.[0] ?? local[0];
    if (first) pick(first);
  };

  const list = [...(remote ?? []).map((p) => ({ ...p, kind: 'addr' as const })), ...local.map((p) => ({ ...p, kind: 'local' as const }))];

  return (
    <div className="place-search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <form className="near-row" role="search" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input
          type="search" value={q} aria-label={t('输入地址、Suburb 或学校名', 'Address, suburb or school')}
          placeholder={t('输入地址、Suburb 或学校名', 'Address, suburb or school')} autoComplete="off"
          onChange={(e) => { setQ(e.target.value); setErr(null); setOpen(true); }}
          onFocus={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        />
        <button className="btn ghost" type="submit" disabled={q.trim().length < 2}>{t('搜索', 'Search')}</button>
      </form>
      {open && (list.length > 0 || err || busy) && (
        <ul className="place-list" role="listbox" aria-label={t('地点候选', 'Place suggestions')}>
          {list.map((p, i) => (
            <li key={`${p.kind}-${p.label}-${p.lat}-${i}`}>
              <button type="button" onClick={() => pick(p)}>
                <span className="tag">{p.kind === 'addr' ? t('地址', 'Address') : t('本站数据', 'Directory')}</span> <strong>{p.label}</strong>
                {p.detail && <span className="muted small"> · {p.detail}</span>}
              </button>
            </li>
          ))}
          {err && <li className="near-err">{err}</li>}
          {busy && <li className="muted small">{t('正在查找地址…', 'Looking up addresses…')}</li>}
        </ul>
      )}
      <p className="hint">{t('输入街道地址、Suburb 或学校名，按回车跳到第一个结果。地址查询会把你输入的文字发给 OpenStreetMap 的地理编码服务（Photon／Nominatim）。', 'Type a street address, suburb or school; Enter jumps to the first match. Address lookups send the typed text to OpenStreetMap geocoders (Photon / Nominatim).')}</p>
    </div>
  );
}
