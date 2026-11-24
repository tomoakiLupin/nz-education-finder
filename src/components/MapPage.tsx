import { useMemo, useState } from 'react';
import type { Dataset } from '../types';
import { applyFilters, distanceOf, filtersFromQuery, filtersToQuery, formatNear, optionsFor, parseNear, pruneInvalid, DEFAULT_FILTERS, RADII, type Filters } from '../filters';
import { CAT_LABEL, districtLabel } from '../format';
import { MapView, fmtKm } from './MapView';
import { Select } from './SearchPage';
import { level } from '../aewv';
import { t } from '../i18n';

// The map page shares the directory's filter model, but starts with "AEWV medium / high only" switched on.
export function mapFiltersFromQuery(qs: string): Filters {
  const p = new URLSearchParams(qs);
  const f = filtersFromQuery(qs);
  f.aewv = p.get('aewv') === 'all' ? '' : p.get('aewv') === 'any' ? 'any' : 'strong';
  f.view = 'map';
  f.sort = parseNear(f.near) ? 'distance' : 'name';
  return f;
}

export function mapFiltersToQuery(f: Filters): string {
  const qs = filtersToQuery({ ...f, aewv: f.aewv === 'strong' ? '' : f.aewv, view: DEFAULT_FILTERS.view, sort: DEFAULT_FILTERS.sort, page: 1 });
  return f.aewv === '' ? (qs ? `${qs}&aewv=all` : 'aewv=all') : qs;
}

const NEAREST = 30;

interface Props { ds: Dataset; f: Filters; setF: (f: Filters) => void; open: (key: string) => void }

export function MapPage({ ds, f, setF, open }: Props) {
  const update = (patch: Partial<Filters>) => setF(pruneInvalid(ds, { ...f, ...patch }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const center = parseNear(f.near);
  const results = useMemo(() => applyFilters(ds, f), [ds, f]);
  const opts = useMemo(() => optionsFor(ds, f), [ds, f]);
  const catCounts = useMemo(() => {
    const c = { all: 0, school: 0, ece: 0 };
    for (const r of applyFilters(ds, { ...f, cat: 'all', type: '' })) { c.all++; c[r.cat]++; }
    return c;
  }, [ds, f]);
  const setCenter = (lat: number, lon: number) => update({ near: formatNear(lat, lon) });

  const locate = () => {
    if (!('geolocation' in navigator)) { setErr(t('此浏览器不支持定位，可以直接在地图上点击选择位置。', 'This browser does not support location; click the map to pick a spot instead.')); return; }
    setBusy(true); setErr(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(false); setCenter(p.coords.latitude, p.coords.longitude); },
      (e) => {
        setBusy(false);
        setErr(e.code === e.PERMISSION_DENIED
          ? t('定位权限被拒绝。请在浏览器网站设置中允许位置访问，或直接在地图上点击选择位置。', 'Location permission was denied. Allow it in your browser’s site settings, or click the map to pick a spot.')
          : e.code === e.TIMEOUT ? t('定位超时，请重试，或在地图上点击选择位置。', 'Locating timed out. Try again, or click the map to pick a spot.')
          : t('无法获取当前位置，可以在地图上点击选择位置。', 'Could not get your location; click the map to pick a spot.'));
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60_000 },
    );
  };

  return (
    <div className="search-layout">
      <aside className="filters" aria-label={t('地图筛选', 'Map filters')}>
        <div className="field">
          <label htmlFor="radius">{t('以我的位置为中心', 'Centred on my location')}</label>
          <div className="near-row">
            <button className={center ? 'btn ghost' : 'btn'} onClick={locate} disabled={busy}>
              {busy ? t('定位中…', 'Locating…') : center ? t('重新定位', 'Locate again') : t('📍 定位我的位置', '📍 Use my location')}
            </button>
            <select id="radius" value={f.radius} onChange={(e) => update({ radius: Number(e.target.value) })} aria-label={t('搜索半径', 'Search radius')}>
              {RADII.map((r) => <option key={r} value={r}>{r} km</option>)}
            </select>
          </div>
          {center && <button className="linklike small" onClick={() => update({ near: '' })}>{t('取消位置，显示全国', 'Clear location, show all of NZ')}</button>}
          {err && <p className="near-err" role="alert">{err}</p>}
          <p className="hint">{t('也可以直接在地图空白处点击，把那里设为中心。位置只在你的浏览器里使用，不会上传；约精确到 100 米。', 'You can also click anywhere on the map to centre there. Your location stays in your browser and is never uploaded; rounded to about 100 m.')}</p>
        </div>
        <div className="seg" role="tablist" aria-label={t('目录类别', 'Directory category')}>
          {(['all', 'school', 'ece'] as const).map((c) => (
            <button key={c} role="tab" aria-selected={f.cat === c} className={f.cat === c ? 'on' : ''} onClick={() => update({ cat: c })}>
              {c === 'all' ? t('全部', 'All') : c === 'ece' ? t('幼儿园 ECE', 'ECE') : t('学校', 'School')} <span className="count">{catCounts[c]}</span>
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="m-aewv">{t('AEWV 认证雇主', 'AEWV accredited employer')}</label>
          <select id="m-aewv" value={f.aewv} onChange={(e) => update({ aewv: e.target.value as Filters['aewv'] })}>
            <option value="strong">{t('仅中／高可信候选', 'Medium / high confidence only')}</option>
            <option value="any">{t('有认证候选（含低可信）', 'Has a candidate (incl. low confidence)')}</option>
            <option value="">{t('不限（显示全部机构）', 'Any (all institutions)')}</option>
          </select>
          <p className="hint">{t('按机构名称与认证名单比对，是线索不是结论；联系前请用 INZ 官方查询核实。', 'Based on matching names to the accredited list — a lead, not a conclusion. Check INZ’s official search before contacting.')}</p>
        </div>
        <Select id="m-type" label={t('机构类型', 'Type')} value={f.type} options={opts.type} onChange={(v) => update({ type: v })} />
      </aside>

      <section className="results" aria-live="polite">
        <div className="toolbar">
          <strong>
            {center
              ? t(`${f.radius} km 内 ${results.length.toLocaleString()} 家`, `${results.length.toLocaleString()} within ${f.radius} km`)
              : t(`全国 ${results.length.toLocaleString()} 家`, `${results.length.toLocaleString()} across NZ`)}
          </strong>
          {center && !results.length && f.radius < RADII[RADII.length - 1] && (
            <button className="btn ghost" onClick={() => update({ radius: RADII.find((r) => r > f.radius)! })}>{t('扩大搜索半径', 'Widen the radius')}</button>
          )}
        </div>
        {!center && <div className="banner info">{t('点「📍 定位我的位置」，或在地图上点一下，即可查看附近的机构并按距离排序。', 'Press “📍 Use my location” or click the map to see nearby institutions sorted by distance.')}</div>}
        <MapView records={results} onOpen={open} center={center} radiusKm={f.radius} distance={(r) => distanceOf(f, r)} onPick={setCenter} />

        {center && results.length > 0 && (
          <>
            <h2 className="nearest-title">{t(`最近的 ${Math.min(NEAREST, results.length)} 家`, `Nearest ${Math.min(NEAREST, results.length)}`)}</h2>
            <ul className="cards">
              {results.slice(0, NEAREST).map((r) => {
                const m = ds.overlays.aewv.matches[r.key];
                const l = m && level(m.level);
                const d = distanceOf(f, r);
                return (
                  <li key={r.key}>
                    <a href={`#/i/${encodeURIComponent(r.key)}`} className="card">
                      <div className="card-top">
                        <span className={`tag ${r.cat}`}>{CAT_LABEL[r.cat]}</span>
                        {l && <span className={`tag ${l.cls}`}>{l.short}</span>}
                        {d != null && <span className="dist small">{fmtKm(d)}</span>}
                      </div>
                      <h3>{r.name}</h3>
                      <p className="muted small">{[r.address, r.suburb, districtLabel(r)].filter(Boolean).join(' · ') || t('地址未提供', 'Address not provided')}</p>
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
