import type { Dataset } from '../types';
import { CAT_LABEL, fmtDate, safeHref } from '../format';
import { REPO_URL } from '../config';

export function AboutPage({ ds }: { ds: Dataset }) {
  const aewv = ds.overlays.aewv.source;
  const latest =(['school', 'ece'] as const).map((c) => [...ds.batches].reverse().find((b) => b.sourceType === c)).filter(Boolean);
  return (
    <article className="prose">
      <h1>数据与说明</h1>

      <h2>数据批次</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>类别</th><th>来源更新</th><th>本站导入</th><th>行数</th><th>新增／变更／缺失</th><th>校验和</th></tr></thead>
          <tbody>
            {latest.map((b) => b && (
              <tr key={b.id}>
                <td><a href={safeHref(b.sourceUrl)} target="_blank" rel="noopener noreferrer">{CAT_LABEL[b.sourceType]}</a></td>
                <td>{fmtDate(b.sourceAsOf, true)}</td>
                <td>{fmtDate(b.importedAt, true)}</td>
                <td>{b.counts.valid} / {b.counts.sourceRows}</td>
                <td>{b.counts.added}／{b.counts.changed}／{b.counts.missing}</td>
                <td><code>{b.checksum.slice(0, 12)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        官方目录由 GitHub Actions 每周自动检查一次。新批次先在内存中校验（ID、名称、坐标、重复行），行数骤减超过 20% 时整批拒绝并保留上一可用批次；
        同一内容重复导入不会产生新批次。在新批次中消失的机构标记为“来源缺失·待核实”，不视为已关闭，也不删除人工补充资料。
      </p>

      <h2>在招职位</h2>
      {ds.jobs.source ? (
        <>
          <p>
            来源：<a href={safeHref(ds.jobs.source.url)} target="_blank" rel="noopener noreferrer">Education Gazette</a>（Ministry of Education 官方教育招聘平台，学校和 ECE 的教职基本都在这里发布）。
            本站每小时检查一次，有变化就更新；只显示职位标题、学校、地区、类别和截止日期，<strong>不转载广告正文</strong>，详情和申请请点进原文。
          </p>
          <ul>
            <li>获取于 {fmtDate(ds.jobs.source.fetchedAt, true)}，在招 {ds.jobs.jobs.length.toLocaleString()} 个职位，
              其中 {ds.jobs.jobs.filter((j) => j.key).length.toLocaleString()} 个能唯一对应到官方机构目录（按名称完全一致，同名时用地区区分；对不上的不猜测）</li>
          </ul>
          <p>
            <strong>SEEK 和 Trade Me 为什么没有接入：</strong>SEEK 的使用条款禁止机器人、抓取和在其他网站转载其内容；
            Trade Me 的 API 需要申请批准，且条款不允许保存或再提供其数据。因此这两个平台只提供入口链接——看到学校名后，在“机构目录”搜索即可查看该校的认证情况。
          </p>
        </>
      ) : <p>职位数据暂不可用。</p>}

      <h2>AEWV 认证雇主名单</h2>
      {aewv ? (
        <>
          <p>
            来源：<a href={safeHref(aewv.url)} target="_blank" rel="noopener noreferrer">{aewv.name}</a>。
            该项目以 MBIE 依《官方信息法》（OIA）公布的完整名单为基础，结合 INZ 在线查询逐条复核，约每三天发布一次带校验和的完整快照。
            INZ 本身不提供整表下载。本站每小时检查一次，有新快照即自动重新匹配并更新，只公开与机构匹配的雇主信息，不转载完整名单。
          </p>
          <ul>
            <li>快照日期 {aewv.snapshotDate}，共 {aewv.rows.toLocaleString()} 条，SHA-256 <code>{aewv.sha256.slice(0, 12)}</code>，本站获取于 {fmtDate(aewv.fetchedAt, true)}</li>
            <li>参与匹配的有效认证雇主 {aewv.employers.toLocaleString()} 个（另有 {aewv.expiredExcluded.toLocaleString()} 个已过有效期）</li>
            <li>有匹配候选的机构 {Object.keys(ds.overlays.aewv.matches).length.toLocaleString()} 家</li>
            <li>源数据未声明再利用许可（{aewv.licence}），仅作求职参考，请以 INZ 官方查询为准</li>
          </ul>
        </>
      ) : <p>尚未查询。所有机构的 AEWV 状态显示为“未知／待核实”。</p>}

      <h2>口径</h2>
      <ul>
        <li><strong>Region</strong> 使用官方 Regional_Council；<strong>City／District</strong> 使用官方 Territorial_Authority。Auckland 的 School 目录写作 “X Local Board Area”，ECE 目录写作 “Auckland - X”，筛选时统一显示为后者，详情页同时显示官方原值。</li>
        <li><strong>Suburb</strong> 使用官方 Add1_Suburb；为空时单列为“未提供”，不强行归类。</li>
        <li><strong>North Shore</strong> 是业务试点分组，不是现行行政区；按 suburb 清单匹配，清单版本见筛选说明，待负责人批准。</li>
        <li>机构名称保留官方拼写（含 macron）；搜索对大小写、空格和重音容错。</li>
        <li>时间以 UTC 保存，界面按 Pacific/Auckland 显示；仅有日期的字段保留日期精度。</li>
        <li>CSV 仅含公开字段（不含联系人姓名、电话、邮箱、私人备注或申请记录）。</li>
      </ul>

      <h2>重要提示</h2>
      <ul>
        <li>AEWV 对照是有日期的雇主认证线索，不等于岗位提供签证支持或个人符合签证条件；“未找到”不代表“未认证”。</li>
        <li>外部招聘链接仅为入口，本站不抓取、不复制、不同步招聘内容。</li>
      </ul>

      <h2>署名</h2>
      <p>
        机构目录：Ministry of Education — <a href="https://catalogue.data.govt.nz/dataset/directory-of-educational-institutions" target="_blank" rel="noopener noreferrer">Directory of educational institutions</a>（data.govt.nz / Education Counts），
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>。本站对字段做了筛选和标签映射。
        AEWV 认证雇主：NZ Accredited Employer Inspector, Employer Records Snapshot（源数据包括 MBIE 公布的 Immigration New Zealand 信息）。
        地图：© OpenStreetMap contributors。
      </p>
      {REPO_URL && <p>源代码与修改历史：<a href={safeHref(REPO_URL)} target="_blank" rel="noopener noreferrer">{REPO_URL.replace('https://', '')}</a></p>}
    </article>
  );
}
