import { useState } from 'react';
import type { Dataset, Institution } from '../types';
import { level, visaKinds, visaLabel } from '../aewv';
import { CAT_LABEL, daysSince, displayHost, districtLabel, fmtDate, safeHref } from '../format';
import { JOB_SITES, REPO_URL, STALE_DAYS } from '../config';
import { careersOf, websiteOf } from '../data';
import { t, tx } from '../i18n';
import { MiniMap } from './MapView';
import { JobCard, closed } from './JobsPage';

const INZ = 'https://www.immigration.govt.nz/work/requirements-for-work-visas/approved-employers/accredited-employer-list/';

export function Ext({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  const h = safeHref(href);
  return h ? <a href={h} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span className="muted">{t('链接无效', 'Invalid link')}</span>;
}

export function Stale({ date }: { date: string | null }) {
  const d = daysSince(date);
  if (d === null) return <span className="tag warn">{t('核实日期未知', 'Check date unknown')}</span>;
  return d > STALE_DAYS ? <span className="tag warn">{t(`${d} 天未核实，资料可能过期`, `Not checked for ${d} days — may be out of date`)}</span> : null;
}

export function Aewv({ ds, r }: { ds: Dataset; r: Institution }) {
  const m = ds.overlays.aewv.matches[r.key];
  const src = ds.overlays.aewv.source;
  const lv = m && level(m.level);
  return (
    <section className="panel">
      <h2>{t('AEWV 雇主认证对照', 'AEWV employer accreditation')}</h2>
      {!src ? (
        <p><span className="tag">{t('未知／待核实', 'Unknown / unverified')}</span> {t('认证雇主名单暂不可用。', 'The accredited employer list is unavailable.')}</p>
      ) : !m || !lv ? (
        <p>
          <span className="tag">{t('未知／待核实', 'Unknown / unverified')}</span>{' '}
          {t(`在 ${src.snapshotDate} 认证雇主名单快照（${src.employers.toLocaleString()} 个有效雇主）中，未找到与机构名称对应的雇主。运营方的法律名称和商号可能都与机构名称不同，部分雇主也选择不公开，因此“未找到”不代表“未认证”。`,
            `No employer matching this name was found in the ${src.snapshotDate} accredited-employer snapshot (${src.employers.toLocaleString()} current employers). The operator’s legal and trading names may differ from the institution name, and some employers choose not to be listed — “not found” does not mean “not accredited”.`)}
        </p>
      ) : (
        <>
          <p><span className={`tag ${lv.cls}`}>{lv.label}</span> {lv.note}</p>
          {m.candidates.map((c, i) => (
            <div key={i} className="candidate">
              <div>
                <strong>{c.employer}</strong>
                {c.tradingName && c.tradingName !== c.employer && <span className="muted"> ({t('商号', 'trading as')} {c.tradingName})</span>}
                {c.nzbn && <span className="muted"> · NZBN {c.nzbn}</span>}
                {c.expiry && <span className="muted"> · {t('认证有效期至', 'accredited until')} {c.expiry}</span>}
              </div>
              <div className="small">
                {c.sourceAsOf ? t(`依据 ${fmtDate(c.sourceAsOf)} 的 INZ 记录，`, `Based on the INZ record of ${fmtDate(c.sourceAsOf)}; `) : <span className="tag warn">{t('记录日期未知', 'Record date unknown')}</span>}
                {c.verifiedAt ? t(`${fmtDate(c.verifiedAt)} 核实${c.reviewer ? `（${c.reviewer}）` : ''}`, `checked ${fmtDate(c.verifiedAt)}${c.reviewer ? ` (${c.reviewer})` : ''}`) : t('尚未人工核实', 'not manually reviewed')}
                {' '}<Stale date={c.verifiedAt} />
              </div>
              <ul className="small">{c.reasons.map((x, k) => <li key={k}>{tx(x)}</li>)}</ul>
            </div>
          ))}
        </>
      )}
      <p className="hint">
        {t('匹配对象是机构所关联的法律雇主实体；高／中／低是本项目的证据等级，不是概率或 INZ 官方评级。', 'The match is to the legal employer behind the institution; high / medium / low are this site’s evidence levels, not probabilities or INZ ratings. ')}
        <strong>{t('雇主认证不等于该机构当前岗位提供签证支持，也不代表个人符合签证条件。', 'Accreditation does not mean a given vacancy offers visa support, or that you qualify for a visa. ')}</strong>
        {t('以 ', 'Check ')}<Ext href={INZ}>{t('INZ 官方查询', 'INZ’s official search')}</Ext>{t(' 为准。', '.')}
      </p>
    </section>
  );
}

function OpenJobs({ ds, r }: { ds: Dataset; r: Institution }) {
  const jobs = (ds.jobsByKey.get(r.key) ?? []).filter((j) => !closed(j));
  return (
    <section className="panel">
      <h2>{t('在招职位（Education Gazette）', 'Open vacancies (Education Gazette)')}</h2>
      {jobs.length ? (
        <ul className="cards jobs single">{jobs.map((j) => <li key={j.id}><JobCard ds={ds} j={j} /></li>)}</ul>
      ) : (
        <p className="muted">{ds.jobs.source ? t(`截至 ${fmtDate(ds.jobs.source.fetchedAt, true)}，Education Gazette 上没有该机构的在招职位。`, `As of ${fmtDate(ds.jobs.source.fetchedAt, true)}, this institution has no open vacancies on the Education Gazette.`) : t('职位数据暂不可用。', 'Vacancy data is unavailable.')}</p>
      )}
    </section>
  );
}

/** Longitudinal view: every archived vacancy of this institution, with visa statements, by year. */
function PastJobs({ ds, r }: { ds: Dataset; r: Institution }) {
  const past = [...(ds.archiveByKey.get(r.key) ?? [])].sort((a, b) => b.closing.localeCompare(a.closing));
  if (!past.length) return null;
  const years = [...new Set(past.map((j) => j.closing.slice(0, 4)))];
  const roles = new Map<string, number>();
  for (const j of past) for (const x of j.roles) roles.set(x, (roles.get(x) ?? 0) + 1);
  const restricted = past.filter((j) => visaKinds(j.visa).some((k) => k === 'no_overseas' || k === 'residency')).length;
  return (
    <section className="panel">
      <h2>{t(`历史招聘记录（${past.length}）`, `Hiring history (${past.length})`)}</h2>
      <p className="small">
        {t('常招职位：', 'Most advertised roles: ')}{[...roles].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([x, n]) => `${x} ×${n}`).join(', ')}
        {t(` · 其中 ${restricted} 个广告限制居民／不接受海外申请`, ` · ${restricted} ad${restricted === 1 ? '' : 's'} restricted to residents / no overseas applicants`)}
      </p>
      {years.map((y) => (
        <div key={y}>
          <h3 className="year">{y}</h3>
          <ul className="history">
            {past.filter((j) => j.closing.startsWith(y)).map((j) => (
              <li key={j.id}>
                <a href={`#/j/${j.id}`}>{j.title}</a>
                <span className="muted small"> · {j.positions.join(' · ')} · {t('截止', 'closed')} {j.closing}</span>
                {visaKinds(j.visa).map((k) => <span key={k} className={`tag ${visaLabel(k).cls}`}>{visaLabel(k).label}</span>)}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="hint">{t('从 2026-10-27 开始归档。', 'Archived from 2026-10-27.')}</p>
    </section>
  );
}

export function JobSearch({ r, title }: { r: Pick<Institution, 'name' | 'cat' | 'suburb' | 'city'>; title?: string }) {
  const keywords = [...(title ? [`${title} ${r.name}`] : []), r.name, `${r.name} teacher`, `${r.cat === 'ece' ? 'early childhood teacher' : 'teacher'} ${r.suburb ?? r.city ?? ''}`.trim()];
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (k: string) => {
    try { await navigator.clipboard.writeText(k); setCopied(k); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked; text remains selectable */ }
  };
  return (
    <section className="panel">
      <h2>{t('其他招聘网站', 'Other job sites')}</h2>
      <p className="hint">{t('以下链接打开外部网站，结果由各平台提供；本站不同步、不保证完整或实时。可复制关键词到站内搜索。', 'These links open external sites; results come from each platform and are not synced or guaranteed here. Copy a keyword to search with.')}</p>
      <div className="chips">
        {keywords.map((k) => (
          <button key={k} className="chip" onClick={() => copy(k)} title={t('复制关键词', 'Copy keyword')}>{copied === k ? t('已复制 ✓', 'Copied ✓') : k}</button>
        ))}
      </div>
      <ul className="links">
        {JOB_SITES.map((s) => (
          <li key={s.id}><Ext href={s.deepLink ? s.deepLink(keywords[0]) : s.entry}>{s.name} ↗</Ext></li>
        ))}
      </ul>
    </section>
  );
}

export function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <><dt>{k}</dt><dd>{children ?? <span className="muted">{t('未提供', 'Not provided')}</span>}</dd></>;
}

export function DetailPage({ ds, r }: { ds: Dataset; r: Institution }) {
  const batch = ds.batchById.get(r.batch);
  const web = websiteOf(ds, r);
  const careers = careersOf(ds, r);
  const enrichEdit = REPO_URL ? `${REPO_URL}/edit/main/data/enrichments.json` : null;
  const groups = ds.overlays.groups.filter((g) => g.members.includes(r.key));
  const gmaps = r.lat !== null ? `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address ?? ''} ${r.city ?? ''}`)}`;
  const checked = t('核实', 'checked');

  return (
    <article className="detail">
      <a href="#/schools" onClick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }} className="back">← {t('返回', 'Back')}</a>
      <header>
        <div className="card-top">
          <span className={`tag ${r.cat}`}>{CAT_LABEL[r.cat]}</span>
          <span className="muted">{t('官方 ID', 'Official ID')} {r.id}</span>
          {r.status && r.status !== 'Open' && <span className="tag warn">{r.status}</span>}
          {r.sourceStatus === 'source_missing' && <span className="tag warn">{t(`自 ${r.missingSince} 起最新官方批次中缺失·待核实（不代表已关闭）`, `Missing from the latest official batch since ${r.missingSince} — unverified (not necessarily closed)`)}</span>}
          {groups.map((g) => <span key={g.id} className="tag">{g.name}</span>)}
        </div>
        <h1>{r.name}</h1>
        <p className="muted">{[r.address, r.suburb, r.city].filter(Boolean).join(', ') || t('地址未提供', 'Address not provided')}</p>
      </header>

      <div className="detail-grid">
        <div>
          <section className="panel">
            <h2>{t('官网与招聘入口', 'Website & careers')}</h2>
            <dl>
              <Row k={t('官网（官方目录）', 'Website (directory)')}>{web.official && <Ext href={web.official}>{displayHost(web.official)} ↗</Ext>}</Row>
              {web.enriched && (
                <Row k={t('官网（人工核实）', 'Website (verified)')}>
                  <Ext href={web.enriched.value}>{displayHost(web.enriched.value)} ↗</Ext>
                  <span className="small muted"> · {fmtDate(web.enriched.verifiedAt)} {checked}</span> <Stale date={web.enriched.verifiedAt} />
                </Row>
              )}
              <Row k="Careers／Vacancies">
                {careers && (
                  <>
                    <Ext href={careers.value}>{displayHost(careers.value)} ↗</Ext>
                    <span className="small muted"> · {fmtDate(careers.verifiedAt)} {checked}{careers.sourceUrl && <> · <Ext href={careers.sourceUrl}>{t('依据', 'source')}</Ext></>}</span> <Stale date={careers.verifiedAt} />
                  </>
                )}
              </Row>
            </dl>
            {enrichEdit && <p className="hint">{t('管理员：', 'Admins: ')}<Ext href={enrichEdit}>{t('在 GitHub 编辑补充资料', 'edit enrichments on GitHub')}</Ext> ({t('键', 'key')} <code>{r.key}</code>{t('；需仓库写权限，修改历史即审计记录）。', '; needs repository write access — the commit history is the audit log).')}</p>}
          </section>

          <OpenJobs ds={ds} r={r} />
          <Aewv ds={ds} r={r} />
          <PastJobs ds={ds} r={r} />
          <JobSearch r={r} />
        </div>

        <div>
          <section className="panel">
            <h2>{t('官方资料', 'Official details')}</h2>
            <dl>
              <Row k={t('类别', 'Category')}>{CAT_LABEL[r.cat]}</Row>
              <Row k={t('机构类型', 'Type')}>{r.type}</Row>
              <Row k="Authority">{r.authority}</Row>
              <Row k="Region">{r.region}</Row>
              <Row k="City／District">{r.district && <>{districtLabel(r)}{districtLabel(r) !== r.district && <span className="muted small"> ({t('官方', 'official')}: {r.district})</span>}</>}</Row>
              <Row k="Suburb">{r.suburb}</Row>
              <Row k={t('在读人数', 'Roll')}>{r.roll !== null ? <>{r.roll}<span className="muted small"> ({r.rollDate ?? t('日期未知', 'date unknown')})</span></> : null}</Row>
            </dl>
          </section>
          <section className="panel">
            <h2>{t('位置', 'Location')}</h2>
            <MiniMap r={r} />
            <p className="small"><Ext href={gmaps}>{t('在 Google Maps 中打开 ↗', 'Open in Google Maps ↗')}</Ext></p>
          </section>
          <section className="panel">
            <h2>{t('来源', 'Sources')}</h2>
            <dl className="small">
              <Row k={t('数据来源', 'Source')}>{batch ? <Ext href={batch.sourceUrl}>{batch.sourceLabel}</Ext> : r.batch}</Row>
              <Row k={t('来源更新时间', 'Source updated')}>{fmtDate(batch?.sourceAsOf, true)}</Row>
              <Row k={t('本站导入时间', 'Imported')}>{fmtDate(batch?.importedAt, true)}</Row>
              <Row k={t('首次收录', 'First seen')}>{r.firstSeen}</Row>
            </dl>
          </section>
        </div>
      </div>
    </article>
  );
}
