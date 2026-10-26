import { useState } from 'react';
import type { Dataset, Institution } from '../types';
import { LEVEL } from '../aewv';
import { CAT_LABEL, daysSince, displayHost, districtLabel, fmtDate, safeHref } from '../format';
import { JOB_SITES, REPO_URL, STALE_DAYS } from '../config';
import { careersOf, websiteOf } from '../data';
import { MiniMap } from './MapView';
import { JobCard, closed } from './JobsPage';

export function Ext({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  const h = safeHref(href);
  return h ? <a href={h} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span className="muted">链接无效</span>;
}

export function Stale({ date }: { date: string | null }) {
  const d = daysSince(date);
  if (d === null) return <span className="tag warn">核实日期未知</span>;
  return d > STALE_DAYS ? <span className="tag warn">{d} 天未核实，资料可能过期</span> : null;
}

export function Aewv({ ds, r }: { ds: Dataset; r: Institution }) {
  const m = ds.overlays.aewv.matches[r.key];
  const src = ds.overlays.aewv.source;
  return (
    <section className="panel">
      <h2>AEWV 雇主认证对照</h2>
      {!src ? (
        <p><span className="tag">未知／待核实</span> 认证雇主名单暂不可用。</p>
      ) : !m ? (
        <p>
          <span className="tag">未知／待核实</span> 在 {src.snapshotDate} 认证雇主名单快照（{src.employers.toLocaleString()} 个有效雇主）中，未找到与机构名称对应的雇主。
          运营方的法律名称和商号可能都与机构名称不同，部分雇主也选择不公开，因此“未找到”不代表“未认证”。
        </p>
      ) : (
        <>
          <p><span className={`tag ${LEVEL[m.level].cls}`}>{LEVEL[m.level].label}</span> {LEVEL[m.level].note}</p>
          {m.candidates.map((c, i) => (
            <div key={i} className="candidate">
              <div>
                <strong>{c.employer}</strong>
                {c.tradingName && c.tradingName !== c.employer && <span className="muted">（商号 {c.tradingName}）</span>}
                {c.nzbn && <span className="muted"> · NZBN {c.nzbn}</span>}
                {c.expiry && <span className="muted"> · 认证有效期至 {c.expiry}</span>}
              </div>
              <div className="small">
                依据 {c.sourceAsOf ? `${fmtDate(c.sourceAsOf)} 的 INZ 记录` : <span className="tag warn">记录日期未知</span>}，
                {c.verifiedAt ? `${fmtDate(c.verifiedAt)} 核实${c.reviewer ? `（${c.reviewer}）` : ''}` : '尚未人工核实'}
                {' '}<Stale date={c.verifiedAt} />
              </div>
              <ul className="small">{c.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          ))}
        </>
      )}
      <p className="hint">
        匹配对象是机构所关联的法律雇主实体；高／中／低是本项目的证据等级，不是概率或 INZ 官方评级。
        <strong>雇主认证不等于该机构当前岗位提供签证支持，也不代表个人符合签证条件。</strong>
        以 <Ext href="https://www.immigration.govt.nz/work/requirements-for-work-visas/approved-employers/accredited-employer-list/">INZ 官方查询</Ext> 为准。
      </p>
    </section>
  );
}

function OpenJobs({ ds, r }: { ds: Dataset; r: Institution }) {
  const jobs = (ds.jobsByKey.get(r.key) ?? []).filter((j) => !closed(j));
  return (
    <section className="panel">
      <h2>在招职位（Education Gazette）</h2>
      {jobs.length ? (
        <ul className="cards jobs single">{jobs.map((j) => <li key={j.id}><JobCard ds={ds} j={j} /></li>)}</ul>
      ) : (
        <p className="muted">{ds.jobs.source ? `截至 ${fmtDate(ds.jobs.source.fetchedAt, true)}，Education Gazette 上没有该机构的在招职位。` : '职位数据暂不可用。'}</p>
      )}
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
      <h2>其他招聘网站</h2>
      <p className="hint">以下链接打开外部网站，结果由各平台提供；本站不同步、不保证完整或实时。可复制关键词到站内搜索。</p>
      <div className="chips">
        {keywords.map((k) => (
          <button key={k} className="chip" onClick={() => copy(k)} title="复制关键词">{copied === k ? '已复制 ✓' : k}</button>
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
  return <><dt>{k}</dt><dd>{children ?? <span className="muted">未提供</span>}</dd></>;
}

export function DetailPage({ ds, r }: { ds: Dataset; r: Institution }) {
  const batch = ds.batchById.get(r.batch);
  const web = websiteOf(ds, r);
  const careers = careersOf(ds, r);
  const enrichEdit = REPO_URL ? `${REPO_URL}/edit/main/data/enrichments.json` : null;
  const groups = ds.overlays.groups.filter((g) => g.members.includes(r.key));
  const gmaps = r.lat !== null ? `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address ?? ''} ${r.city ?? ''}`)}`;

  return (
    <article className="detail">
      <a href="#/schools" onClick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }} className="back">← 返回结果</a>
      <header>
        <div className="card-top">
          <span className={`tag ${r.cat}`}>{CAT_LABEL[r.cat]}</span>
          <span className="muted">官方 ID {r.id}</span>
          {r.status && r.status !== 'Open' && <span className="tag warn">{r.status}</span>}
          {r.sourceStatus === 'source_missing' && <span className="tag warn">自 {r.missingSince} 起最新官方批次中缺失·待核实（不代表已关闭）</span>}
          {groups.map((g) => <span key={g.id} className="tag">{g.name}</span>)}
        </div>
        <h1>{r.name}</h1>
        <p className="muted">{[r.address, r.suburb, r.city].filter(Boolean).join(', ') || '地址未提供'}</p>
      </header>

      <div className="detail-grid">
        <div>
          <section className="panel">
            <h2>官网与招聘入口</h2>
            <dl>
              <Row k="官网（官方目录）">{web.official && <Ext href={web.official}>{displayHost(web.official)} ↗</Ext>}</Row>
              {web.enriched && (
                <Row k="官网（人工核实）">
                  <Ext href={web.enriched.value}>{displayHost(web.enriched.value)} ↗</Ext>
                  <span className="small muted"> · {fmtDate(web.enriched.verifiedAt)} 核实</span> <Stale date={web.enriched.verifiedAt} />
                </Row>
              )}
              <Row k="Careers／Vacancies">
                {careers && (
                  <>
                    <Ext href={careers.value}>{displayHost(careers.value)} ↗</Ext>
                    <span className="small muted"> · {fmtDate(careers.verifiedAt)} 核实{careers.sourceUrl && <> · <Ext href={careers.sourceUrl}>依据</Ext></>}</span> <Stale date={careers.verifiedAt} />
                  </>
                )}
              </Row>
            </dl>
            {enrichEdit && <p className="hint">管理员：<Ext href={enrichEdit}>在 GitHub 编辑补充资料</Ext>（键 <code>{r.key}</code>；需仓库写权限，修改历史即审计记录）。</p>}
          </section>

          <OpenJobs ds={ds} r={r} />
          <Aewv ds={ds} r={r} />
          <JobSearch r={r} />
        </div>

        <div>
          <section className="panel">
            <h2>官方资料</h2>
            <dl>
              <Row k="类别">{CAT_LABEL[r.cat]}</Row>
              <Row k="机构类型">{r.type}</Row>
              <Row k="Authority">{r.authority}</Row>
              <Row k="Region">{r.region}</Row>
              <Row k="City／District">{r.district && <>{districtLabel(r)}{districtLabel(r) !== r.district && <span className="muted small">（官方：{r.district}）</span>}</>}</Row>
              <Row k="Suburb">{r.suburb}</Row>
              <Row k="在读人数">{r.roll !== null ? <>{r.roll}<span className="muted small">（{r.rollDate ?? '日期未知'}）</span></> : null}</Row>
            </dl>
          </section>
          <section className="panel">
            <h2>位置</h2>
            <MiniMap r={r} />
            <p className="small"><Ext href={gmaps}>在 Google Maps 中打开 ↗</Ext></p>
          </section>
          <section className="panel">
            <h2>来源</h2>
            <dl className="small">
              <Row k="数据来源">{batch ? <Ext href={batch.sourceUrl}>{batch.sourceLabel}</Ext> : r.batch}</Row>
              <Row k="来源更新时间">{fmtDate(batch?.sourceAsOf, true)}</Row>
              <Row k="本站导入时间">{fmtDate(batch?.importedAt, true)}</Row>
              <Row k="首次收录">{r.firstSeen}</Row>
            </dl>
          </section>
        </div>
      </div>
    </article>
  );
}
