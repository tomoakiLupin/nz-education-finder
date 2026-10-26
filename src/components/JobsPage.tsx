import { useEffect, useMemo, useState } from 'react';
import type { Dataset, Job } from '../types';
import { LEVEL } from '../aewv';
import { CAT_LABEL, fmtDate, normalize, safeHref } from '../format';
import { JOB_SITES } from '../config';

const PAGE_SIZE = 40;

export interface JobFilters {
  q: string;
  region: string;
  sector: string;
  role: string;
  position: string;
  aewv: '' | 'any' | 'strong'; // any candidate · medium/high only
  beginning: boolean;
  fresh: boolean; // only listings added since the previous visit
  sort: 'closing' | 'latest';
  page: number;
}

export const DEFAULT_JOB_FILTERS: JobFilters = { q: '', region: '', sector: '', role: '', position: '', aewv: '', beginning: false, fresh: false, sort: 'closing', page: 1 };

export function jobFiltersFromQuery(qs: string): JobFilters {
  const p = new URLSearchParams(qs);
  const f = { ...DEFAULT_JOB_FILTERS };
  for (const k of ['q', 'region', 'sector', 'role', 'position'] as const) f[k] = p.get(k) ?? '';
  const a = p.get('aewv');
  if (a === 'any' || a === 'strong') f.aewv = a;
  f.beginning = p.get('beginning') === '1';
  f.fresh = p.get('fresh') === '1';
  if (p.get('sort') === 'latest') f.sort = 'latest';
  f.page = Math.max(1, Number(p.get('page')) || 1);
  return f;
}

export function jobFiltersToQuery(f: JobFilters): string {
  const p = new URLSearchParams();
  (Object.keys(DEFAULT_JOB_FILTERS) as (keyof JobFilters)[]).forEach((k) => {
    const v = f[k];
    if (v === DEFAULT_JOB_FILTERS[k]) return;
    p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  });
  return p.toString();
}

const nzToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
const daysLeft = (iso: string) => Math.round((Date.parse(iso) - Date.parse(nzToday())) / 86_400_000);
const nzHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Pacific/Auckland', hour: 'numeric', minute: 'numeric', hour12: false }).format(new Date()).replace(':', '.'));
/** Gazette closing times are free text ("4pm", "3:00 pm", "12 noon"); unparseable ones count as end of day. */
export function closed(j: Job): boolean {
  const d = daysLeft(j.closing);
  if (d !== 0) return d < 0;
  const m = j.closingTime?.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|noon)/i);
  if (!m) return false;
  const h = (Number(m[1]) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : m[3].toLowerCase() === 'noon' ? 12 : 0);
  return nzHour() >= h + Number(m[2] ?? 0) / 100;
}
// Gazette sector labels carry the te reo name after a slash; the English part is enough for filters.
const sectorLabel = (s: string) => s.split(' / ')[0];

type Facet = 'region' | 'sector' | 'role' | 'position';
const facetValues = (j: Job, k: Facet): string[] =>
  k === 'region' ? (j.region ? [j.region] : []) : k === 'sector' ? j.sectors : k === 'role' ? j.roles : j.positions;

/**
 * "New since last visit": Gazette ids grow with each listing, so remembering the highest id seen is enough.
 * The baseline is pinned for the browser session so a reload doesn't clear the markers. Per-browser only.
 */
function useSeenBaseline(jobs: Job[]): number | null {
  const [baseline, setBaseline] = useState<number | null>(null);
  useEffect(() => {
    if (!jobs.length) return;
    const max = Math.max(...jobs.map((j) => j.id));
    try {
      let b = sessionStorage.getItem('jobs.baseline');
      if (b === null) {
        b = localStorage.getItem('jobs.seenMax') ?? '';
        sessionStorage.setItem('jobs.baseline', b);
      }
      localStorage.setItem('jobs.seenMax', String(Math.max(max, Number(b) || 0)));
      setBaseline(b ? Number(b) : null);
    } catch { /* storage blocked: no "new" markers */ }
  }, [jobs]);
  return baseline;
}

function keep(ds: Dataset, j: Job, f: JobFilters, tokens: string[], skip?: Facet, baseline?: number | null): boolean {
  for (const k of ['region', 'sector', 'role', 'position'] as const) if (k !== skip && f[k] && !facetValues(j, k).includes(f[k])) return false;
  if (f.beginning && !j.beginning) return false;
  if (f.fresh && (baseline == null || j.id <= baseline)) return false;
  if (f.aewv) {
    const m = j.key ? ds.overlays.aewv.matches[j.key] : undefined;
    if (!m || (f.aewv === 'strong' && m.level !== 'high' && m.level !== 'medium')) return false;
  }
  if (tokens.length) {
    const s = normalize(`${j.title} ${j.institute} ${j.ref ?? ''}`);
    if (!tokens.every((t) => s.includes(t))) return false;
  }
  return !closed(j);
}

function JobAewv({ ds, j }: { ds: Dataset; j: Job }) {
  if (!j.key) return <span className="aewv-line"><span className="tag">AEWV 未知</span> <span className="small muted">未能唯一对应到官方机构</span></span>;
  const m = ds.overlays.aewv.matches[j.key];
  if (!m) return <span className="aewv-line"><span className="tag">AEWV 未知</span> <span className="small muted">认证名单中未找到该校雇主（不代表未认证）</span></span>;
  const c = m.candidates[0];
  return (
    <span className="aewv-line">
      <span className={`tag ${LEVEL[m.level].cls}`}>{LEVEL[m.level].short}</span>{' '}
      <span className="small">
        {c.employer}
        {m.candidates.length > 1 && ` 等 ${m.candidates.length} 个`}
        {c.expiry && <span className="muted"> · 有效至 {c.expiry}</span>}
      </span>
    </span>
  );
}

export function JobCard({ ds, j, isNew }: { ds: Dataset; j: Job; isNew?: boolean }) {
  const r = j.key ? ds.byKey.get(j.key) : undefined;
  const left = daysLeft(j.closing);
  return (
    <div className="card job">
      <div className="card-top">
        {isNew && <span className="tag new">新</span>}
        {r && <span className={`tag ${r.cat}`}>{CAT_LABEL[r.cat]}</span>}
        {j.roles.slice(0, 2).map((x) => <span key={x} className="muted small">{x}</span>)}
        {j.beginning && <span className="tag ok">适合新教师</span>}
      </div>
      <h3><a href={safeHref(j.url)} target="_blank" rel="noopener noreferrer">{j.title} ↗</a></h3>
      <p className="small">
        {r ? <a href={`#/i/${encodeURIComponent(r.key)}`}>{j.institute}</a> : j.institute}
        <span className="muted"> · {r ? [r.suburb, r.city].filter(Boolean).join(', ') || j.region : j.region}</span>
      </p>
      <p className="small muted">
        {j.positions.join(' · ')} · 截止 {fmtDate(j.closing)}{j.closingTime ? ` ${j.closingTime}` : ''}
        {left <= 3 && <span className="tag warn">{left === 0 ? '今天截止' : `${left} 天后截止`}</span>}
      </p>
      <JobAewv ds={ds} j={j} />
    </div>
  );
}

const ALERT_HOWTO: Record<string, string> = {
  gazette: '在职位列表页设置条件后订阅邮件提醒',
  seek: '搜索后点 Save search，新职位发邮件／App 推送',
  trademe: '搜索后点 Save this search，新职位发邮件／App 推送',
};

function Alerts() {
  const [copied, setCopied] = useState<string | null>(null);
  const feeds = [
    { id: 'all', file: 'data/feed.xml', label: '全部新职位' },
    { id: 'aewv', file: 'data/feed-aewv.xml', label: '仅雇主有 AEWV 候选' },
  ];
  const copy = async (id: string, url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(id); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked; link stays clickable */ }
  };
  return (
    <div className="alerts">
      <h2>新职位提醒</h2>
      <p className="hint">用 Feedly、Inoreader、Outlook 等阅读器订阅下面的地址。本站每小时更新，有新职位时由阅读器通知你。</p>
      <ul>
        {feeds.map((x) => {
          const url = new URL(x.file, document.baseURI).href;
          return (
            <li key={x.id}>
              <a href={url} target="_blank" rel="noopener noreferrer">{x.label}</a>{' '}
              <button className="chip" onClick={() => copy(x.id, url)}>{copied === x.id ? '已复制 ✓' : '复制订阅地址'}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OtherSites() {
  return (
    <div className="panel other-sites">
      <h2>其他招聘网站</h2>
      <p className="hint">SEEK 和 Trade Me 不允许第三方网站抓取或转载职位，本站无法代为监控。可在各网站开启职位提醒，看到学校名后回本站“机构目录”查认证情况。</p>
      <ul className="site-list">
        {JOB_SITES.map((s) => (
          <li key={s.id}>
            <a href={safeHref(s.entry)} target="_blank" rel="noopener noreferrer nofollow">{s.name} ↗</a>
            <span className="small muted"> · {ALERT_HOWTO[s.id]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props { ds: Dataset; f: JobFilters; setF: (f: JobFilters) => void }

export function JobsPage({ ds, f, setF }: Props) {
  const update = (patch: Partial<JobFilters>) => setF({ ...f, ...patch, page: patch.page ?? 1 });
  const tokens = useMemo(() => normalize(f.q).split(' ').filter(Boolean), [f.q]);
  const baseline = useSeenBaseline(ds.jobs.jobs);
  const isNew = (j: Job) => baseline != null && j.id > baseline;
  const freshCount = useMemo(() => ds.jobs.jobs.filter((j) => isNew(j) && !closed(j)).length, [ds, baseline]);
  const results = useMemo(() => {
    const out = ds.jobs.jobs.filter((j) => keep(ds, j, f, tokens, undefined, baseline));
    return f.sort === 'latest' ? out.sort((a, b) => b.id - a.id) : out.sort((a, b) => a.closing.localeCompare(b.closing) || b.id - a.id);
  }, [ds, f, tokens, baseline]);
  // Facet counts respect every other active filter, so options never lead to an empty list.
  const opts = useMemo(() => {
    const o = {} as Record<Facet, [string, number][]>;
    for (const k of ['region', 'sector', 'role', 'position'] as const) {
      const c = new Map<string, number>();
      for (const j of ds.jobs.jobs) if (keep(ds, j, f, tokens, k, baseline)) for (const v of facetValues(j, k)) c.set(v, (c.get(v) ?? 0) + 1);
      o[k] = [...c].sort((a, b) => b[1] - a[1]);
    }
    return o;
  }, [ds, f, tokens, baseline]);
  const withAewv = useMemo(() => results.filter((j) => j.key && ds.overlays.aewv.matches[j.key]).length, [ds, results]);

  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const slice = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const active = jobFiltersToQuery({ ...f, sort: 'closing', page: 1 }) !== '';
  const src = ds.jobs.source;

  if (!src) return <div className="empty"><p>职位数据暂不可用，请稍后刷新。</p><a className="btn" href="#/schools">浏览机构目录</a></div>;

  const facet = (k: Facet, label: string, fmt: (s: string) => string = (s) => s) => (
    <div className="field">
      <label htmlFor={`j-${k}`}>{label}</label>
      <select id={`j-${k}`} value={f[k]} onChange={(e) => update({ [k]: e.target.value })}>
        <option value="">全部</option>
        {opts[k].map(([v, n]) => <option key={v} value={v}>{fmt(v)}（{n}）</option>)}
        {f[k] && !opts[k].some(([v]) => v === f[k]) && <option value={f[k]}>{fmt(f[k])}（0）</option>}
      </select>
    </div>
  );

  return (
    <div className="search-layout">
      <aside className="filters" aria-label="职位筛选">
        <div className="field">
          <label htmlFor="jq">职位、学校或编号</label>
          <input id="jq" type="search" value={f.q} placeholder="例如 maths、Rangitoto、1HAty_" onChange={(e) => update({ q: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="j-aewv">雇主 AEWV 认证</label>
          <select id="j-aewv" value={f.aewv} onChange={(e) => update({ aewv: e.target.value as JobFilters['aewv'] })}>
            <option value="">不限</option>
            <option value="any">有认证候选（含低可信）</option>
            <option value="strong">仅中／高可信候选</option>
          </select>
          <p className="hint">按学校名称与认证名单比对，是线索不是结论；投递前请用 INZ 官方查询核实。</p>
        </div>
        {facet('region', 'Region')}
        {facet('sector', '学段', sectorLabel)}
        {facet('role', '职位类型')}
        {facet('position', '工作性质')}
        <label className="check">
          <input type="checkbox" checked={f.beginning} onChange={(e) => update({ beginning: e.target.checked })} />
          只看适合新教师（beginning teachers）的职位
        </label>
        {active && <button className="btn ghost" onClick={() => setF({ ...DEFAULT_JOB_FILTERS, sort: f.sort })}>清除全部条件</button>}
        <Alerts />
      </aside>

      <section className="results" aria-live="polite">
        <div className="toolbar">
          <strong>{results.length.toLocaleString()} 个在招职位<span className="muted small">（其中 {withAewv} 个雇主有 AEWV 认证候选）</span></strong>
          {baseline != null && (
            <button className={`chip${f.fresh ? ' on' : ''}`} onClick={() => update({ fresh: !f.fresh })} title="与你上次在本浏览器访问时相比">
              {f.fresh ? '显示全部职位' : `自上次访问新增 ${freshCount} 个`}
            </button>
          )}
          <label className="sort">
            排序
            <select value={f.sort} onChange={(e) => update({ sort: e.target.value as JobFilters['sort'] })}>
              <option value="closing">截止日期最近</option>
              <option value="latest">最新发布</option>
            </select>
          </label>
        </div>
        <p className="hint source-line">
          职位来自 <a href={safeHref(src.url)} target="_blank" rel="noopener noreferrer">Education Gazette</a>（Ministry of Education），
          本站于 {fmtDate(src.fetchedAt, true)} 获取，每小时检查更新。点职位标题查看原文并申请。
          SEEK、Trade Me 的职位看到学校名后，可在 <a href="#/schools">机构目录</a> 搜索该学校查看认证情况。
        </p>
        <OtherSites />

        {!results.length ? (
          <div className="empty">
            <p>没有符合条件的在招职位。</p>
            {active && <button className="btn" onClick={() => setF({ ...DEFAULT_JOB_FILTERS, sort: f.sort })}>清除条件</button>}
          </div>
        ) : (
          <>
            <ul className="cards jobs">
              {slice.map((j) => <li key={j.id}><JobCard ds={ds} j={j} isNew={isNew(j)} /></li>)}
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
