# SEO 与 Google 索引量优化设计方案

**日期**：2026-08-05  
**状态**：已批准  
**目标**：解决 Google Search Console 报告中 177+ 网页“已发现 - 尚未编入索引”及抓取优先级低的问题，全面提升 ModelRadar 站点的静态 HTML 可读性、元数据唯一性、静态内链传递效率及 Google 索引量。

---

## 1. 背景与核心问题

Google Search Console 报告大量 URL 处于“已发现 - 尚未编入索引”状态。经排查，核心技术根因在于：
1. **静态 HTML Title 与 Description 严重重复**：SSG 批量构建时，280+ 个单模型页面的静态 HTML 源码包含相同的 `<title>模型详情｜ModelRadar</title>` 与通用 `<meta name="description">`。Googlebot 判定为重复内容（Duplicate Content）而拒绝索引。
2. **厂商页与对比页 Head Meta 未预渲染 & 正文为空**：`provider.html` 页面在静态构建时处于 loading 隐藏状态，无 JS 渲染环境下爬虫抓取不到模型表格正文。
3. **静态内链图谱缺失**：模型页缺少指向其他模型、对比页和厂商页的静态 HTML 锚文本链接，导致爬虫抓取深度（Crawl Depth）不够，抓取预算（Crawl Budget）无法分配给深层 URL。

---

## 2. 详细优化架构

### 2.1 组件 A：SSG Head 元数据唯一性注入 (`scripts/prepare-static.js`)

在打包构建阶段（`npm run build`），针对不同的伪静态路由，在 `processHtmlSEOAndAliases` 中全套注入专属的 SEO Head 标签：

- **单模型页面 (`public/model/<id>/index.html`)**：
  - `<title>`：`${model.name} API 价格、上下文与性能规格｜ModelRadar`
  - `<meta name="description">`：`${model.name}（${model.provider}）API 输入价格为 ${inputPrice}，输出价格为 ${outputPrice}，上下文窗口 ${context}。提供最新官方计费与历史变化记录。`
  - `<meta property="og:title">` 与 `<meta property="og:description">`：同步更新为上述唯一值。
  - `<meta property="og:url">` 与 `<link rel="canonical">`：准确指向规范化路径 `https://modelradar.cn/model/${encodedId}`。

- **固定对比页面 (`public/compare/<slug>/index.html`)**：
  - `<title>`：`${page.titleLabel} 价格对比与参数评测｜ModelRadar`
  - `<meta name="description">`：`${page.descriptionLabel}`
  - `<meta property="og:title">` 与 `<meta property="og:description">`：同步更新。

- **厂商页面 (`public/provider/<slug>/index.html`)**：
  - `<title>`：`${provider.name} 所有 AI 模型 API 价格与上下文对比｜ModelRadar`
  - `<meta name="description">`：`查看 ${provider.name} 旗下所有 AI 模型的价格对比，包含输入价格、输出价格、缓存价格、上下文长度和官方来源。`
  - `<meta property="og:title">` 与 `<meta property="og:description">`：同步更新。

---

### 2.2 组件 B：静态 HTML 内容与结构化数据预渲染

在 `scripts/prepare-static.js` 中新增/强化预渲染函数，确保 Googlebot 抓取原始 HTML 文件时即可解析完整页面主题：

1. **厂商页 (`providerExtraReplacer`)**：
   - 根据 `models.json` 动态筛选属于当前厂商的模型列表。
   - 在静态构建阶段直接生成模型行的 `<tr>...</tr>` 表格 HTML 并写入 `#modelTableBody`。
   - 填充 `#modelCountStat`、`#maxContextStat`、`#minInputPriceStat`、`#minOutputPriceStat` 等首屏关键指标。
   - 将 `#loadingState` 设置为 `hidden`，取消 `#providerView` 的 `hidden` 属性，使 HTML DOM 源码在无 JS 运行时直接展示完整内容。
   - 静态注入 `CollectionPage` / `ItemList` JSON-LD 结构化数据到 `<head>`。

2. **单模型页 (`modelExtraReplacer`)**：
   - 确保首屏面板（输入价、输出价、上下文窗口、所属厂商、缓存价格、数据来源状态）以及 `#detailGrid` 明细卡片在静态构建阶段全部填充完成。
   - 在 `<head>` 静态注入 `SoftwareApplication` 与 `BreadcrumbList` JSON-LD。

---

### 2.3 组件 C：全网状静态拓扑内链网络

在 SSG 构建期为各静态 HTML 注入相互打通的静态 HTML `<a>` 链接：

1. **单模型页底部内链**：
   - **同厂商其他模型**：精选当前厂商的最多 4 个热门模型，生成静态锚文本链接（如 `<a href="/model/gpt-5.5">GPT-5.5 API 定价与性能详情 ➔</a>`）。
   - **热门模型对比**：根据当前模型，匹配包含该模型的固定对比页（如 `<a href="/compare/deepseek-vs-openai">DeepSeek vs OpenAI 价格比对评测 ➔</a>`）。
   - **厂商汇总页链接**：在面包屑和快照中添加指向 `/provider/<provider-slug>` 的静态链接。
2. **全站页脚 Footer 强化**：
   - 在页脚增加所有已知 AI 厂商的静态 HTML 入口 (`/provider/openai` 等)，确保底层页面可通过页脚爬行链（Footer Links Crawl）快速发现。

---

### 2.4 组件 D：Sitemap 覆盖与自动化校验

1. **动态厂商支持**：
   - 改造 `scripts/lib/provider-pages.js` 与 `scripts/lib/sitemap.js`，改为从 `models.json` 动态提取全部 `provider` 集合，避免遗漏非预设厂商。
2. **Sitemap 节点覆盖**：
   - 确保 `sitemap.xml` 中收录全量单模型页（`/model/xxx`）、固定对比页（`/compare/xxx`）和全量厂商页（`/provider/xxx`）。
3. **自动化测试与校验**：
   - 扩展 `scripts/check-structured-data.js`，对生成在 `public/` 下的所有 HTML 页面中的 `<title>` 唯一性、`<meta name="description">` 存在性及 JSON-LD 进行回归校验。

---

## 3. 验证与测试计划

1. **静态构建验证**：运行 `npm run build`，确认 `public/` 目录下所有模型、对比及厂商 HTML 文件的预渲染成功。
2. **Title 与 Description 唯一性抽查**：校验 `public/model/gpt-5.5/index.html`、`public/provider/openai/index.html`、`public/compare/deepseek-vs-openai/index.html` 等文件源码中的 `<title>` 与 `<meta name="description">` 是否包含独一无二的文本。
3. **无 JS 内容显示**：检查 `public/provider/openai/index.html` 在禁止 JavaScript 执行的情况下能否正常显示模型表格与统计指标。
4. **Schema 与 Sitemap 校验**：运行 `npm run schema:check` 确保静态 JSON-LD 合规；检查 `sitemap.xml` 包含全量生成的 URL。

---

## 4. 影响与风险评估

- **兼容性**：预渲染的 HTML 标签保持现有的 JS hydrate 逻辑兼容，前端 JS 加载完成后仍可响应用户交互（如切换对比模型或更新汇率）。
- **性能**：打包产物增加少量 HTML 体积，但在 CDN 层加速明显，搜索引擎首字节到正文呈现速度（First Contentful Paint）大幅提升。
