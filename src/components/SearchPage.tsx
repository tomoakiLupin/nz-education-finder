import { useMemo } from 'react';
import type { Dataset } from '../types';
import { applyFilters, optionsFor, pruneInvalid, DEFAULT_FILTERS, type Filters, type Option } from '../filters';
import { CAT_LABEL, districtLabel } from '../format';
import { downloadCsv } from '../csv';
import { MapView } from './MapView';
import { t } from '../i18n';

const PAGE_SIZE = 50;

interface Props { ds: Dataset; f: Filters; setF: (f: Filters) => void; open: (key: string) => void }

function Select({ id, label, value, options, onChange, disabledHint }: {
  id: string; label: string; value: string; options: Option[]; onChange: (v: string) => void; disabledHint?: string;
}) {
  const grouped = options.some((o) => o.group);
  const render = (os: Option[]) => os.map((o) => <option key={o.value} value={o.value}>{o.label} ({o.count})</option>);
  const disabled = !options.length && !value;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{disabled && disabledHint ? disabledHint : t('全部', 'All')}</option>
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
      <aside className="filters" aria-label={t('筛选条件', 'Filters')}>
        <div className="seg" role="tablist" aria-label={t('目录类别', 'Directory category')}>
          {(['all', 'school', 'ece'] as const).map((c) => (
            <button key={c} role="tab" aria-selected={f.cat === c} className={f.cat === c ? 'on' : ''} onClick={() => update({ cat: c })}>
              {c === 'all' ? t('全部', 'All') : CAT_LABEL[c]} <span className="count">{catCounts[c]}</span>
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="q">{t('机构名称或官方 ID', 'Name or official ID')}</label>
          <input id="q" type="search" value={f.q} placeholder={t('例如 Takapuna、Kōhanga、544', 'e.g. Takapuna, Kōhanga, 544')} onChange={(e) => update({ q: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="group">{t('业务分组', 'Area group')}</label>
          <select id="group" value={f.group} onChange={(e) => update({ group: e.target.value })}>
            <option value="">{t('不限', 'Any')}</option>
            {ds.overlays.groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.members.length})</option>)}
          </select>
          {group && <p className="hint">{group.approved ? t('已批准', 'Approved') : t('草案，待负责人批准', 'Draft, awaiting approval')} · {group.definitionVersion}. {group.basis}</p>}
        </div>
        <Select id="region" label="Region" value={f.region} options={opts.region} onChange={(v) => update({ region: v, district: '', suburb: '' })} />
        <Select id="district" label="City／District" value={f.district} options={opts.district} disabledHint={t('先选择 Region', 'Choose a Region first')} onChange={(v) => update({ district: v, suburb: '' })} />
        <Select id="suburb" label="Suburb" value={f.suburb} options={opts.suburb} disabledHint={t('先选择 City／District', 'Choose a City / District first')} onChange={(v) => update({ suburb: v })} />
        <Select id="type" label={t('机构类型', 'Type')} value={f.type} options={opts.type} onChange={(v) => update({ type: v })} />
        <label className="check">
          <input type="checkbox" checked={f.missing} onChange={(e) => update({ missing: e.target.checked })} />
          {t('包含最新官方批次中缺失（待核实）的机构', 'Include institutions missing from the latest official batch (unverified)')}
        </label>
        {active && <button className="btn ghost" onClick={() => setF({ ...DEFAULT_FILTERS, view: f.view })}>{t('清除全部条件', 'Clear all filters')}</button>}
      </aside>

      <section className="results" aria-live="polite">
        <div className="toolbar">
          <strong>{t(`${results.length.toLocaleString()} 家机构`, `${results.length.toLocaleString()} institutions`)}</strong>
          <div className="seg small" role="tablist" aria-label={t('视图', 'View')}>
            <button role="tab" aria-selected={f.view === 'list'} className={f.view === 'list' ? 'on' : ''} onClick={() => setF({ ...f, view: 'list' })}>{t('列表', 'List')}</button>
            <button role="tab" aria-selected={f.view === 'map'} className={f.view === 'map' ? 'on' : ''} onClick={() => setF({ ...f, view: 'map' })}>{t('地图', 'Map')}</button>
          </div>
          <label className="sort">
            {t('排序', 'Sort')}
            <select value={f.sort} onChange={(e) => update({ sort: e.target.value as Filters['sort'] })}>
              <option value="name">{t('名称', 'Name')}</option>
              <option value="suburb">Suburb</option>
              <option value="roll">{t('在读人数', 'Roll')}</option>
            </select>
          </label>
          <button className="btn" disabled={!results.length} onClick={() => downloadCsv(ds, results)}>{t('导出 CSV', 'Export CSV')}</button>
        </div>

        {!results.length ? (
          <div className="empty">
            <p>{t('没有符合条件的机构。', 'No institutions match these filters.')}</p>
            {active && <button className="btn" onClick={() => setF({ ...DEFAULT_FILTERS, view: f.view })}>{t('清除条件', 'Clear filters')}</button>}
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
                      <span className="muted small">{r.type ?? t('类型未提供', 'Type not provided')}</span>
                      {r.sourceStatus === 'source_missing' && <span className="tag warn">{t('来源缺失·待核实', 'Missing from source · unverified')}</span>}
                      {ds.overlays.enrichments[r.key]?.careers && <span className="tag ok">Careers</span>}
                    </div>
                    <h3>{r.name}</h3>
                    <p className="muted small">
                      {[r.address, r.suburb, districtLabel(r), r.region].filter(Boolean).join(' · ') || t('地址未提供', 'Address not provided')}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <nav className="pager" aria-label={t('分页', 'Pages')}>
                <button className="btn ghost" disabled={page <= 1} onClick={() => setF({ ...f, page: page - 1 })}>{t('上一页', 'Previous')}</button>
                <span>{t(`第 ${page} / ${pages} 页`, `Page ${page} of ${pages}`)}</span>
                <button className="btn ghost" disabled={page >= pages} onClick={() => setF({ ...f, page: page + 1 })}>{t('下一页', 'Next')}</button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
