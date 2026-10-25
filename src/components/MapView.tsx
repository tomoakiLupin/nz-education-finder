import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { TILES } from '../config';
import type { Institution } from '../types';
import { CAT_LABEL } from '../format';

const NZ_BOUNDS = L.latLngBounds([-47.4, 166.3], [-34.3, 178.7]);
// Chatham Islands sit east of the antimeridian (lon ≈ -176); shift them so NZ stays one contiguous view.
const pos = (r: Institution): [number, number] => [r.lat!, r.lon! < 0 ? r.lon! + 360 : r.lon!];

function useLeaflet(el: React.RefObject<HTMLDivElement>, onTileError: () => void) {
  const map = useRef<L.Map | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { preferCanvas: true, worldCopyJump: false }).fitBounds(NZ_BOUNDS);
    let errors = 0;
    L.tileLayer(TILES.url, { attribution: TILES.attribution, maxZoom: TILES.maxZoom })
      .on('tileerror', () => { if (++errors === 6) onTileError(); })
      .addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return map;
}

const markerStyle = (r: Institution): L.CircleMarkerOptions => ({
  radius: 7, weight: 2, color: '#fff', fillOpacity: 0.95,
  // Canvas renderer cannot resolve CSS variables; keep in sync with --school / --ece in styles.css.
  fillColor: r.cat === 'school' ? '#2563eb' : '#c2410c',
});

/** Clustered map that shares the list's filtered result (F07). Records without valid coordinates stay in the list only. */
export function MapView({ records, onOpen }: { records: Institution[]; onOpen: (key: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [tileFail, setTileFail] = useState(false);
  const map = useLeaflet(el, () => setTileFail(true));
  const cluster = useRef<L.MarkerClusterGroup | null>(null);
  const located = records.filter((r) => r.lat !== null && r.lon !== null);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!cluster.current) {
      cluster.current = L.markerClusterGroup({ chunkedLoading: true, showCoverageOnHover: false, maxClusterRadius: 50 });
      m.addLayer(cluster.current);
    }
    const c = cluster.current;
    c.clearLayers();
    const markers = located.map((r) => {
      const mk = L.circleMarker(pos(r), markerStyle(r));
      const div = document.createElement('div');
      const b = document.createElement('button');
      b.className = 'linklike';
      b.textContent = r.name; // textContent: never inject HTML from data
      b.onclick = () => onOpen(r.key);
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = `${CAT_LABEL[r.cat]} · ${r.type ?? '类型未提供'} · ${r.suburb ?? r.city ?? ''}`;
      div.append(b, meta);
      mk.bindPopup(div);
      return mk;
    });
    c.addLayers(markers);
    if (markers.length) {
      const bounds = L.latLngBounds(located.map(pos));
      m.fitBounds(bounds.pad(0.05), { maxZoom: 15 });
    } else m.fitBounds(NZ_BOUNDS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);

  return (
    <div className="map-wrap">
      {tileFail && <div className="banner warn">地图瓦片加载失败，列表与筛选仍可正常使用。</div>}
      <div ref={el} className="map" role="region" aria-label="机构地图" />
      <p className="muted small">
        地图显示 {located.length} 家；{records.length - located.length} 家缺少有效坐标未绘点（仍在列表中）。
        <span className="legend"><i className="dot school" />School <i className="dot ece" />ECE</span>
      </p>
    </div>
  );
}

export function MiniMap({ r }: { r: Institution }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || r.lat === null || r.lon === null) return;
    const m = L.map(el.current, { scrollWheelZoom: false }).setView(pos(r), 15);
    L.tileLayer(TILES.url, { attribution: TILES.attribution, maxZoom: TILES.maxZoom }).addTo(m);
    L.circleMarker(pos(r), markerStyle(r)).addTo(m);
    return () => { m.remove(); };
  }, [r]);
  if (r.lat === null || r.lon === null) return <p className="muted">官方数据未提供有效坐标，不在地图上绘点。</p>;
  return <div ref={el} className="minimap" role="region" aria-label="机构位置地图" />;
}
