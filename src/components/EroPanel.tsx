import { useEffect, useState } from 'react';
import type { Institution } from '../types';
import { eroUrl, fmtDate } from '../format';
import { t } from '../i18n';
import { Ext } from './DetailPage';

/** One institution's latest ERO report, as collected by scripts/fetch-ero.mjs (public/data/ero/<cat>-<id>.json). */
interface EroEntry {
  checkedAt: string;
  url: string;
  title?: string;
  date?: string; // YYYY-MM
  kind?: 'quality' | 'assurance' | 'school' | 'group' | 'other';
  pdf?: string;
  rows?: [string, string][];
  ratings?: [string, string][];
  intl?: boolean;
  past?: { title: string; date: string | null; url: string }[];
}

const KIND: Record<NonNullable<EroEntry['kind']>, [string, string]> = {
  quality: ['质量评估 Akarangi', 'Quality evaluation (Akarangi)'],
  assurance: ['合规审查 Akanuku', 'Assurance review (Akanuku)'],
  school: ['学校评估', 'School review'],
  group: ['运营集团评估', 'Governing organisation review'],
  other: ['评估报告', 'Review report'],
};

// Labels ERO uses on its reports → Chinese. Anything not listed is shown as written by ERO.
const LABEL: Record<string, string> = {
  'The learner and their learning': '学习者与学习',
  'Professional learning and development': '教师专业学习与发展',
  Leadership: '领导力',
  Stewardship: '治理与管理',
  'Health and safety': '健康与安全',
  Curriculum: '课程',
  'Premises and facilities': '场地与设施',
  'Governance, management and administration': '治理、管理与行政',
  'Outcome Indicators': '学习成果',
  'Learning Conditions': '学习条件',
  'Organisational Conditions': '组织条件',
  'How well are learners succeeding?': '学生学业成功程度',
  'What is the quality of teaching and learning?': '教与学的质量',
  'How well does the school curriculum respond to all learners needs?': '课程是否满足所有学生',
  'How well does school planning and conditions support ongoing improvement?': '规划与条件是否支持持续改进',
  'How well does the school include all learners and promote their engagement and wellbeing?': '包容性、学生投入与身心健康',
  'How well does the school partner with parents, whānau and its community for the benefit of learners?': '与家长、whānau 和社区的合作',
  'Student Health and Safety': '学生健康与安全',
  Reading: '阅读',
  Writing: '写作',
  Mathematics: '数学',
};

const LEVEL: Record<string, string> = {
  Excelling: '卓越',
  Embedded: '稳固达标',
  'Working towards': '正在改进（未达标）',
  'Improvement required': '需要改进',
  'Taking reasonable steps': '已采取合理措施',
  Meeting: '符合',
  'Not meeting': '不符合',
};

const GOOD = /^(excelling|embedded|meeting|taking reasonable steps|very well placed|well placed)\b|sustaining|embedding|excelling/i;
const WEAK = /^(working towards|improvement required|not meeting|not well placed|requires further)|emerging|improvements? (are|is) required|needs to improve/i;
const tone = (v: string) => (WEAK.test(v) ? 'warn' : GOOD.test(v) ? 'ok' : '');

function month(d: string | null | undefined) {
  if (!d) return '';
  const [y, m] = d.split('-');
  return t(`${y} 年 ${Number(m)} 月`, new Date(Number(y), Number(m) - 1).toLocaleString('en-NZ', { month: 'short', year: 'numeric' }));
}

const short = (v: string) => v.length <= 40; // a rating ("Embedded"), not a sentence

export function EroPanel({ r }: { r: Institution }) {
  const [e, setE] = useState<EroEntry | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setE(undefined);
    fetch(`data/ero/${r.key.replace(':', '-')}.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((x: EroEntry | null) => live && setE(x), () => live && setE(null));
    return () => { live = false; };
  }, [r.key]);

  if (e === undefined) return null;
  const link = e?.url ?? eroUrl(r);
  const lines = e?.ratings?.length ? e.ratings : e?.rows ?? [];

  return (
    <section className="panel ero">
      <h2>{t('ERO 评估报告', 'ERO review')}</h2>
      {!e ? (
        <p className="muted">{t('还没有收录这家机构的 ERO 报告。', 'No ERO report collected for this institution yet.')} <Ext href={link}>{t('去 ERO 查看', 'Check on ERO')} ↗</Ext></p>
      ) : !e.title ? (
        <p className="muted">{t('ERO 网站上没有这家机构单独的报告页：可能是新开设、还未评估，或由所属的幼儿园协会／运营集团统一评估（可在 ERO 按协会名搜索）。', 'ERO has no separate report page for this institution: it may be new, not yet reviewed, or reviewed as part of its kindergarten association / governing organisation (search ERO for the organisation).')} <Ext href="https://www.ero.govt.nz/review-reports">{t('ERO 报告搜索', 'ERO report search')} ↗</Ext></p>
      ) : (
        <>
          <p>
            <strong>{e.title}</strong>{' '}
            {e.kind && <span className="tag info">{t(...KIND[e.kind])}</span>}
          </p>
          {e.kind === 'group' && (
            <p className="small">{t('这家园所属于一个运营集团，ERO 评估的是整个集团并抽查部分园所；集团报告里列有被走访的园所。', 'This service belongs to a governing organisation; ERO reviews the organisation and visits a sample of its services (listed in the report).')}</p>
          )}
          {lines.length > 0 && (
            <table className="ero-table">
              <tbody>
                {lines.map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row">{t(LABEL[k] ?? k, k)}</th>
                    <td>{short(v) ? <span className={`tag ${tone(v)}`}>{t(LEVEL[v] ?? v, v)}</span> : <span className="small">{v}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {e.ratings?.length ? (
            <p className="hint">{t('评级由低到高：需要改进 → 正在改进 → 稳固达标 → 卓越；“稳固达标”及以上即达到 ERO 的质量门槛。', 'Scale: Improvement required → Working towards → Embedded → Excelling; Embedded or above is above ERO’s quality threshold.')}</p>
          ) : e.kind === 'quality' && e.pdf && !lines.length ? (
            <p className="hint">{t('评级在 PDF 报告第一页。', 'The judgements are on page 1 of the PDF report.')}</p>
          ) : null}
          {e.intl && <p className="small">{t('ERO 也评估了这所学校对国际学生的照顾（Provision for International Students）。', 'ERO also reviewed this school’s provision for international students.')}</p>}
          <p>
            <Ext href={link}>{t('在 ERO 查看完整报告', 'Full report on ERO')} ↗</Ext>
            {e.pdf && <> · <Ext href={e.pdf}>PDF ↗</Ext></>}
          </p>
          {!!e.past?.length && (
            <details>
              <summary className="small">{t(`以往报告（${e.past.length}）`, `Earlier reports (${e.past.length})`)}</summary>
              <ul className="small">
                {e.past.map((p) => <li key={p.url}><Ext href={p.url}>{p.title}</Ext></li>)}
              </ul>
            </details>
          )}
        </>
      )}
      {e && <p className="hint">{t(`内容摘自 Education Review Office 网站，${fmtDate(e?.checkedAt)} 检查；以 ERO 原文为准。`, `From the Education Review Office website, checked ${fmtDate(e?.checkedAt)}; ERO’s own report is authoritative.`)}{e.date && ` ${t('报告时间', 'Report date')}: ${month(e.date)}`}</p>}
    </section>
  );
}
