import type { Dataset } from '../types';
import { CAT_LABEL, fmtDate, safeHref } from '../format';
import { REPO_URL } from '../config';
import { t } from '../i18n';

const A = ({ href, children }: { href: string; children: React.ReactNode }) => <a href={safeHref(href)} target="_blank" rel="noopener noreferrer">{children}</a>;

export function AboutPage({ ds }: { ds: Dataset }) {
  const aewv = ds.overlays.aewv.source;
  const jobs = ds.jobs.source;
  const latest = (['school', 'ece'] as const).map((c) => [...ds.batches].reverse().find((b) => b.sourceType === c)).filter(Boolean);
  const visaJobs = ds.jobs.jobs.filter((j) => j.visa?.length).length;
  return (
    <article className="prose">
      <h1>{t('数据与说明', 'About the data')}</h1>

      <h2>{t('职位', 'Vacancies')}</h2>
      {jobs ? (
        <>
          <p>
            {t('来源：', 'Source: ')}<A href={jobs.url}>Education Gazette</A>
            {t('（Ministry of Education 官方教育招聘平台，学校和 ECE 的教职基本都在这里发布）。本站每小时检查一次，有变化就更新。',
              ' (the Ministry of Education’s official education job board, where almost all school and ECE teaching jobs are advertised). Checked hourly and updated when it changes.')}
          </p>
          <ul>
            <li>{t(`获取于 ${fmtDate(jobs.fetchedAt, true)}，在招 ${ds.jobs.jobs.length.toLocaleString()} 个职位，其中 ${ds.jobs.jobs.filter((j) => j.key).length.toLocaleString()} 个能唯一对应到官方机构目录（名称完全一致，同名时用地区区分；对不上的不猜测）。`,
              `Fetched ${fmtDate(jobs.fetchedAt, true)}: ${ds.jobs.jobs.length.toLocaleString()} open vacancies, ${ds.jobs.jobs.filter((j) => j.key).length.toLocaleString()} matched to exactly one directory institution (exact name, region as tie-break; no guessing).`)}</li>
            <li>{t(`签证要求：每个职位的广告原文只读取一次，摘出与签证、居民身份、海外申请人、AEWV／担保有关的句子（目前 ${visaJobs} 个职位有此类句子）并自动分类。广告的其他内容不保存。`,
              `Visa requirements: each ad is read once and only sentences about visas, residency, overseas applicants or AEWV / sponsorship are kept and classified automatically (${visaJobs} open vacancies currently have one). Nothing else from the ad is stored.`)}</li>
            <li>{t('归档：截止或下架的职位保留在仓库的 data/archive/jobs.jsonl 中（职位信息 + 签证句子 + 首次收录／下架日期），用于对比各校历年招聘。从 2026-10-27 开始。',
              'Archive: closed or withdrawn vacancies are kept in data/archive/jobs.jsonl in the repository (listing facts, visa sentences, first-seen and delisted dates) so schools’ hiring can be compared over time. Started 2026-10-27.')}</li>
            <li>{t('不保存联系人：广告里的联系人姓名、电话和邮箱不会被收集或显示。Gazette 对邮箱做了防采集处理；本站和仓库都是公开的，把学校员工的个人联系方式批量存档再公开不合适。联系方式请在原文中查看。',
              'No contact details: contact names, phone numbers and emails in ads are not collected or shown. The Gazette protects emails against harvesting, and this site and its repository are public, so compiling staff contact details here would not be appropriate. See the original ad for contacts.')}</li>
          </ul>
          <p>
            <strong>{t('SEEK 和 Trade Me 为什么没有接入：', 'Why SEEK and Trade Me are not included: ')}</strong>
            {t('SEEK 的使用条款禁止机器人、抓取和在其他网站转载其内容；Trade Me 的 API 需要申请批准，且条款不允许保存或再提供其数据。这两个平台只提供入口链接——请使用它们自带的职位提醒，看到学校名后在“机构目录”查认证情况。',
              'SEEK’s terms prohibit robots, scraping and republishing its content elsewhere; Trade Me’s API requires approval and its terms forbid storing or resupplying its data. Both are linked only — use their own job alerts, then look the school up in the Directory.')}
          </p>
        </>
      ) : <p>{t('职位数据暂不可用。', 'Vacancy data is unavailable.')}</p>}

      <h2>{t('数据批次', 'Directory batches')}</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{t('类别', 'Category')}</th><th>{t('来源更新', 'Source updated')}</th><th>{t('本站导入', 'Imported')}</th><th>{t('行数', 'Rows')}</th><th>{t('新增／变更／缺失', 'Added / changed / missing')}</th><th>{t('校验和', 'Checksum')}</th></tr></thead>
          <tbody>
            {latest.map((b) => b && (
              <tr key={b.id}>
                <td><A href={b.sourceUrl}>{CAT_LABEL[b.sourceType]}</A></td>
                <td>{fmtDate(b.sourceAsOf, true)}</td>
                <td>{fmtDate(b.importedAt, true)}</td>
                <td>{b.counts.valid} / {b.counts.sourceRows}</td>
                <td>{b.counts.added} / {b.counts.changed} / {b.counts.missing}</td>
                <td><code>{b.checksum.slice(0, 12)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        {t('官方目录由 GitHub Actions 每周自动检查一次。新批次先在内存中校验（ID、名称、坐标、重复行），行数骤减超过 20% 时整批拒绝并保留上一可用批次；同一内容重复导入不会产生新批次。在新批次中消失的机构标记为“来源缺失·待核实”，不视为已关闭，也不删除人工补充资料。',
          'The official directory is checked weekly by GitHub Actions. Each batch is validated in memory (IDs, names, coordinates, duplicates); a batch more than 20% smaller is rejected and the last good one kept; re-importing identical content creates no new batch. Institutions that disappear are flagged “missing from source · unverified”, not treated as closed, and their admin enrichments are kept.')}
      </p>

      <h2>{t('AEWV 认证雇主名单', 'AEWV accredited employer list')}</h2>
      {aewv ? (
        <>
          <p>
            {t('来源：', 'Source: ')}<A href={aewv.url}>{aewv.name}</A>
            {t('。该项目以 MBIE 依《官方信息法》（OIA）公布的完整名单为基础，结合 INZ 在线查询逐条复核，约每三天发布一次带校验和的完整快照。INZ 本身不提供整表下载。本站每小时检查一次，有新快照即自动重新匹配并更新，只公开与机构匹配的雇主信息，不转载完整名单。',
              '. It starts from the full list MBIE released under the Official Information Act and re-checks each employer against INZ’s online search, publishing a checksummed full snapshot about every three days (INZ itself offers no download). This site checks hourly, re-matches when a new snapshot appears, and publishes only the employers matched to institutions — not the full list.')}
          </p>
          <ul>
            <li>{t(`快照日期 ${aewv.snapshotDate}，共 ${aewv.rows.toLocaleString()} 条，SHA-256 `, `Snapshot ${aewv.snapshotDate}, ${aewv.rows.toLocaleString()} rows, SHA-256 `)}<code>{aewv.sha256.slice(0, 12)}</code>{t(`，本站获取于 ${fmtDate(aewv.fetchedAt, true)}`, `, fetched ${fmtDate(aewv.fetchedAt, true)}`)}</li>
            <li>{t(`参与匹配的有效认证雇主 ${aewv.employers.toLocaleString()} 个（另有 ${aewv.expiredExcluded.toLocaleString()} 个已过有效期）`, `${aewv.employers.toLocaleString()} currently accredited employers used for matching (${aewv.expiredExcluded.toLocaleString()} expired ones excluded)`)}</li>
            <li>{t(`有匹配候选的机构 ${Object.keys(ds.overlays.aewv.matches).length.toLocaleString()} 家`, `${Object.keys(ds.overlays.aewv.matches).length.toLocaleString()} institutions have a candidate`)}</li>
            <li>{t(`源数据未声明再利用许可（${aewv.licence}），仅作求职参考，请以 INZ 官方查询为准`, `The source declares no reuse licence (${aewv.licence}); for job-search reference only — INZ’s official search is authoritative`)}</li>
          </ul>
          <p>
            {t('匹配规则：高可信 = 已确认机构与雇主关系且 NZBN 在名单中；中可信 = 雇主法律名称或商号与机构名称一致，或 ECE 连锁机构（如 BestStart、Kindercare、Bear Park、Barnardos）的分店名以认证雇主的品牌名开头；低可信 = 名称相似；多个候选 = 同等级有多家雇主。连锁规则只用于 ECE，品牌名不能是地名或普通词，并且全国至少有两家同品牌机构。',
              'Matching: high = confirmed institution–employer link with the NZBN on the list; medium = the employer’s legal or trading name equals the institution name, or an ECE chain branch (e.g. BestStart, Kindercare, Bear Park, Barnardos) whose name starts with the accredited employer’s brand; low = similar name; several = more than one employer at the same level. The chain rule applies to ECE only, the brand cannot be a place name or common word, and at least two centres must share it.')}
          </p>
        </>
      ) : <p>{t('尚未获取。所有机构的 AEWV 状态显示为“未知／待核实”。', 'Not fetched yet; every institution shows AEWV as unknown.')}</p>}

      <h2>{t('口径', 'Definitions')}</h2>
      <ul>
        <li>{t('Region 使用官方 Regional_Council；City／District 使用官方 Territorial_Authority。Auckland 的 School 目录写作 “X Local Board Area”，ECE 目录写作 “Auckland - X”，筛选时统一显示为后者，详情页同时显示官方原值。',
          'Region is the official Regional_Council; City / District is the official Territorial_Authority. Auckland schools use “X Local Board Area” and ECE uses “Auckland - X”; filters show the latter, detail pages also show the official value.')}</li>
        <li>{t('Suburb 使用官方 Add1_Suburb；为空时单列为“未提供”，不强行归类。', 'Suburb is the official Add1_Suburb; blanks are listed as “Not provided”, never guessed.')}</li>
        <li>{t('North Shore 是业务试点分组，不是现行行政区；按 suburb 清单匹配，清单版本见筛选说明，待负责人批准。', 'North Shore is a pilot grouping, not a current administrative area; it is defined by a suburb list (version shown in the filter) pending approval.')}</li>
        <li>{t('机构名称保留官方拼写（含 macron）；搜索对大小写、空格和重音容错。', 'Names keep official spelling (including macrons); search ignores case, spacing and accents.')}</li>
        <li>{t('时间以 UTC 保存，界面按 Pacific/Auckland 显示；仅有日期的字段保留日期精度。', 'Times are stored in UTC and shown in Pacific/Auckland; date-only fields keep date precision.')}</li>
        <li>{t('CSV 仅含公开字段（不含联系人姓名、电话、邮箱、私人备注或申请记录）。', 'CSV exports contain public fields only (no contact names, phones, emails, private notes or applications).')}</li>
      </ul>

      <h2>{t('重要提示', 'Important')}</h2>
      <ul>
        <li>{t('AEWV 对照是有日期的雇主认证线索，不等于岗位提供签证支持或个人符合签证条件；“未找到”不代表“未认证”。', 'AEWV matching is a dated lead about the employer, not a promise of visa support for a vacancy or of your eligibility; “not found” does not mean “not accredited”.')}</li>
        <li>{t('签证句子由程序自动识别，可能遗漏或误判；广告没有提到签证不代表接受签证申请人。', 'Visa sentences are detected automatically and may be incomplete or wrong; an ad that does not mention visas is not necessarily open to visa holders.')}</li>
        <li>{t('外部招聘网站只提供入口链接，本站不抓取、不复制、不同步其内容。', 'External job sites are linked only; their content is not collected, copied or synced.')}</li>
      </ul>

      <h2>{t('署名', 'Attribution')}</h2>
      <p>
        {t('职位：', 'Vacancies: ')}<A href="https://gazette.education.govt.nz/vacancies/">Education Gazette</A> © Ministry of Education.{' '}
        {t('机构目录：', 'Directory: ')}Ministry of Education — <A href="https://catalogue.data.govt.nz/dataset/directory-of-educational-institutions">Directory of educational institutions</A> (data.govt.nz / Education Counts), <A href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</A>{t('，本站对字段做了筛选和标签映射。', '; fields selected and labels mapped by this site.')}{' '}
        {t('AEWV 认证雇主：', 'AEWV employers: ')}NZ Accredited Employer Inspector, Employer Records Snapshot{t('（源数据包括 MBIE 公布的 Immigration New Zealand 信息）。', ' (including Immigration New Zealand information released by MBIE).')}{' '}
        {t('地图：', 'Map: ')}© OpenStreetMap contributors.
      </p>
      {REPO_URL && <p>{t('源代码与修改历史：', 'Source code and change history: ')}<A href={REPO_URL}>{REPO_URL.replace('https://', '')}</A></p>}
    </article>
  );
}
