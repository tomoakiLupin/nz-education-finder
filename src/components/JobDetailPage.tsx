import { useEffect, useState } from 'react';
import type { ArchivedJob, Dataset, VisaKind } from '../types';
import { CAT_LABEL, displayHost, districtLabel, eroUrl, fmtDate } from '../format';
import { canGoBack } from '../nav';
import { visaKinds, visaLabel } from '../aewv';
import { websiteOf } from '../data';
import { t } from '../i18n';
import { MiniMap } from './MapView';
import { Aewv, Ext, JobSearch, Row } from './DetailPage';
import { JobCard, closed, daysLeft } from './JobsPage';

const list = (xs: string[] | undefined) => (xs?.length ? xs.join(t('，', ', ')) : null);
const INZ = 'https://www.immigration.govt.nz/work/requirements-for-work-visas/approved-employers/accredited-employer-list/';

// Highlight the words that make a sentence visa-relevant, so the key phrase stands out in the quote.
const KEY_WORDS = /\b(visa\w*|residen\w*|citizen\w*|overseas|offshore|international|accredited employer|aewv|sponsor\w*|work rights|right to work|eligible to work|entitled to work|not|unable|only)\b/gi;
function Highlight({ text }: { text: string }) {
  const parts = text.split(KEY_WORDS);
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

function VisaPanel({ j }: { j: ArchivedJob }) {
  const kinds = visaKinds(j.visa);
  const advice: Record<VisaKind, string> = {
    no_overseas: t('广告明确表示不接受海外申请、不提供签证担保或雇主不是认证雇主。持开放签证或已有工作权利的人仍可能适用，请仔细阅读原文。', 'The ad says it will not consider overseas applicants, cannot sponsor a visa, or the employer is not accredited. People who already have work rights may still be eligible — read the ad carefully.'),
    sponsor: t('广告提到雇主是认证雇主或可支持签证，仍需核实具体岗位是否符合 AEWV 条件。', 'The ad says the employer is accredited or can support a visa; still check whether this role qualifies for an AEWV.'),
    residency: t('广告要求（或优先考虑）NZ 公民／居民身份，或已持有有效工作签证、在 NZ 有工作权利。', 'The ad requires (or prefers) NZ citizenship / residency, or an existing valid work visa / right to work in NZ.'),
    other: t('广告提到签证或海外申请人，请阅读原文了解具体要求。', 'The ad mentions visas or overseas applicants — read it for the details.'),
  };
  return (
    <section className={`panel visa-panel${kinds.includes('no_overseas') ? ' bad' : kinds.includes('residency') ? ' warn' : kinds.length ? ' ok' : ''}`}>
      <h2>{t('签证与工作资格', 'Visa & work eligibility')}</h2>
      {j.visa === null || j.visa === undefined ? (
        <p className="muted">{t('尚未读取广告原文，下次更新后显示。', 'The ad text has not been read yet; this will appear after the next update.')}</p>
      ) : !j.visa.length ? (
        <p className="muted">{t('广告原文没有提到签证、居民身份或海外申请人。没提到不代表接受签证申请人，请向学校确认。', 'The ad does not mention visas, residency or overseas applicants. That does not mean visa holders are welcome — ask the school.')}</p>
      ) : (
        <>
          <div className="visa-tags">{kinds.map((k) => <span key={k} className={`tag ${visaLabel(k).cls}`}>{visaLabel(k).label}</span>)}</div>
          <p className="small">{advice[kinds[0]]}</p>
          <ul className="quotes">
            {j.visa.map((v, i) => <li key={i} className={`q-${v.kind}`}><blockquote lang="en"><Highlight text={v.text} /></blockquote></li>)}
          </ul>
          <p className="hint">{t('以上句子摘自 Education Gazette 广告原文（英文原句），由程序自动识别，可能有遗漏或误判，以原文为准。', 'Sentences quoted from the Education Gazette ad and detected automatically; they may be incomplete or misclassified — the ad itself is authoritative.')}</p>
        </>
      )}
    </section>
  );
}

// Short lines without closing punctuation are the ad's own section headings ("About the role", "Why join us?").
const isHeading = (l: string) => l.length <= 40 && !/[.,;:]$/.test(l);

/** The archived ad text, loaded on demand; still readable after the Gazette removes the listing. */
function AdText({ j }: { j: ArchivedJob }) {
  const [text, setText] = useState<string | null | undefined>(j.hasText ? undefined : null);
  useEffect(() => {
    if (!j.hasText) return;
    let live = true;
    fetch(`data/ad/${j.id}.json`).then((r) => (r.ok ? r.json() : null)).then((a) => live && setText(a?.text ?? null), () => live && setText(null));
    return () => { live = false; };
  }, [j.id, j.hasText]);
  return (
    <section className="panel ad-text">
      <h2>{t('广告原文', 'Advertisement')}</h2>
      {text === undefined ? <p className="muted">{t('正在加载…', 'Loading…')}</p>
        : text === null ? <p className="muted">{t('本站没有这则广告的原文（在本站开始保存全文前已下架）。', 'The ad text was not archived here (it was removed before this site started keeping ad texts).')}</p>
        : (
          <>
            <div lang="en">{text.split('\n').map((l, i) => (isHeading(l) ? <h3 key={i}>{l}</h3> : <p key={i}>{l}</p>))}</div>
            <p className="hint">{t('摘自 Education Gazette，版权归刊登学校／机构所有；本站存档的副本已去掉邮箱和电话，联系方式和申请方式请看 Gazette 原文。', 'From Education Gazette; copyright belongs to the advertising school or service. Email addresses and phone numbers are removed from this archived copy — see the Gazette for contact details and how to apply.')}</p>
          </>
        )}
    </section>
  );
}

export function JobDetailPage({ ds, j }: { ds: Dataset; j: ArchivedJob }) {
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
      <a href={isClosed ? '#/archive' : '#/'} onClick={(e) => { if (canGoBack()) { e.preventDefault(); history.back(); } }} className="back">← {t('返回职位列表', 'Back to vacancies')}</a>
      <header>
        <div className="card-top">
          {r && <span className={`tag ${r.cat}`}>{CAT_LABEL[r.cat]}</span>}
          {j.positions.map((x) => <span key={x} className="tag">{x}</span>)}
          {j.beginning && <span className="tag ok">{t('适合新教师', 'Beginning teachers')}</span>}
          {isClosed ? <span className="tag warn">{j.delisted ? t(`已归档 · ${j.delisted} 起不再列出`, `Archived · delisted ${j.delisted}`) : t('已截止', 'Closed')}</span>
            : left <= 3 && <span className="tag warn">{left === 0 ? t('今天截止', 'Closes today') : t(`${left} 天后截止`, `Closes in ${left} day${left > 1 ? 's' : ''}`)}</span>}
        </div>
        <h1>{j.title}</h1>
        <p className="muted">
          {r ? <a href={`#/i/${encodeURIComponent(r.key)}`}>{j.institute}</a> : j.institute}
          {' · '}{r ? [r.suburb, r.city].filter(Boolean).join(', ') || j.region : j.region}
        </p>
      </header>

      <div className="detail-grid">
        <div>
          <VisaPanel j={j} />

          <section className="panel">
            <h2>{t('职位信息', 'Vacancy details')}</h2>
            <dl>
              <Row k={t('截止时间', 'Closes')}>{`${fmtDate(j.closing)}${j.closingTime ? ` ${j.closingTime}` : ''}${t('（NZ 时间）', ' (NZ time)')}`}</Row>
              <Row k={t('职位类型', 'Role')}>{list(j.roles)}</Row>
              <Row k={t('工作性质', 'Position type')}>{list(j.positions)}</Row>
              <Row k={t('学段', 'Sector')}>{list(j.sectors)}</Row>
              <Row k={t('学科领域', 'Learning areas')}>{list(j.learning)}</Row>
              <Row k={t('津贴', 'Allowances')}>{j.allowances}</Row>
              <Row k={t('适合新教师', 'Beginning teachers')}>{j.beginning ? t('是', 'Yes') : t('未标注', 'Not marked')}</Row>
              <Row k={t('Gazette 编号', 'Gazette ref')}>
                {j.ref && <>{j.ref} <button className="chip" onClick={copyRef}>{copied ? t('已复制 ✓', 'Copied ✓') : t('复制', 'Copy')}</button></>}
              </Row>
              <Row k={t('本站首次收录', 'First seen here')}>{j.firstSeen}</Row>
            </dl>
            <div className="apply">
              <a className="btn" href={j.url} target="_blank" rel="noopener noreferrer">{t('在 Education Gazette 查看完整广告并申请 ↗', 'View the full ad and apply on Education Gazette ↗')}</a>
              <p className="hint">{t('联系人和申请方式请看原文；申请直接提交给学校。', 'The contact person and how to apply are on the Gazette; applications go directly to the school.')}</p>
            </div>
          </section>

          <AdText j={j} />

          {r ? <Aewv ds={ds} r={r} /> : (
            <section className="panel">
              <h2>{t('AEWV 雇主认证对照', 'AEWV employer accreditation')}</h2>
              <p><span className="tag">{t('未知／待核实', 'Unknown / unverified')}</span> {t(`招聘方“${j.institute}”未能唯一对应到官方机构目录，无法比对认证名单。请用`, `“${j.institute}” could not be matched to one directory institution, so it cannot be compared with the accredited list. Check with`)} <Ext href={INZ}>{t('INZ 官方查询', 'INZ’s official search')}</Ext>{t(' 核实。', '.')}</p>
            </section>
          )}

          <JobSearch r={r ?? { name: j.institute, cat: 'school', suburb: null, city: j.region }} title={j.title} />

          {others.length > 0 && (
            <section className="panel">
              <h2>{t('该校其他在招职位', 'Other open vacancies at this school')}</h2>
              <ul className="cards jobs single">{others.map((x) => <li key={x.id}><JobCard ds={ds} j={x} /></li>)}</ul>
            </section>
          )}
        </div>

        <div>
          <section className="panel">
            <h2>{t('学校／机构', 'School / centre')}</h2>
            {r ? (
              <dl>
                <Row k={t('名称', 'Name')}><a href={`#/i/${encodeURIComponent(r.key)}`}>{r.name}</a></Row>
                <Row k={t('机构类型', 'Type')}>{r.type}</Row>
                <Row k="Authority">{r.authority}</Row>
                <Row k={t('地址', 'Address')}>{[r.address, r.suburb, r.city].filter(Boolean).join(', ') || null}</Row>
                <Row k={t('City／District', 'City / District')}>{districtLabel(r)}</Row>
                <Row k={t('在读人数', 'Roll')}>{r.roll !== null ? <>{r.roll}<span className="muted small"> ({r.rollDate ?? t('日期未知', 'date unknown')})</span></> : null}</Row>
                <Row k={t('官网', 'Website')}>{web?.official && <Ext href={web.official}>{displayHost(web.official)} ↗</Ext>}</Row>
                <Row k={t('ERO 评估报告', 'ERO reports')}><Ext href={eroUrl(r)}>Education Review Office ↗</Ext></Row>
                <Row k={t('历史职位', 'Past vacancies')}>{(ds.archiveByKey.get(r.key)?.length ?? 0) > 0 ? <a href={`#/i/${encodeURIComponent(r.key)}`}>{t(`本站已归档 ${ds.archiveByKey.get(r.key)!.length} 个`, `${ds.archiveByKey.get(r.key)!.length} archived`)}</a> : t('暂无', 'None yet')}</Row>
              </dl>
            ) : <p className="muted">{t(`“${j.institute}”不在官方机构目录中（或有多个同名机构），没有更多资料。`, `“${j.institute}” is not in the official directory (or several institutions share the name), so there are no further details.`)}</p>}
          </section>
          <section className="panel">
            <h2>{t('位置', 'Location')}</h2>
            {r && <MiniMap r={r} />}
            <p className="small"><Ext href={gmaps}>{t('在 Google Maps 中打开 ↗', 'Open in Google Maps ↗')}</Ext></p>
          </section>
          <section className="panel">
            <h2>{t('来源', 'Sources')}</h2>
            <dl className="small">
              <Row k={t('职位来源', 'Vacancy')}><Ext href={j.url}>Education Gazette</Ext></Row>
              <Row k={t('本站获取', 'Fetched')}>{fmtDate(ds.jobs.source?.fetchedAt, true)}</Row>
              <Row k={t('机构资料', 'Institution')}>{r ? t('Ministry of Education 机构目录', 'Ministry of Education directory') : null}</Row>
            </dl>
          </section>
        </div>
      </div>
    </article>
  );
}
