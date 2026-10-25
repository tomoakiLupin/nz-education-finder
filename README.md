# NZ Education Finder

新西兰 School 与 ECE 机构检索网站（PRD：[NZ_Education_Finder_PRD.md](NZ_Education_Finder_PRD.md)）。
纯静态站点，托管在 GitHub Pages，数据更新由 GitHub Actions 定时执行，无需个人电脑开机。

## 功能（对应 PRD）

| PRD | 实现 |
| --- | --- |
| F01 | 从 data.govt.nz（Ministry of Education，CC BY 4.0）导入 School 与 ECE 目录；唯一键 `school:<id>` / `ece:<id>`，两目录 ID 不冲突 |
| F02 | 全部／School／ECE 切换，名称或官方 ID 搜索（大小写、空格、macron 容错），分页、排序 |
| F03 | Region → City／District → Suburb 级联筛选 + 按类别分组的机构类型；上级变化自动清除失效下级；空值单列“未提供” |
| F04 | 详情页：官方名称、类别、地址、类型、来源与更新时间、官网、Careers、地图、AEWV 摘要 |
| F05 | 管理员在 `data/enrichments.json` 维护官网／Careers 链接（来源、核实时间、发布状态）；修改历史即 git 历史 |
| F06 | 导出当前筛选结果 CSV（仅公开字段 + 来源与日期；防公式注入） |
| F07 | Leaflet + OpenStreetMap，点聚合；与列表共用筛选；缺坐标不绘点；瓦片失败时列表照常可用 |
| F08 | 官方目录：暂存校验、校验和幂等、行数骤减拒绝整批、消失记录标“来源缺失·待核实”；AEWV CSV 登记批次（摘要、来源、名单日期、取得日期、导入者） |
| F09 | AEWV 匹配按证据分高／中／低／冲突；高可信需已确认的机构↔雇主关系 + NZBN；未找到显示“未知／待核实” |
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
- 任何对 `main` 的推送都会重新部署。

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

**导入 AEWV 名单**：把合法取得的 CSV（表头至少含 `legal_name`，可选 `trading_name`、`nzbn`、`status`）放进 `data/aewv/`，并在 `data/aewv/sources.json` 登记：

```json
{ "batches": [ { "file": "aewv-2026-10.csv", "source_url": "https://www.immigration.govt.nz/...", "source_note": "如何取得",
  "source_as_of": "2026-10-20", "obtained_at": "2026-10-25", "imported_by": "your-github-name" } ] }
```

`source_as_of` 未知就填 `null`，不要用导入日期代替。若 CSV 含个人信息，不要提交到公开仓库。

**确认雇主关系（高可信的前提）**：`data/employer-links.json`；**人工复核结论**：`data/aewv-reviews.json`（`confirmed` / `rejected`，不改写原始匹配）。

**North Shore 分组**：`data/geo-groups.json` 中的 suburb 清单（当前为草案，`approved: false`）。

## 本地开发

```bash
npm install
npm run import                     # 拉取官方目录到 public/data/
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
