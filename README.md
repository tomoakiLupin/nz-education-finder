# NZ Education Finder

新西兰教育行业找工作网站：列出 Education Gazette 在招职位，并对每个职位显示该学校／ECE 雇主的 AEWV 认证情况；另有全国 School 与 ECE 机构检索（PRD：[NZ_Education_Finder_PRD.md](NZ_Education_Finder_PRD.md)）。
纯静态站点，托管在 GitHub Pages，数据更新由 GitHub Actions 定时执行，无需个人电脑开机。

## 功能（对应 PRD）

| PRD | 实现 |
| --- | --- |
| 职位 | 首页：Education Gazette 在招职位（每小时检查更新），按地区、学段、职位类型、工作性质、是否适合新教师、雇主 AEWV 认证筛选；职位关联到官方机构，机构详情页显示其在招职位 |
| F01 | 从 data.govt.nz（Ministry of Education，CC BY 4.0）导入 School 与 ECE 目录；唯一键 `school:<id>` / `ece:<id>`，两目录 ID 不冲突 |
| F02 | 全部／School／ECE 切换，名称或官方 ID 搜索（大小写、空格、macron 容错），分页、排序 |
| F03 | Region → City／District → Suburb 级联筛选 + 按类别分组的机构类型；上级变化自动清除失效下级；空值单列“未提供” |
| F04 | 详情页：官方名称、类别、地址、类型、来源与更新时间、官网、Careers、地图、AEWV 摘要 |
| F05 | 管理员在 `data/enrichments.json` 维护官网／Careers 链接（来源、核实时间、发布状态）；修改历史即 git 历史 |
| F06 | 导出当前筛选结果 CSV（仅公开字段 + 来源与日期；防公式注入） |
| F07 | Leaflet + OpenStreetMap，点聚合；与列表共用筛选；缺坐标不绘点；瓦片失败时列表照常可用 |
| F08 | 官方目录：暂存校验、校验和幂等、行数骤减拒绝整批、消失记录标“来源缺失·待核实”；AEWV 名单使用带校验和的完整快照，每日检查更新（见下） |
| F09 | AEWV 匹配按证据分高／中／低／冲突；高可信需已确认的机构↔雇主关系 + NZBN；ECE 连锁（BestStart、Kindercare、Bear Park 等）按品牌名前缀匹配为中可信；未找到显示“未知／待核实” |
| 界面语言 | 中文／English 切换（右上角），记在浏览器中；默认跟随浏览器语言 |
| F10 | Education Gazette／SEEK／Trade Me 入口 + 可复制关键词；预填深链接默认关闭（`src/config.ts`），待逐平台核实条款 |
| F18 | 见下方“管理员与权限” |

### 与 PRD 的差异（需负责人确认）

- **托管**：PRD 建议 Cloudflare Workers + D1；按要求改为 GitHub Pages（静态）。所有数据在构建时生成 JSON，浏览器端筛选。全国约 7,000 条，gzip 后约 370 KB。
- **管理员与权限（F18）**：静态站点没有服务端，因此不做网页登录。管理员 = 拥有本仓库写权限的 GitHub 账户（GitHub 登录 + 建议启用 MFA）；所有修改通过提交完成，git 历史就是审计记录，回滚即 `git revert`。网站上不存在任何密码、token 或隐藏入口。
- **未实现（不应放入此仓库）**：F12–F17（招聘档案、联系人、私人求职记录、AI 编辑器）。这些涉及私人资料，必须有服务端鉴权；GitHub Pages 上的内容对所有人公开，**不要把联系人、申请记录、简历或未授权 JD 提交到本仓库**。第二阶段需要另建带鉴权的后端（例如 PRD 中的 Cloudflare Worker + D1）。

## 部署到 GitHub

1. 在 GitHub 新建一个空仓库（例如 `nz-education-finder`，Public；Pages 免费版需要公开仓库）。
2. 推送代码：
   ```bash
   git remote add origin https://github.com/<你的用户名>/nz-education-finder.git
   git push -u origin main
   ```
3. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
4. **Actions** 页里运行一次 “Deploy site”（或随便推一个提交）。完成后网址为 `https://<你的用户名>.github.io/nz-education-finder/`。

之后：
- **Update official data** 每周自动拉取官方目录，有变化才提交，然后自动重新部署；也可在 Actions 页手动运行。
- **Deploy site** 每小时检查一次：Education Gazette 职位或 AEWV 快照（SHA-256 与线上不同）有变化才重新构建并部署，否则直接结束。
- 任何对 `main` 的推送都会重新部署。

## 职位数据来源

`scripts/fetch-jobs.mjs` 读取 Education Gazette 职位页自己使用的 `https://gazette.education.govt.nz/vacancies/data.json`（约 1,300 条），校验后保留职位事实（标题、学校、地区、类别、截止日期、原文链接）；当前快照 `data/jobs/` 不提交到仓库。`build-overlays.mjs` 按名称（完全一致，同名用地区区分）把职位关联到官方机构，约 98% 能唯一对应。

**广告正文**：每个职位的广告原文页只读取一次（之后只读新增职位），保存 `vd-description` 正文；邮箱和电话由 `redactContacts` 去掉，联系人栏不读取。构建时每个职位写成 `public/data/ad/<id>.json`，打开职位详情页时才加载。广告版权归刊登学校所有，学校要求时应从归档中删除（与 PRD §20 原先“不提交 JD”的规定不同，2026-10-28 按需求变更）。

**签证要求**：从广告正文中摘出与签证、居民身份、海外申请人、AEWV／担保相关的句子（`extractVisa`，见 `scripts/lib.mjs`），分为“不接受海外／不担保”“提及 AEWV／担保”“要求／优先居民或有效签证”“其他签证相关”四类，在职位详情页高亮显示并可筛选。

**归档**：`data/archive/jobs.jsonl`（提交到仓库）保存所有见过的职位：职位信息、广告正文（`text`，下架后才首次读取的为 `null`）、签证句子、`firstSeen`、`delisted`（下架日期）。部署流程有变化时自动提交；每行只在职位新增、修改或下架时变化。网站有“历史（已归档）”列表，机构详情页显示该校历史招聘记录。

**ERO 报告**：机构页和职位页按教育部机构编号链接 `https://www.ero.govt.nz/institution/<编号>/<名称>`，没有报告的机构 ERO 会跳到搜索页。

**联系人不单独保存**：不读取广告页的联系人栏，正文里的邮箱和电话会去掉；正文里写到的人名保留。Gazette 对邮箱做了防采集处理，本仓库和网站是公开的，批量存档员工个人联系方式不合适；需要的话应放在带鉴权的私有存储中（见 PRD 第二阶段）。

**新职位提醒**：构建时生成两个 Atom 订阅源——`data/feed.xml`（最新 150 个职位）和 `data/feed-aewv.xml`（仅雇主有 AEWV 认证候选的职位），用 Feedly、Inoreader、Outlook 等订阅即可收到新职位通知。职位页还会标出“自上次访问新增”的职位（记录在本浏览器中）。

未接入的平台：
- **SEEK**：使用条款禁止机器人、抓取、聚合以及在其他网站转载其内容，只有授权 API 例外（面向招聘系统合作方）。
- **Trade Me Jobs**：API 需注册并获批准，条款不允许保存或再提供数据、每次使用都须重新调用 API，与静态站点不兼容。若要接入需先向 Trade Me（api-jobs@trademe.co.nz）申请。

## AEWV 数据来源

INZ 官方查询页（[Accredited employer list](https://www.immigration.govt.nz/work/requirements-for-work-visas/approved-employers/accredited-employer-list/)）只能按名称或 NZBN 逐个查，结果超过约 1,000 条会被拒绝，没有整表下载。

因此本站使用 [NZ Accredited Employer Inspector](https://nzaei.zemo.bio/open-data/) 发布的公开快照：以 MBIE 依 OIA 公布的完整名单为基础，结合 INZ 在线查询逐条复核，约每三天发布一次完整 CSV（约 3 万条，含雇主名称、商号、NZBN、到期日、行业、城市），每个快照固定不变，并附 SHA-256 和行数。

为什么不在浏览器里实时获取：nzaei 和 INZ 的接口都没有开放跨域（CORS），GitHub Pages 上的网页无法直接请求；完整 CSV 约 8 MB，也不适合每位访客下载一遍。所以由 GitHub Actions 每小时检查，有更新就自动重建。

`scripts/fetch-aewv.mjs` 读取 [catalog.json](https://data.nzaei.zemo.bio/catalog.json)，下载最新快照，校验 SHA-256、行数和必需字段，任一项不符就失败退出（线上保持上一版）。快照只在构建时使用，**不提交到仓库**（`data/aewv/snapshot.*` 已在 .gitignore 中）：源数据未声明再利用许可（NOASSERTION），所以网站只公开与机构匹配的雇主信息，不转载完整名单。

注意：
- 这是第三方独立项目，不是 INZ 官方产品；快照是带日期的观察记录，重要决定请以 INZ 官方查询为准。
- 选择不公开的雇主不在名单中，所以“未找到”不代表“未认证”。
- 过期认证不参与匹配；城市和行业只作为参考理由显示，不会提高匹配等级。
- 未使用 ApplyWave：其条款禁止抓取、批量复制和再发布数据。

## 管理员操作

所有操作都可以直接在 GitHub 网页上编辑文件完成（详情页有“在 GitHub 编辑补充资料”链接）。提交后约 1–2 分钟上线；数据有误时部署会失败，线上保持上一版本。

**补充官网／Careers 链接**：编辑 `data/enrichments.json`

```json
{
  "entries": {
    "school:544": [
      { "field": "careers", "value": "https://www.example.school.nz/vacancies", "source_url": "https://www.example.school.nz/",
        "verified_at": "2026-10-25", "updated_by": "your-github-name", "publish_status": "published" }
    ]
  }
}
```

同一字段以最后一条为准：要停用就追加一条 `"publish_status": "disabled"`，草稿用 `"draft"`。只接受 http/https 链接。

**确认雇主关系（高可信的前提）**：`data/employer-links.json`；**人工复核结论**：`data/aewv-reviews.json`（`confirmed` / `rejected`，不改写原始匹配）。

**North Shore 分组**：`data/geo-groups.json` 中的 suburb 清单（当前为草案，`approved: false`）。

## 本地开发

```bash
npm install
npm run import                     # 拉取官方目录到 public/data/
node scripts/fetch-aewv.mjs         # 下载 AEWV 认证雇主快照
node scripts/fetch-jobs.mjs         # 下载 Education Gazette 在招职位
node scripts/build-overlays.mjs    # 生成 overlays.json
npm run dev
npm test                           # 导入／合并／AEWV 匹配单元测试
```

## 数据字典（公开字段）

| 字段 | 来源字段 | 说明 |
| --- | --- | --- |
| `key` | — | `school:<School_Id>` 或 `ece:<ECE_Id>` |
| `name` | Org_Name | 官方名称，原样保留（含 macron） |
| `type` / `authority` | Org_Type / Authority | |
| `region` | Regional_Council | |
| `district` | Territorial_Authority | 原值保存；筛选标签把 School 目录的 “X Local Board Area” 显示为 “Auckland - X”，与 ECE 目录一致 |
| `suburb` / `city` / `address` | Add1_Suburb / Add1_City / Add1_Line1 | |
| `lat` / `lon` | Latitude / Longitude | 超出新西兰（含 Chatham）范围或为 0 时置空，记录保留 |
| `url` | URL | 仅保留 http/https |
| `roll` / `rollDate` | Total / Roll_Date | |
| `status` | Status | 仅 School 目录有 |
| `sourceStatus` | — | `present`，或 `source_missing`（最新批次中缺失，待核实，不等于关闭） |
| `batch` / `firstSeen` / `missingSince` | — | 批次与日期（UTC 保存，界面按 Pacific/Auckland 显示） |

**不导出**：联系人姓名（Contact1_Name）、电话、传真、邮箱，以及族裔构成等与求职无关的字段。
