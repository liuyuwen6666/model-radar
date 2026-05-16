# AI 模型价格雷达

一个可直接部署到 Cloudflare Pages 的静态站，用纯 HTML、CSS、原生 JavaScript 展示 AI 模型价格、上下文和价格变更记录。首页数据来自 `data/models.json` 和 `data/changelog.json`，并且每次更新都会额外落一份 `data/history/YYYY-MM-DD.json` 历史快照；同时提供 `history.html` 作为 `/history` 页面源码，把 changelog 渲染成人类可读的价格变化历史页面，提供 `model.html` 作为模型详情页源码并通过 `/model?id=模型ID` 展示单个模型详情与相关变更，提供 `rankings.html` 作为 `/rankings` 页面源码，并提供 `compare.html` 作为 `/compare` 页面源码，让用户同屏对比两款模型，无需前端框架，也无需构建步骤。

项目同时补齐了最小 Node.js 工程基础，用于后续接入真实抓取逻辑：

- 使用 CommonJS（`require` / `module.exports`）
- 使用 `npm` 管理依赖
- 当前仅引入一个轻量解析依赖：`cheerio`

## Project Goal

An open AI model pricing radar.

This project tracks AI model pricing data from official provider pricing pages, normalizes the result into JSON, and publishes it as a static site plus machine-readable data endpoints.

## Data Sources

Current and planned sources are official pricing pages from:

- OpenAI
- Anthropic
- Google
- DeepSeek
- 字节豆包
- 阿里通义
- 月之暗面
- 腾讯混元

Primary source rule:

- official pricing pages

## Update Frequency

Updated every 12 hours.

The repository also supports manual updates through GitHub Actions `workflow_dispatch`.

## JSON API

Primary machine-readable endpoints:

- `/data/models.json`
- `/data/changelog.json`
- `/data/history/YYYY-MM-DD.json`

These endpoints are intended for:

- frontend runtime rendering
- AI agent consumption
- downstream scripts and dataset reuse

## Sitemap

`sitemap.xml` 由 `data/models.json` 自动生成，并统一使用当前数据集的 `effectiveDate` 作为 `lastmod`。

当前会生成这些 URL：

- `/`
- `/history`
- `/rankings`
- `/compare`
- `/data/models.json`
- `/data/changelog.json`
- `/data/history/YYYY-MM-DD.json`
- `/model?id=模型ID`
- `/compare?left=deepseek-v4-flash&right=anthropic-claude-3-7-sonnet`
- `/compare?left=deepseek-v4-flash&right=openai-gpt-5-5`
- `/compare?left=anthropic-claude-3-7-sonnet&right=openai-gpt-5-5`
- `/compare/deepseek-vs-claude`
- `/compare/deepseek-vs-openai`
- `/compare/claude-vs-openai`
- `/compare/gemini-vs-claude`
- `/compare/gemini-vs-deepseek`

其中模型详情 URL 来自 `data/models.json` 的所有 `models[].id`；`YYYY-MM-DD` 使用 `data/models.json` 的 `effectiveDate`，同时所有条目的 `lastmod` 也统一使用该日期。

## AI-friendly / GEO

ModelRadar is intentionally structured for both traditional SEO and AI retrieval systems:

- each primary page has a unique `title`, `meta description`, `canonical`, `robots`, and OpenGraph metadata
- homepage includes `WebSite` and `Dataset` JSON-LD
- `history.html` includes `Dataset` JSON-LD for changelog data and is exposed on `/history`
- `rankings.html` includes `Dataset` JSON-LD for ranking data and is exposed on `/rankings`
- `compare.html` includes `WebPage` JSON-LD and updates its title from the selected `left` / `right` model ids
- `model.html` updates `document.title`, canonical, OpenGraph, and inserts model-specific JSON-LD after loading `/data/models.json`
- model detail links use stable IDs from `/data/models.json`, which makes them easier for AI systems and downstream tools to cite reliably
- pages expose or render the latest update time from JSON payloads, so both users and crawlers can detect freshness

### 结构化数据策略

本站 JSON-LD 结构化数据遵循以下策略：

- 所有 AI 模型数据使用 `Dataset` 或 `WebPage` 类型描述，不使用 `Product` 类型，避免将 AI 模型 API 价格数据误标为电商商品。
- `Dataset.description` 使用完整自然语言描述（120–250 个中文字符），不堆砌关键词，不写营销话术。
- 每个模型详情页的 `Dataset` JSON-LD 会拼接模型名称和厂商名称，确保描述唯一且足够详细。
- 不伪造 `offers`、`review`、`aggregateRating` 等不属于 AI 模型价格数据的字段。
- 排行榜页面（/rankings）的 Dataset 不使用 `hasPart` 字段，避免因对象类型无效导致 Search Console 报警。
- 数据来源标注为各厂商官方 pricing 页面，并在 JSON-LD 中通过 `isBasedOn` 或 `url` 引用来源链接。

## License

This project uses the MIT License.

License files and metadata:

- [`LICENSE`](./LICENSE)
- `package.json` `license: "MIT"`

## 项目结构

```text
.
|-- .github/workflows/update.yml   # 每 12 小时自动更新数据
|-- data/
|   |-- models.json                # 当前模型价格数据
|   |-- changelog.json             # 最新变更和历史变更记录
|   |-- history/                   # 每日快照，文件名为 YYYY-MM-DD.json
|   `-- sources.json               # 厂商来源配置，后续可扩展真实抓取
|-- package.json                   # Node.js 工程配置
|-- package-lock.json              # npm 锁文件，供 GitHub Actions 使用 npm ci
|-- scripts/
|   |-- providers/
|   |   |-- anthropic.js          # Anthropic 官方价格页抓取与解析
|   |   |-- google.js             # Google AI 官方价格页抓取与解析
|   |   |-- openai.js             # OpenAI 官方价格页抓取与解析
|   |   `-- deepseek.js           # DeepSeek 官方价格页抓取与解析
|   |-- prepare-static.js          # 生成 Cloudflare Worker 静态资源目录 public/
|   |-- update.js                  # 模拟每日更新模型价格
|   `-- diff.js                    # 对比新旧数据并生成 changelog.json
|-- index.html                     # 首页，运行时 fetch JSON 渲染
|-- history.html                   # 价格变化历史页，运行时读取 changelog.json
|-- model.html                     # 模型详情页，读取 models.json 与 changelog.json
|-- compare.html                   # 模型对比页，读取 models.json 比较两款模型
|-- rankings.html                  # 模型排行榜页，读取 models.json 动态排序
|-- wrangler.jsonc                 # Cloudflare Worker 静态资源部署配置
|-- robots.txt
`-- sitemap.xml
```

## Node.js 工程基础

- Node 版本：GitHub Actions 使用 Node 22
- 包管理器：npm
- 模块系统：CommonJS
- `package.json` 已锁定 `engines.node >=22`
- 运行脚本：
  - `npm run build`
  - `npm run deploy`
  - `npm run update`
  - `npm run diff`

安装依赖：

```powershell
npm install
```

## 数据结构

`data/models.json`：

- 顶层保存 `schemaVersion`、`generatedAt`、`effectiveDate`、`currency` 和 `models`
- `models` 数组中的每条记录都包含模型名、厂商、输入/输出价、缓存价、上下文、能力标签、适用场景、来源地址等字段

`data/changelog.json`：

- `latest` 保存当前更新批次的价格变更
- `history` 保存累计变更历史
- `summary` 汇总涨价、降价、新增字段、新增模型等数量

`data/history/YYYY-MM-DD.json`：

- 内容与当次生成的 `data/models.json` 完全一致
- 每次 `npm run update` 都会按 `effectiveDate` 覆盖写入当天快照
- 便于回溯每日价格状态，也方便外部系统按日期抓取

`history.html` / `/history`：

- 运行时读取 `/data/changelog.json`
- 把 `latest` 变化记录渲染成可读表格
- 展示日期、模型、Provider、变化字段、旧值、新值、变化百分比和来源链接

`model.html` / `/model?id=模型ID`：

- 运行时读取 `/data/models.json`
- 根据 URL 参数 `id` 渲染单个模型详情
- 模型详情页 ID 直接来自 `/data/models.json` 的 `id` 字段，首页、排行榜和模型对比页链接都应使用 `/model?id=${model.id}`
- 同时读取 `/data/changelog.json`，展示该模型相关的价格变化记录
- 如果模型不存在，会显示 404 风格提示

`compare.html` / `/compare`：

- 运行时读取 `/data/models.json`
- 提供左右两个模型选择器，默认比较 `deepseek-v4-flash` 和 `anthropic-claude-3-7-sonnet`
- 同时支持固定对比落地页：`/compare/deepseek-vs-claude`、`/compare/deepseek-vs-openai`、`/compare/claude-vs-openai`、`/compare/gemini-vs-claude`、`/compare/gemini-vs-deepseek`
- 固定对比页会自动设置默认 `left/right`，但如果 URL 显式传入 `?left=...&right=...`，则 query 参数优先
- 固定对比页会动态更新 `document.title`、`meta description`、`canonical`、OpenGraph 和 JSON-LD
- 展示厂商、输入价、输出价、缓存写价、缓存读价、上下文长度、更新时间和来源链接
- 价格字段会自动高亮更便宜的一侧
- 模型名会链接到 `/model?id=模型ID`

`rankings.html` / `/rankings`：

- 运行时读取 `/data/models.json`
- 生成输入价格最低、输出价格最低、上下文最长、缓存读取价格最低四类 Top 10 榜单
- `null` 字段不会参与对应排行
- 每个模型名都链接到 `/model?id=模型ID`，且这个 ID 同样来自 `/data/models.json` 的 `id` 字段

`public/`：

- 由 `npm run build` 自动生成
- 用于 Cloudflare Worker 静态资源部署
- 只包含 `index.html`、`history.html`、`model.html`、`compare.html`、`rankings.html`、`robots.txt`、`sitemap.xml`、`data/`，以及存在时的 `assets/`
- 额外生成 `public/history/index.html`、`public/rankings/index.html`、`public/compare/index.html`、`public/model/index.html`
- 还会额外生成 `public/compare/deepseek-vs-claude/index.html`、`public/compare/deepseek-vs-openai/index.html`、`public/compare/claude-vs-openai/index.html`、`public/compare/gemini-vs-claude/index.html`、`public/compare/gemini-vs-deepseek/index.html`
- 还会按 `data/models.json` 中的每个模型 ID 生成 `public/model/模型ID/index.html`，支持 `/model/模型ID` clean route

## 自动更新链路

1. GitHub Actions 按 `0 */12 * * *` 触发，或手动运行 `workflow_dispatch`
2. `npm ci` 安装 `package-lock.json` 中锁定的依赖
3. `npm run update` 读取 `data/sources.json` 和现有 `data/models.json`
4. `update.js` 生成新的 `data/models.json`，并同步覆盖 `data/history/YYYY-MM-DD.json`
5. `update.js` 会根据 `data/models.json` 自动重建 `sitemap.xml`，写入 `/history`、`/rankings`、`/compare`、数据 JSON、所有模型的 `/model?id=模型ID`、重点 `/compare?left=...&right=...` 对比页、固定 `/compare/...` 落地页，以及当日快照 `/data/history/YYYY-MM-DD.json`
6. `npm run diff` 比较 `.cache/models.previous.json` 与新的 `data/models.json`
7. 若 `data/` 或 `sitemap.xml` 发生变化，workflow 自动 commit 并 push

当前脚本是“可替换骨架”：

- `scripts/update.js` 负责“抓取/归一化/落盘”
- `scripts/diff.js` 负责“比对/生成变更记录”
- `scripts/providers/anthropic.js` 已接入 `fetch + cheerio` 抓取 Anthropic 官方价格页
- `scripts/providers/google.js` 已接入 `fetch + cheerio` 抓取 Google AI 官方价格页，当前覆盖 `google-gemini-2-5-flash` 与 `google-gemini-2-5-pro`，页面结构变化时会打印 warning 并保留 fallback 价格
- `scripts/providers/openai.js` 已接入 `fetch + cheerio` 抓取 OpenAI 官方价格页
- `scripts/providers/deepseek.js` 已接入 `fetch + cheerio` 抓取 DeepSeek 官方价格页
- 后续接真实爬虫时，只需要继续在 `scripts/providers/` 下扩展其他厂商模块

## 本地运行与测试

首页是纯静态文件，不需要构建。

直接验证脚本：

```powershell
npm install
node --check scripts/prepare-static.js
node --check scripts/update.js
node --check scripts/diff.js
npm run build
npm run update
npm run diff
```

如果要模拟“下一天”的价格更新，而不污染仓库中的正式数据，可以把数据输出到临时目录：

```powershell
New-Item -ItemType Directory -Force .tmp-validation\data | Out-Null
Copy-Item data\* .tmp-validation\data -Recurse -Force
$env:MODEL_RADAR_DATA_DIR = ".tmp-validation/data"
$env:MODEL_RADAR_CACHE_DIR = ".tmp-validation/.cache"
$env:MODEL_RADAR_DATE = "2026-05-15"
npm run update
npm run diff
```

## 部署

### Cloudflare Worker 静态资源模式

1. 构建命令：`npm run build`
2. 部署命令：`npm run deploy`
3. 路径：`/`
4. `npm run build` 会先根据 `data/models.json` 自动更新 `sitemap.xml`，再清空 `public/` 并复制 `index.html`、`history.html`、`model.html`、`compare.html`、`rankings.html`、`robots.txt`、`sitemap.xml`、`data/`，以及存在时的 `assets/`
5. 构建时会额外生成 `public/history/index.html`、`public/rankings/index.html`、`public/compare/index.html`、固定 `public/compare/.../index.html` 落地页、`public/model/index.html` 和所有 `public/model/模型ID/index.html`
6. `wrangler.jsonc` 已配置：
   - `name: model-radar`
   - `compatibility_date: 2026-05-15`
   - `assets.directory: ./public`
   - `observability.enabled: true`

### Cloudflare Pages

如果继续使用 Pages 触发构建，也保持同一套构建输出：

1. Build command：`npm run build`
2. Build output directory：`/`
3. 构建后由 `public/` 提供 Worker 静态资源目录

### GitHub Actions

仓库需要允许 workflow push：

- `GITHUB_TOKEN` 默认具备 `contents: write`
- `update.yml` 已配置 `permissions: contents: write`
- workflow 会先执行 `npm ci`，再运行 `npm run update` 与 `npm run diff`
- `npm run update` 会同时写入 `data/models.json`、`data/history/YYYY-MM-DD.json` 和 `sitemap.xml`
- 因为仓库已提交 `package-lock.json`，GitHub Actions 可以稳定完成依赖安装

## 后续接真实数据建议

- 在 `data/sources.json` 中继续维护官方价格页入口
- 在 `scripts/providers/` 下按厂商拆分抓取器，并复用 `cheerio` 做 HTML 解析
- 按厂商拆分抓取器，例如 `fetchOpenAI()`, `fetchAnthropic()`
- 在 `update.js` 中统一归一化成当前 `models.json` 结构
- 若价格字段需要更细粒度比对，可在 `diff.js` 中继续扩展字段白名单
