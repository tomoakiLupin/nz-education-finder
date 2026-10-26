import { useState } from 'react';
import type { Dataset, Job } from '../types';
import { CAT_LABEL, displayHost, districtLabel, fmtDate } from '../format';
import { websiteOf } from '../data';
import { MiniMap } from './MapView';
import { Aewv, Ext, JobSearch, Row } from './DetailPage';
import { JobCard, closed, daysLeft } from './JobsPage';

const list = (xs: string[]) => (xs.length ? xs.join('，') : null);

export function JobDetailPage({ ds, j }: { ds: Dataset; j: Job }) {
  const r = j.key ? ds.byKey.get(j.key) : undefined;
  const [copied, setCopied] = useState(false);
  const left = daysLeft(j.closing);
  const isClosed = closed(j);
  const others = r ? (ds.jobsByKey.get(r.key) ?? []).filter((x) => x.id !== j.id && !closed(x)) : [];
  const web = r ? websiteOf(ds, r) : null;
  const gmaps = r?.lat != null
    ? `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${j.institute} ${r?.address ?? ''} ${r?.city ?? j.region ?? ''}`)}`;
  const copyRef = async () => {
    try { await navigator.clipboard.writeText(j.ref ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <article className="detail">
      <a href="#/" onClick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }} className="back">← 返回职位列表</a>
      <header>
        <div className="card-top">
          {r && <span className={`tag ${r.cat}`}>{CAT_LABEL[r.cat]}</span>}
          {j.positions.map((x) => <span key={x} className="tag">{x}</span>)}
          {j.beginning && <span className="tag ok">适合新教师</span>}
          {isClosed ? <span className="tag warn">已截止</span> : left <= 3 && <span className="tag warn">{left === 0 ? '今天截止' : `${left} 天后截止`}</span>}
        </div>
        <h1>{j.title}</h1>
        <p className="muted">
          {r ? <a href={`#/i/${encodeURIComponent(r.key)}`}>{j.institute}</a> : j.institute}
          {' · '}{r ? [r.suburb, r.city].filter(Boolean).join(', ') || j.region : j.region}
        </p>
      </header>

      <div className="detail-grid">
        <div>
          <section className="panel">
            <h2>职位信息</h2>
            <dl>
              <Row k="截止时间">{`${fmtDate(j.closing)}${j.closingTime ? ` ${j.closingTime}` : ''}（NZ 时间）`}</Row>
              <Row k="职位类型">{list(j.roles)}</Row>
              <Row k="工作性质">{list(j.positions)}</Row>
              <Row k="学段">{list(j.sectors)}</Row>
              <Row k="学科领域">{list(j.learning)}</Row>
              <Row k="津贴">{j.allowances}</Row>
              <Row k="适合新教师">{j.beginning ? '是' : '未标注'}</Row>
              <Row k="Gazette 编号">
                {j.ref && <>{j.ref} <button className="chip" onClick={copyRef}>{copied ? '已复制 ✓' : '复制'}</button></>}
              </Row>
            </dl>
            <div className="apply">
              <a className="btn" href={j.url} target="_blank" rel="noopener noreferrer">在 Education Gazette 查看完整广告并申请 ↗</a>
              <p className="hint">广告正文、联系人和申请方式请看原文；申请直接提交给学校，本站不转载广告内容。</p>
            </div>
          </section>

          {r ? <Aewv ds={ds} r={r} /> : (
            <section className="panel">
              <h2>AEWV 雇主认证对照</h2>
              <p><span className="tag">未知／待核实</span> 招聘方“{j.institute}”未能唯一对应到官方机构目录，无法比对认证名单。请用 <Ext href="https://www.immigration.govt.nz/work/requirements-for-work-visas/approved-employers/accredited-employer-list/">INZ 官方查询</Ext> 核实。</p>
            </section>
          )}

          <JobSearch r={r ?? { name: j.institute, cat: 'school', suburb: null, city: j.region }} title={j.title} />

          {others.length > 0 && (
            <section className="panel">
              <h2>该校其他在招职位</h2>
              <ul className="cards jobs single">{others.map((x) => <li key={x.id}><JobCard ds={ds} j={x} /></li>)}</ul>
            </section>
          )}
        </div>

        <div>
          <section className="panel">
            <h2>学校／机构</h2>
            {r ? (
              <dl>
                <Row k="名称"><a href={`#/i/${encodeURIComponent(r.key)}`}>{r.name}</a></Row>
                <Row k="机构类型">{r.type}</Row>
                <Row k="Authority">{r.authority}</Row>
                <Row k="地址">{[r.address, r.suburb, r.city].filter(Boolean).join(', ') || null}</Row>
                <Row k="City／District">{districtLabel(r)}</Row>
                <Row k="在读人数">{r.roll !== null ? <>{r.roll}<span className="muted small">（{r.rollDate ?? '日期未知'}）</span></> : null}</Row>
                <Row k="官网">{web?.official && <Ext href={web.official}>{displayHost(web.official)} ↗</Ext>}</Row>
              </dl>
            ) : <p className="muted">“{j.institute}”不在官方机构目录中（或有多个同名机构），没有更多资料。</p>}
          </section>
          <section className="panel">
            <h2>位置</h2>
            {r && <MiniMap r={r} />}
            <p className="small"><Ext href={gmaps}>在 Google Maps 中打开 ↗</Ext></p>
          </section>
          <section className="panel">
            <h2>来源</h2>
            <dl className="small">
              <Row k="职位来源"><Ext href={j.url}>Education Gazette</Ext></Row>
              <Row k="本站获取">{fmtDate(ds.jobs.source?.fetchedAt, true)}</Row>
              <Row k="机构资料">{r ? 'Ministry of Education 机构目录' : null}</Row>
            </dl>
          </section>
        </div>
      </div>
    </article>
  );
}
