# AI 模型价格雷达

一个可直接部署到 Cloudflare Pages 的静态站，用纯 HTML、CSS、原生 JavaScript 展示 AI 模型价格、上下文和价格变更记录。首页数据来自 `data/models.json` 和 `data/changelog.json`，无需前端框架，也无需构建步骤。

## 项目结构

```text
.
|-- .github/workflows/update.yml   # 每 12 小时自动更新数据
|-- data/
|   |-- models.json                # 当前模型价格数据
|   |-- changelog.json             # 最新变更和历史变更记录
|   `-- sources.json               # 厂商来源配置，后续可扩展真实抓取
|-- scripts/
|   |-- update.js                  # 模拟每日更新模型价格
|   `-- diff.js                    # 对比新旧数据并生成 changelog.json
|-- index.html                     # 首页，运行时 fetch JSON 渲染
|-- robots.txt
`-- sitemap.xml
```

## 数据结构

`data/models.json`：

- 顶层保存 `schemaVersion`、`generatedAt`、`effectiveDate`、`currency` 和 `models`
- `models` 数组中的每条记录都包含模型名、厂商、输入/输出价、缓存价、上下文、能力标签、适用场景、来源地址等字段

`data/changelog.json`：

- `latest` 保存当前更新批次的价格变更
- `history` 保存累计变更历史
- `summary` 汇总涨价、降价、新增字段、新增模型等数量

## 自动更新链路

1. GitHub Actions 按 `0 */12 * * *` 触发，或手动运行 `workflow_dispatch`
2. `node scripts/update.js` 读取 `data/sources.json` 和现有 `data/models.json`
3. 当前示例会用模拟逻辑生成下一版 `data/models.json`
4. `node scripts/diff.js` 比较 `.cache/models.previous.json` 与新的 `data/models.json`
5. 若 `data/` 下文件发生变化，workflow 自动 commit 并 push

当前脚本是“可替换骨架”：

- `scripts/update.js` 负责“抓取/归一化/落盘”
- `scripts/diff.js` 负责“比对/生成变更记录”
- 后续接真实爬虫时，只需要把 `update.js` 中的模拟部分替换为真实采集逻辑

## 本地运行与测试

首页是纯静态文件，不需要构建。

直接验证脚本：

```powershell
node --check scripts/update.js
node --check scripts/diff.js
node scripts/update.js
node scripts/diff.js
```

如果要模拟“下一天”的价格更新，而不污染仓库中的正式数据，可以把数据输出到临时目录：

```powershell
New-Item -ItemType Directory -Force .tmp-validation\data | Out-Null
Copy-Item data\* .tmp-validation\data -Recurse -Force
$env:MODEL_RADAR_DATA_DIR = ".tmp-validation/data"
$env:MODEL_RADAR_CACHE_DIR = ".tmp-validation/.cache"
$env:MODEL_RADAR_DATE = "2026-05-15"
node scripts/update.js
node scripts/diff.js
```

## 部署

### Cloudflare Pages

1. 连接 GitHub 仓库
2. Build command 留空
3. Build output directory 设为 `/`
4. 发布后静态资源会直接提供 `index.html` 与 `data/*.json`

### GitHub Actions

仓库需要允许 workflow push：

- `GITHUB_TOKEN` 默认具备 `contents: write`
- `update.yml` 已配置 `permissions: contents: write`

## 后续接真实数据建议

- 在 `data/sources.json` 中继续维护官方价格页入口
- 按厂商拆分抓取器，例如 `fetchOpenAI()`, `fetchAnthropic()`
- 在 `update.js` 中统一归一化成当前 `models.json` 结构
- 若价格字段需要更细粒度比对，可在 `diff.js` 中继续扩展字段白名单
