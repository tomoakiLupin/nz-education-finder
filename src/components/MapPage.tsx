import { useMemo, useState } from 'react';
import type { Dataset } from '../types';
import { applyFilters, distanceOf, filtersFromQuery, filtersToQuery, formatNear, optionsFor, parseNear, pruneInvalid, DEFAULT_FILTERS, RADII, type Filters } from '../filters';
import { CAT_LABEL, districtLabel } from '../format';
import { MapView, fmtKm } from './MapView';
import { Select } from './SearchPage';
import { level } from '../aewv';
import { PlaceSearch } from './PlaceSearch';
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
  const setCenter = (lat: number, lon: number, at = '') => update({ near: formatNear(lat, lon), at });

  const locate = () => {
    if (!('geolocation' in navigator)) { setErr(t('此浏览器不支持定位，可以输入地址或直接在地图上点击选择位置。', 'This browser does not support location; type an address or click the map instead.')); return; }
    if (!window.isSecureContext) { setErr(t('定位只能在 https 页面使用。', 'Location only works on https pages.')); return; }
    setBusy(true); setErr(null);
    const ok = (p: GeolocationPosition) => { setBusy(false); setCenter(p.coords.latitude, p.coords.longitude); };
    const fail = (e: GeolocationPositionError) => {
      setBusy(false);
      const why = e.message ? ` (${e.message})` : '';
      setErr(e.code === e.PERMISSION_DENIED
        ? t('浏览器或系统拒绝了定位。请检查：① 浏览器地址栏左侧的网站设置里允许“位置”；② Windows：设置 → 隐私和安全性 → 位置，打开“位置服务”和“允许桌面应用访问你的位置”；Mac：系统设置 → 隐私与安全性 → 定位服务，允许浏览器。也可以直接输入地址。', 'Location was blocked by the browser or the system. Check ① the site settings next to the address bar allow Location; ② Windows: Settings → Privacy & security → Location, turn on Location services and “Let desktop apps access your location”; Mac: System Settings → Privacy & Security → Location Services, allow your browser. Or just type an address.') + why
        : t('暂时拿不到位置（电脑通常要靠 Wi‑Fi 定位，Windows 的“位置服务”需要打开）。可以重试，或直接输入地址／在地图上点击。', 'Could not get a position right now (computers usually locate via Wi‑Fi, and Windows Location services must be on). Try again, or type an address / click the map.') + why);
    };
    // Fast network-based fix first; if that is unavailable or slow, try once more allowing GPS / high accuracy.
    navigator.geolocation.getCurrentPosition(ok, (e) => {
      if (e.code === e.PERMISSION_DENIED) return fail(e);
      navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60_000 });
  };

  return (
    <div className="search-layout">
      <aside className="filters" aria-label={t('地图筛选', 'Map filters')}>
        <div className="field">
          <label htmlFor="radius">{t('中心位置', 'Centre')}</label>
          <PlaceSearch ds={ds} onPick={(p) => setCenter(p.lat, p.lon, p.label)} />
          <div className="near-row">
            <button className={center ? 'btn ghost' : 'btn'} onClick={locate} disabled={busy}>
              {busy ? t('定位中…', 'Locating…') : center && !f.at ? t('重新定位', 'Locate again') : t('📍 定位我的位置', '📍 Use my location')}
            </button>
            <select id="radius" value={f.radius} onChange={(e) => update({ radius: Number(e.target.value) })} aria-label={t('搜索半径', 'Search radius')}>
              {RADII.map((r) => <option key={r} value={r}>{r} km</option>)}
            </select>
          </div>
          {center && <button className="linklike small" onClick={() => update({ near: '', at: '' })}>{t('取消位置，显示全国', 'Clear location, show all of NZ')}</button>}
          {err && <p className="near-err" role="alert">{err}</p>}
          <p className="hint">{t('也可以直接在地图空白处点击，把那里设为中心。定位得到的位置只在你的浏览器里使用，不会上传；约精确到 100 米。', 'You can also click anywhere on the map to centre there. A located position stays in your browser and is never uploaded; rounded to about 100 m.')}</p>
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
              ? t(`${f.at ? `「${f.at}」` : ''}${f.radius} km 内 ${results.length.toLocaleString()} 家`, `${results.length.toLocaleString()} within ${f.radius} km${f.at ? ` of ${f.at}` : ''}`)
              : t(`全国 ${results.length.toLocaleString()} 家`, `${results.length.toLocaleString()} across NZ`)}
          </strong>
          {center && !results.length && f.radius < RADII[RADII.length - 1] && (
            <button className="btn ghost" onClick={() => update({ radius: RADII.find((r) => r > f.radius)! })}>{t('扩大搜索半径', 'Widen the radius')}</button>
          )}
        </div>
        {!center && <div className="banner info">{t('输入地址／Suburb／学校名，或点「📍 定位我的位置」，或在地图上点一下，即可查看附近的机构并按距离排序。', 'Type an address, suburb or school, press “📍 Use my location”, or click the map to see nearby institutions sorted by distance.')}</div>}
        <MapView records={results} onOpen={open} center={center} radiusKm={f.radius} distance={(r) => distanceOf(f, r)} centerLabel={f.at} onPick={(lat, lon) => setCenter(lat, lon, t('地图上选的点', 'Point picked on map'))} />

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
