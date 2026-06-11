# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AI 模型价格雷达 (ModelRadar)** — 一个跟踪 AI 模型 API 定价的静态网站，部署在 Cloudflare Pages。

- 自动从 OpenAI、Anthropic、Google、DeepSeek、豆包、通义、Kimi、混元 等厂商官方定价页抓取价格
- 数据存储为机器可读的 JSON（`data/models.json`），带历史快照（`data/history/YYYY-MM-DD.json`）和 changelog
- 前端为纯 HTML + Tailwind CSS，无框架，无构建步骤（除 Tailwind 编译）
- 每 12 小时通过 GitHub Actions 自动更新

## Key Commands

```bash
npm run update              # 抓取所有厂商最新价格，更新 data/models.json 和 changelog
npm run save-raw            # 保存各厂商定价页原始 HTML 快照到 raw/ 目录
npm run diff                # 对比上次更新，输出价格变化摘要
npm run build               # prepare-static + Tailwind 编译 → public/
npm run schema:check        # 校验 HTML 中 JSON-LD 结构化数据合规性
npm run deploy              # wrangler deploy 到 Cloudflare Pages

# 指定日期执行（补录历史数据）
MODEL_RADAR_DATE=2026-06-06 npm run update     # Linux/macOS
$env:MODEL_RADAR_DATE="2026-06-06"; npm run update  # Windows PowerShell
```

## Project Structure

```
├── index.html              # 首页 (Tailwind CSS)
├── about.html              # /about
├── history.html            # /history — changelog 渲染页
├── model.html              # /model?id=xxx — 单模型详情页
├── compare.html            # /compare — 双模型对比
├── rankings.html           # /rankings — 模型排行
├── provider.html           # /provider — 厂商页面
├── calculator.html         # /calculator — 成本计算器
├── data-schema.html        # /data-schema — 数据格式文档
├── api.html                # /api — API 文档
├── en.html                 # /en/ — 英文入口页
│
├── src/input.css           # Tailwind CSS 源文件
├── tailwind.config.js      # Tailwind 配置（自定义品牌色）
│
├── scripts/
│   ├── update.js           # 主控制脚本：抓取 + 合并 + 输出
│   ├── save-raw.js         # 原始 HTML 快照存档
│   ├── diff.js             # 两次更新间的价格变化差分
│   ├── prepare-static.js   # 构建：生成路由别名、拷贝文件
│   ├── check-structured-data.js  # JSON-LD 结构化数据 SEO 检查
│   ├── lib/
│   │   ├── sitemap.js      # sitemap.xml 生成
│   │   ├── compare-pages.js # 固定对比页配置
│   │   └── provider-pages.js # 厂商页配置
│   └── providers/          # 各厂商抓取器（每个文件一个 fetch* 函数）
│       ├── openai.js
│       ├── anthropic.js
│       ├── google.js
│       ├── deepseek.js
│       ├── kimi.js
│       ├── qwen.js
│       ├── doubao.js
│       └── hunyuan.js
│
├── data/
│   ├── models.json         # 主数据集：270+ 模型的价格、上下文、能力标签
│   ├── sources.json        # 数据来源配置（url、关联模型列表）
│   ├── changelog.json      # 价格变更历史记录
│   └── history/            # 每日历史快照存档
├── raw/                    # 厂商定价页原始 HTML 快照（按 provider/年/月/日 归档）
├── public/                 # 构建产物（部署到 Cloudflare Pages）
│   └── dist/styles.css     # Tailwind 编译产物
├── .github/workflows/update.yml  # CI/CD：每 12h 自动抓取+提交
└── wrangler.jsonc          # Cloudflare Pages 配置（静态资源从 public/ 托管）
```

## Data Model (models.json)

每条模型记录包含：

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识（如 `openai-gpt-5-5`） |
| `provider` | 厂商名 |
| `family` | 模型系列 |
| `inputPriceUsdPer1M` / `outputPriceUsdPer1M` | 输入/输出价格（USD/1M tokens） |
| `cacheWritePriceUsdPer1M` / `cacheReadPriceUsdPer1M` | 缓存写入/读取价格 |
| `inputPricePer1M` / `outputPricePer1M` | 人民币价格（如有双币标价） |
| `contextWindow` | 上下文窗口大小 |
| `maxOutputTokens` | 最大输出 Tokens |
| `capabilities` | 能力标签数组（如 `chat`, `vision`, `code`） |
| `status` | `live`（现售）/ `legacy`（旧版）/ `stable`（稳定版） |
| `sourceType` | `provider`（实时抓取）/ `fallback`（蓝图兜底） |
| `sourceUrl` | 官方定价页链接 |

## Architecture Guide

### 数据更新流程（npm run update）

1. **备份**：当前 `models.json` → `.cache/models.previous.json`
2. **并行抓取**：`scripts/providers/*.js` 中每个抓取器从官方定价页抓取
3. **合并与降级**：成功 → 使用最新价格；失败/未实现 → 降级使用本地 `MODEL_BLUEPRINTS` 兜底数据；消失的历史模型标记为 `legacy` 保留
4. **标准化**：CNY/USD 以汇率 7.25 双向换算，补全能力标签等
5. **输出**：写入 `models.json`、`sources.json`、`data/history/YYYY-MM-DD.json`，更新 sitemap
6. **差分**：`npm run diff` 调用 `diff.js`，对比新旧数据生成 `changelog.json`

### 收集者两阶段

- **save-raw**（`npm run save-raw`）：抓取各厂商定价页的**原始 HTML** 存档到 `raw/{provider}/年/月/日.html`，建立"定价证据链"
- **update**（`npm run update`）：使用 cheerio 解析 HTML 提取结构化价格数据

### 静态站点架构

- 所有 HTML 是**纯静态文件**，部署到 Cloudflare Pages 的 `public/` 目录
- `npm run build` 执行 `prepare-static.js`：
  - 将 `model.html`、`compare.html` 等拷贝为 `public/<page>/<id>/index.html` 实现漂亮路由（如 `/model/openai-gpt-5-5`）
  - 编译 Tailwind CSS 到 `public/dist/styles.css`
- SEO：每个页面嵌入 JSON-LD 结构化数据（`Dataset`、`WebSite`），通过 `schema:check` 校验

### 关键开发原则

1. **数据与官网 100% 一致** — 这是第一原则。价格、模型顺序、分类应与厂商官方 pricing 页面保持同步
2. `data/` 下的数据**只能通过 `git pull` 获取**，测试产生的数据文件要及时清除
3. 新增模型时，确保在 `models.json` 中位置与官网顺序一致（重要的靠前）
4. `sourceType: "fallback"` 的模型（豆包/混元/Kimi/通义）尚未接入实时爬虫，使用 `MODEL_BLUEPRINTS` 兜底数据
