import { useMemo, useRef, useState } from 'react';
import type { Dataset } from '../types';
import { normalize } from '../format';
import { t } from '../i18n';

export interface Place { label: string; detail: string; lat: number; lon: number }

// Address search for the map page.
// - While typing: suburbs and institution names from the directory already loaded in the browser (no network).
// - On Enter / "Search": OpenStreetMap Nominatim, NZ only. Its usage policy allows occasional searches from a site
//   (max 1 request/s, no search-as-you-type), so it is only called when the person submits, and never repeated.

/** Suburb centroids from institution coordinates: "Takapuna, Auckland" → mean position of its institutions. */
function suburbPlaces(ds: Dataset): (Place & { n: string })[] {
  const acc = new Map<string, { label: string; detail: string; lat: number; lon: number; c: number }>();
  for (const r of ds.records) {
    if (!r.suburb || r.lat === null || r.lon === null) continue;
    const town = r.city ?? r.region ?? '';
    const k = `${r.suburb}|${town}`;
    const a = acc.get(k) ?? acc.set(k, { label: r.suburb, detail: town, lat: 0, lon: 0, c: 0 }).get(k)!;
    a.lat += r.lat; a.lon += r.lon; a.c++;
  }
  return [...acc.values()].map((a) => ({ label: a.label, detail: a.detail, lat: a.lat / a.c, lon: a.lon / a.c, n: normalize(`${a.label} ${a.detail}`) }));
}

async function geocode(q: string, signal: AbortSignal): Promise<Place[]> {
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

  const pick = (p: Place) => { onPick(p); setOpen(false); setQ(p.label); setRemote(null); };

  const search = async () => {
    const query = q.trim();
    if (query.length < 3 || busy) return;
    if (query === lastQuery.current && remote) { setOpen(true); return; } // same text: reuse, do not ask Nominatim again
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true); setErr(null); setOpen(true);
    try {
      const rows = await geocode(query, ctrl.signal);
      lastQuery.current = query;
      setRemote(rows);
      if (!rows.length) setErr(t('没找到这个地址，试试加上 Suburb 或城市名。', 'Address not found; try adding the suburb or city.'));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr(t('地址搜索暂时不可用，可以输入 Suburb 或学校名，或直接在地图上点击。', 'Address search is unavailable right now; type a suburb or school name, or click the map.'));
    } finally {
      setBusy(false);
    }
  };

  const list = [...(remote ?? []).map((p) => ({ ...p, kind: 'addr' as const })), ...local.map((p) => ({ ...p, kind: 'local' as const }))];

  return (
    <div className="place-search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <form className="near-row" role="search" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input
          type="search" value={q} aria-label={t('输入地址、Suburb 或学校名', 'Address, suburb or school')}
          placeholder={t('输入地址、Suburb 或学校名', 'Address, suburb or school')} autoComplete="off"
          onChange={(e) => { setQ(e.target.value); setRemote(null); setErr(null); setOpen(true); }}
          onFocus={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        />
        <button className="btn ghost" type="submit" disabled={busy || q.trim().length < 3}>{busy ? t('搜索中…', 'Searching…') : t('搜索', 'Search')}</button>
      </form>
      {open && (list.length > 0 || err) && (
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
          {!remote && !busy && q.trim().length >= 3 && <li className="muted small">{t('找不到？按回车搜索街道地址。', 'Not listed? Press Enter to search street addresses.')}</li>}
        </ul>
      )}
      <p className="hint">{t('按回车会把你输入的文字发给 OpenStreetMap Nominatim 查询地址；只输入 Suburb／学校名时不联网。', 'Pressing Enter sends the typed text to OpenStreetMap Nominatim to look up the address; suburb and school suggestions work offline.')}</p>
    </div>
  );
}
