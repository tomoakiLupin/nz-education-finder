import { useMemo } from 'react';
import type { Dataset } from '../types';
import { applyFilters, optionsFor, pruneInvalid, DEFAULT_FILTERS, type Filters, type Option } from '../filters';
import { CAT_LABEL, districtLabel } from '../format';
import { downloadCsv } from '../csv';
import { MapView } from './MapView';

const PAGE_SIZE = 50;

interface Props { ds: Dataset; f: Filters; setF: (f: Filters) => void; open: (key: string) => void }

function Select({ id, label, value, options, onChange, disabledHint }: {
  id: string; label: string; value: string; options: Option[]; onChange: (v: string) => void; disabledHint?: string;
}) {
  const grouped = options.some((o) => o.group);
  const render = (os: Option[]) => os.map((o) => <option key={o.value} value={o.value}>{o.label}（{o.count}）</option>);
  const disabled = !options.length && !value;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{disabled && disabledHint ? disabledHint : '全部'}</option>
        {grouped
          ? (['school', 'ece'] as const).map((g) => {
              const os = options.filter((o) => o.group === g);
              return os.length ? <optgroup key={g} label={CAT_LABEL[g]}>{render(os)}</optgroup> : null;
            })
          : render(options)}
      </select>
    </div>
  );
}

export function SearchPage({ ds, f, setF, open }: Props) {
  const update = (patch: Partial<Filters>) => setF(pruneInvalid(ds, { ...f, ...patch, page: patch.page ?? 1 }));
  const results = useMemo(() => applyFilters(ds, f), [ds, f]);
  const opts = useMemo(() => optionsFor(ds, f), [ds, f]);
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const slice = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const catCounts = useMemo(() => {
    const c = { all: 0, school: 0, ece: 0 };
    for (const r of applyFilters(ds, { ...f, cat: 'all', type: '' })) { c.all++; c[r.cat]++; }
    return c;
  }, [ds, f]);
  const active = JSON.stringify({ ...f, view: '', sort: '', page: 0 }) !== JSON.stringify({ ...DEFAULT_FILTERS, view: '', sort: '', page: 0 });
  const group = ds.overlays.groups.find((g) => g.id === f.group);

  return (
    <div className="search-layout">
      <aside className="filters" aria-label="筛选条件">
        <div className="seg" role="tablist" aria-label="目录类别">
          {(['all', 'school', 'ece'] as const).map((c) => (
            <button key={c} role="tab" aria-selected={f.cat === c} className={f.cat === c ? 'on' : ''} onClick={() => update({ cat: c })}>
              {c === 'all' ? '全部' : CAT_LABEL[c]} <span className="count">{catCounts[c]}</span>
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="q">机构名称或官方 ID</label>
          <input id="q" type="search" value={f.q} placeholder="例如 Takapuna、Kōhanga、544" onChange={(e) => update({ q: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="group">业务分组</label>
          <select id="group" value={f.group} onChange={(e) => update({ group: e.target.value })}>
            <option value="">不限</option>
            {ds.overlays.groups.map((g) => <option key={g.id} value={g.id}>{g.name}（{g.members.length}）</option>)}
          </select>
          {group && <p className="hint">{group.approved ? '已批准' : '草案，待负责人批准'} · {group.definitionVersion}。{group.basis}</p>}
        </div>
        <Select id="region" label="Region" value={f.region} options={opts.region} onChange={(v) => update({ region: v, district: '', suburb: '' })} />
        <Select id="district" label="City／District" value={f.district} options={opts.district} disabledHint="先选择 Region" onChange={(v) => update({ district: v, suburb: '' })} />
        <Select id="suburb" label="Suburb" value={f.suburb} options={opts.suburb} disabledHint="先选择 City／District" onChange={(v) => update({ suburb: v })} />
        <Select id="type" label="机构类型" value={f.type} options={opts.type} onChange={(v) => update({ type: v })} />
        <label className="check">
          <input type="checkbox" checked={f.missing} onChange={(e) => update({ missing: e.target.checked })} />
          包含最新官方批次中缺失（待核实）的机构
        </label>
        {active && <button className="btn ghost" onClick={() => setF({ ...DEFAULT_FILTERS, view: f.view })}>清除全部条件</button>}
      </aside>

      <section className="results" aria-live="polite">
        <div className="toolbar">
          <strong>{results.length.toLocaleString()} 家机构</strong>
          <div className="seg small" role="tablist" aria-label="视图">
            <button role="tab" aria-selected={f.view === 'list'} className={f.view === 'list' ? 'on' : ''} onClick={() => setF({ ...f, view: 'list' })}>列表</button>
            <button role="tab" aria-selected={f.view === 'map'} className={f.view === 'map' ? 'on' : ''} onClick={() => setF({ ...f, view: 'map' })}>地图</button>
          </div>
          <label className="sort">
            排序
            <select value={f.sort} onChange={(e) => update({ sort: e.target.value as Filters['sort'] })}>
              <option value="name">名称</option>
              <option value="suburb">Suburb</option>
              <option value="roll">在读人数</option>
            </select>
          </label>
          <button className="btn" disabled={!results.length} onClick={() => downloadCsv(ds, results)}>导出 CSV</button>
        </div>

        {!results.length ? (
          <div className="empty">
            <p>没有符合条件的机构。</p>
            {active && <button className="btn" onClick={() => setF({ ...DEFAULT_FILTERS, view: f.view })}>清除条件</button>}
          </div>
        ) : f.view === 'map' ? (
          <MapView records={results} onOpen={open} />
        ) : (
          <>
            <ul className="cards">
              {slice.map((r) => (
                <li key={r.key}>
                  <a href={`#/i/${encodeURIComponent(r.key)}`} className="card">
                    <div className="card-top">
                      <span className={`tag ${r.cat}`}>{CAT_LABEL[r.cat]}</span>
                      <span className="muted small">{r.type ?? '类型未提供'}</span>
                      {r.sourceStatus === 'source_missing' && <span className="tag warn">来源缺失·待核实</span>}
                      {ds.overlays.enrichments[r.key]?.careers && <span className="tag ok">Careers</span>}
                    </div>
                    <h3>{r.name}</h3>
                    <p className="muted small">
                      {[r.address, r.suburb, districtLabel(r), r.region].filter(Boolean).join(' · ') || '地址未提供'}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <nav className="pager" aria-label="分页">
                <button className="btn ghost" disabled={page <= 1} onClick={() => setF({ ...f, page: page - 1 })}>上一页</button>
                <span>第 {page} / {pages} 页</span>
                <button className="btn ghost" disabled={page >= pages} onClick={() => setF({ ...f, page: page + 1 })}>下一页</button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
