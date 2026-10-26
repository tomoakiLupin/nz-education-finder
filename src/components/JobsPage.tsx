import { useEffect, useMemo, useState } from 'react';
import type { ArchivedJob, Dataset } from '../types';
import { level, visaKinds, visaLabel } from '../aewv';
import { CAT_LABEL, fmtDate, normalize, safeHref } from '../format';
import { JOB_SITES } from '../config';
import { t } from '../i18n';

const PAGE_SIZE = 40;

export interface JobFilters {
  q: string;
  region: string;
  sector: string;
  role: string;
  position: string;
  aewv: '' | 'any' | 'strong'; // any candidate · medium/high only
  visa: '' | 'open' | 'sponsor'; // drop ads restricting to NZ residents/visa holders · only ads mentioning sponsorship
  beginning: boolean;
  fresh: boolean; // only listings added since the previous visit
  sort: 'closing' | 'latest';
  page: number;
}

export const DEFAULT_JOB_FILTERS: JobFilters = { q: '', region: '', sector: '', role: '', position: '', aewv: '', visa: '', beginning: false, fresh: false, sort: 'closing', page: 1 };

export function jobFiltersFromQuery(qs: string): JobFilters {
  const p = new URLSearchParams(qs);
  const f = { ...DEFAULT_JOB_FILTERS };
  for (const k of ['q', 'region', 'sector', 'role', 'position'] as const) f[k] = p.get(k) ?? '';
  const a = p.get('aewv');
  if (a === 'any' || a === 'strong') f.aewv = a;
  const v = p.get('visa');
  if (v === 'open' || v === 'sponsor') f.visa = v;
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
export const daysLeft = (iso: string) => Math.round((Date.parse(iso) - Date.parse(nzToday())) / 86_400_000);
const nzHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Pacific/Auckland', hour: 'numeric', minute: 'numeric', hour12: false }).format(new Date()).replace(':', '.'));
/** Gazette closing times are free text ("4pm", "3:00 pm", "12 noon"); unparseable ones count as end of day. */
export function closed(j: ArchivedJob): boolean {
  if (j.delisted) return true;
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
const facetValues = (j: ArchivedJob, k: Facet): string[] =>
  k === 'region' ? (j.region ? [j.region] : []) : k === 'sector' ? j.sectors : k === 'role' ? j.roles : j.positions;

/**
 * "New since last visit": Gazette ids grow with each listing, so remembering the highest id seen is enough.
 * The baseline is pinned for the browser session so a reload doesn't clear the markers. Per-browser only.
 */
function useSeenBaseline(jobs: ArchivedJob[], enabled: boolean): number | null {
  const [baseline, setBaseline] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !jobs.length) return;
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
  }, [jobs, enabled]);
  return baseline;
}

interface Ctx { ds: Dataset; f: JobFilters; tokens: string[]; baseline: number | null; archive: boolean }

function keep({ ds, f, tokens, baseline, archive }: Ctx, j: ArchivedJob, skip?: Facet): boolean {
  for (const k of ['region', 'sector', 'role', 'position'] as const) if (k !== skip && f[k] && !facetValues(j, k).includes(f[k])) return false;
  if (f.beginning && !j.beginning) return false;
  if (f.fresh && (baseline == null || j.id <= baseline)) return false;
  if (f.aewv) {
    const m = j.key ? ds.overlays.aewv.matches[j.key] : undefined;
    if (!m || (f.aewv === 'strong' && m.level !== 'high' && m.level !== 'medium')) return false;
  }
  if (f.visa) {
    const kinds = visaKinds(j.visa);
    if (f.visa === 'open' && (kinds.includes('no_overseas') || kinds.includes('residency'))) return false;
    if (f.visa === 'sponsor' && !kinds.includes('sponsor')) return false;
  }
  if (tokens.length) {
    const s = normalize(`${j.title} ${j.institute} ${j.ref ?? ''}`);
    if (!tokens.every((x) => s.includes(x))) return false;
  }
  return archive || !closed(j);
}

function JobAewv({ ds, j }: { ds: Dataset; j: ArchivedJob }) {
  if (!j.key) return <span className="aewv-line"><span className="tag">{t('AEWV 未知', 'AEWV unknown')}</span> <span className="small muted">{t('未能唯一对应到官方机构', 'Could not be matched to one directory institution')}</span></span>;
  const m = ds.overlays.aewv.matches[j.key];
  if (!m) return <span className="aewv-line"><span className="tag">{t('AEWV 未知', 'AEWV unknown')}</span> <span className="small muted">{t('认证名单中未找到该校雇主（不代表未认证）', 'Employer not found on the accredited list (not proof it is unaccredited)')}</span></span>;
  const c = m.candidates[0];
  const lv = level(m.level);
  return (
    <span className="aewv-line">
      <span className={`tag ${lv.cls}`}>{lv.short}</span>{' '}
      <span className="small">
        {c.employer}
        {m.candidates.length > 1 && t(` 等 ${m.candidates.length} 个`, ` and ${m.candidates.length - 1} more`)}
        {c.expiry && <span className="muted"> · {t('有效至', 'valid to')} {c.expiry}</span>}
      </span>
    </span>
  );
}

/** Visa badges from sentences quoted in the ad; "unchecked" while the ad text has not been read yet. */
export function VisaTags({ j }: { j: ArchivedJob }) {
  const kinds = visaKinds(j.visa);
  if (!kinds.length) return null;
  return <>{kinds.map((k) => <span key={k} className={`tag ${visaLabel(k).cls}`}>{visaLabel(k).label}</span>)}</>;
}

export function JobCard({ ds, j, isNew }: { ds: Dataset; j: ArchivedJob; isNew?: boolean }) {
  const r = j.key ? ds.byKey.get(j.key) : undefined;
  const left = daysLeft(j.closing);
  const past = closed(j);
  return (
    <div className="card job">
      <div className="card-top">
        {isNew && <span className="tag new">{t('新', 'New')}</span>}
        {past && <span className="tag">{t('已截止', 'Closed')}</span>}
        {r && <span className={`tag ${r.cat}`}>{CAT_LABEL[r.cat]}</span>}
        {j.roles.slice(0, 2).map((x) => <span key={x} className="muted small">{x}</span>)}
        {j.beginning && <span className="tag ok">{t('适合新教师', 'Beginning teachers')}</span>}
      </div>
      <h3><a href={`#/j/${j.id}`}>{j.title}</a></h3>
      <p className="small">
        {r ? <a href={`#/i/${encodeURIComponent(r.key)}`}>{j.institute}</a> : j.institute}
        <span className="muted"> · {r ? [r.suburb, r.city].filter(Boolean).join(', ') || j.region : j.region}</span>
      </p>
      <p className="small muted">
        {j.positions.join(' · ')} · {t('截止', 'Closes')} {fmtDate(j.closing)}{j.closingTime ? ` ${j.closingTime}` : ''}
        {!past && left <= 3 && <span className="tag warn">{left === 0 ? t('今天截止', 'Closes today') : t(`${left} 天后截止`, `Closes in ${left} day${left > 1 ? 's' : ''}`)}</span>}
      </p>
      {visaKinds(j.visa).length > 0 && <p className="visa-tags"><VisaTags j={j} /></p>}
      <JobAewv ds={ds} j={j} />
    </div>
  );
}

const alertHowto = (id: string) => ({
  gazette: t('在职位列表页设置条件后订阅邮件提醒', 'set filters on the vacancies page, then subscribe to email alerts'),
  seek: t('搜索后点 Save search，新职位发邮件／App 推送', 'search, then “Save search” for email / app alerts'),
  trademe: t('搜索后点 Save this search，新职位发邮件／App 推送', 'search, then “Save this search” for email / app alerts'),
} as Record<string, string>)[id];

function Alerts() {
  const [copied, setCopied] = useState<string | null>(null);
  const feeds = [
    { id: 'all', file: 'data/feed.xml', label: t('全部新职位', 'All new vacancies') },
    { id: 'aewv', file: 'data/feed-aewv.xml', label: t('仅雇主有 AEWV 候选', 'Only employers with an AEWV candidate') },
  ];
  const copy = async (id: string, url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(id); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked; link stays clickable */ }
  };
  return (
    <div className="alerts">
      <h2>{t('新职位提醒', 'New vacancy alerts')}</h2>
      <p className="hint">{t('用 Feedly、Inoreader、Outlook 等阅读器订阅下面的地址。本站每小时更新，有新职位时由阅读器通知你。', 'Subscribe to these feeds in Feedly, Inoreader, Outlook or any feed reader. Updated hourly; your reader notifies you of new vacancies.')}</p>
      <ul>
        {feeds.map((x) => {
          const url = new URL(x.file, document.baseURI).href;
          return (
            <li key={x.id}>
              <a href={url} target="_blank" rel="noopener noreferrer">{x.label}</a>{' '}
              <button className="chip" onClick={() => copy(x.id, url)}>{copied === x.id ? t('已复制 ✓', 'Copied ✓') : t('复制订阅地址', 'Copy feed URL')}</button>
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
      <h2>{t('其他招聘网站', 'Other job sites')}</h2>
      <p className="hint">{t('SEEK 和 Trade Me 不允许第三方网站抓取或转载职位，本站无法代为监控。可在各网站开启职位提醒，看到学校名后回本站“机构目录”查认证情况。', 'SEEK and Trade Me do not allow other sites to collect or republish their listings, so this site cannot watch them. Turn on their own alerts, then look the school up in the Directory here to check accreditation.')}</p>
      <ul className="site-list">
        {JOB_SITES.map((s) => (
          <li key={s.id}>
            <a href={safeHref(s.entry)} target="_blank" rel="noopener noreferrer nofollow">{s.name} ↗</a>
            <span className="small muted"> · {alertHowto(s.id)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props { ds: Dataset; f: JobFilters; setF: (f: JobFilters) => void; archive?: boolean }

export function JobsPage({ ds, f, setF, archive = false }: Props) {
  const list: ArchivedJob[] = archive ? ds.archive : ds.jobs.jobs;
  const update = (patch: Partial<JobFilters>) => setF({ ...f, ...patch, page: patch.page ?? 1 });
  const tokens = useMemo(() => normalize(f.q).split(' ').filter(Boolean), [f.q]);
  const baseline = useSeenBaseline(ds.jobs.jobs, !archive);
  const isNew = (j: ArchivedJob) => !archive && baseline != null && j.id > baseline;
  const ctx: Ctx = { ds, f, tokens, baseline, archive };
  const freshCount = useMemo(() => ds.jobs.jobs.filter((j) => baseline != null && j.id > baseline && !closed(j)).length, [ds, baseline]);
  const results = useMemo(() => {
    const out = list.filter((j) => keep(ctx, j));
    if (f.sort === 'latest') return out.sort((a, b) => b.id - a.id);
    // Open vacancies: soonest closing first. Archive: most recently closed first.
    return out.sort((a, b) => (archive ? b.closing.localeCompare(a.closing) : a.closing.localeCompare(b.closing)) || b.id - a.id);
  }, [list, ds, f, tokens, baseline, archive]); // eslint-disable-line react-hooks/exhaustive-deps
  // Facet counts respect every other active filter, so options never lead to an empty list.
  const opts = useMemo(() => {
    const o = {} as Record<Facet, [string, number][]>;
    for (const k of ['region', 'sector', 'role', 'position'] as const) {
      const c = new Map<string, number>();
      for (const j of list) if (keep(ctx, j, k)) for (const v of facetValues(j, k)) c.set(v, (c.get(v) ?? 0) + 1);
      o[k] = [...c].sort((a, b) => b[1] - a[1]);
    }
    return o;
  }, [list, ds, f, tokens, baseline, archive]); // eslint-disable-line react-hooks/exhaustive-deps
  const withAewv = results.filter((j) => j.key && ds.overlays.aewv.matches[j.key]).length;

  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const slice = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const active = jobFiltersToQuery({ ...f, sort: 'closing', page: 1 }) !== '';
  const src = ds.jobs.source;
  const reset = () => setF({ ...DEFAULT_JOB_FILTERS, sort: f.sort });

  if (!src && !archive) return <div className="empty"><p>{t('职位数据暂不可用，请稍后刷新。', 'Vacancy data is unavailable right now. Please refresh later.')}</p><a className="btn" href="#/schools">{t('浏览机构目录', 'Browse the directory')}</a></div>;

  const all = t('全部', 'All');
  const facet = (k: Facet, label: string, fmt: (s: string) => string = (s) => s) => (
    <div className="field">
      <label htmlFor={`j-${k}`}>{label}</label>
      <select id={`j-${k}`} value={f[k]} onChange={(e) => update({ [k]: e.target.value })}>
        <option value="">{all}</option>
        {opts[k].map(([v, n]) => <option key={v} value={v}>{fmt(v)} ({n})</option>)}
        {f[k] && !opts[k].some(([v]) => v === f[k]) && <option value={f[k]}>{fmt(f[k])} (0)</option>}
      </select>
    </div>
  );

  return (
    <div className="search-layout">
      <aside className="filters" aria-label={t('职位筛选', 'Vacancy filters')}>
        <div className="seg" role="tablist">
          <a role="tab" aria-selected={!archive} className={!archive ? 'on' : ''} href="#/">{t('在招', 'Open')} <span className="count">{ds.jobs.jobs.filter((j) => !closed(j)).length}</span></a>
          <a role="tab" aria-selected={archive} className={archive ? 'on' : ''} href="#/archive">{t('历史（已归档）', 'Past (archive)')} <span className="count">{ds.archive.length}</span></a>
        </div>
        <div className="field">
          <label htmlFor="jq">{t('职位、学校或编号', 'Title, school or reference')}</label>
          <input id="jq" type="search" value={f.q} placeholder={t('例如 maths、Rangitoto、1HAty_', 'e.g. maths, Rangitoto, 1HAty_')} onChange={(e) => update({ q: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="j-visa">{t('签证要求（摘自广告原文）', 'Visa requirements (from the ad text)')}</label>
          <select id="j-visa" value={f.visa} onChange={(e) => update({ visa: e.target.value as JobFilters['visa'] })}>
            <option value="">{t('不限', 'Any')}</option>
            <option value="open">{t('排除“仅限居民／不接受海外申请”的职位', 'Hide ads limited to NZ residents / no overseas applicants')}</option>
            <option value="sponsor">{t('只看提及 AEWV／签证担保的职位', 'Only ads mentioning AEWV / visa sponsorship')}</option>
          </select>
          <p className="hint">{t('根据广告正文里与签证、居民身份、海外申请相关的句子自动判断；未提及不代表接受签证申请人。', 'Detected automatically from sentences about visas, residency or overseas applicants in the ad. No mention does not mean visa holders are welcome.')}</p>
        </div>
        <div className="field">
          <label htmlFor="j-aewv">{t('雇主 AEWV 认证', 'Employer AEWV accreditation')}</label>
          <select id="j-aewv" value={f.aewv} onChange={(e) => update({ aewv: e.target.value as JobFilters['aewv'] })}>
            <option value="">{t('不限', 'Any')}</option>
            <option value="any">{t('有认证候选（含低可信）', 'Has a candidate (incl. low confidence)')}</option>
            <option value="strong">{t('仅中／高可信候选', 'Medium / high confidence only')}</option>
          </select>
          <p className="hint">{t('按学校名称与认证名单比对，是线索不是结论；投递前请用 INZ 官方查询核实。', 'Based on matching the school name to the accredited list — a lead, not a conclusion. Check INZ’s official search before applying.')}</p>
        </div>
        {facet('region', 'Region')}
        {facet('sector', t('学段', 'Sector'), sectorLabel)}
        {facet('role', t('职位类型', 'Role'))}
        {facet('position', t('工作性质', 'Position type'))}
        <label className="check">
          <input type="checkbox" checked={f.beginning} onChange={(e) => update({ beginning: e.target.checked })} />
          {t('只看适合新教师（beginning teachers）的职位', 'Suitable for beginning teachers only')}
        </label>
        {active && <button className="btn ghost" onClick={reset}>{t('清除全部条件', 'Clear all filters')}</button>}
        {!archive && <Alerts />}
      </aside>

      <section className="results" aria-live="polite">
        <div className="toolbar">
          <strong>
            {archive ? t(`${results.length.toLocaleString()} 个历史职位`, `${results.length.toLocaleString()} past vacancies`) : t(`${results.length.toLocaleString()} 个在招职位`, `${results.length.toLocaleString()} open vacancies`)}
            <span className="muted small">{t(`（其中 ${withAewv} 个雇主有 AEWV 认证候选）`, ` (${withAewv} with an AEWV employer candidate)`)}</span>
          </strong>
          {!archive && baseline != null && (
            <button className={`chip${f.fresh ? ' on' : ''}`} onClick={() => update({ fresh: !f.fresh })} title={t('与你上次在本浏览器访问时相比', 'Compared with your last visit in this browser')}>
              {f.fresh ? t('显示全部职位', 'Show all') : t(`自上次访问新增 ${freshCount} 个`, `${freshCount} new since last visit`)}
            </button>
          )}
          <label className="sort">
            {t('排序', 'Sort')}
            <select value={f.sort} onChange={(e) => update({ sort: e.target.value as JobFilters['sort'] })}>
              <option value="closing">{archive ? t('最近截止', 'Recently closed') : t('截止日期最近', 'Closing soonest')}</option>
              <option value="latest">{t('最新发布', 'Newest listed')}</option>
            </select>
          </label>
        </div>
        {archive ? (
          <p className="hint source-line">{t('本站从 2026-10-27 开始归档 Education Gazette 职位：截止或下架后仍保留职位信息和签证相关句子，便于对比各校历年招聘情况。原文链接在下架后可能失效。', 'Education Gazette vacancies are archived here from 2026-10-27: listing facts and visa sentences are kept after a vacancy closes, so you can compare schools’ hiring over time. Gazette links may stop working once a listing is removed.')}</p>
        ) : src && (
          <>
            <p className="hint source-line">
              {t('职位来自', 'Vacancies from')} <a href={safeHref(src.url)} target="_blank" rel="noopener noreferrer">Education Gazette</a> (Ministry of Education){t('，本站于 ', ', fetched ')}{fmtDate(src.fetchedAt, true)}{t(' 获取，每小时检查更新。点职位标题查看详情、签证要求、学校位置和认证情况。', ', checked hourly. Open a title for details, visa requirements, school location and accreditation.')}
            </p>
            <OtherSites />
          </>
        )}

        {!results.length ? (
          <div className="empty">
            <p>{t('没有符合条件的职位。', 'No vacancies match these filters.')}</p>
            {active && <button className="btn" onClick={reset}>{t('清除条件', 'Clear filters')}</button>}
          </div>
        ) : (
          <>
            <ul className="cards jobs">
              {slice.map((j) => <li key={j.id}><JobCard ds={ds} j={j} isNew={isNew(j)} /></li>)}
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
