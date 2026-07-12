# 第二阶段 SEO 深度重构与边缘层清洗技术规格说明书

本文档规定了 AI Model Price Radar 项目针对 Google Search Console (GSC) “薄内容未索引”、“已抓取未索引”、“404与重定向混乱”等核心 SEO 问题，实施的第二阶段深度架构重构技术规格。

## 1. 唯一别名数据库源 (Single Source of Truth)
*   **配置文件**：`data/aliases.json`
*   **设计**：作为整个项目模型 ID 映射的唯一真理源。所有的别名映射、`_redirects` 生成、`normalizeModelId` 客户端兜底、Sitemap 校验、Compare 及 History 页面等，都直接从此文件中读取，禁止出现多处硬编码映射。
*   **构建强校验门禁**：
    1.  **别名唯一性**：校验 `aliases.json` 中没有重复的别名。
    2.  **目标存在性**：校验每个映射的 Destination ID 在最新的 `models.json` 里必须存在。
    3.  **防循环映射**：检测并杜绝可能存在的循环跳转链路。
    4.  若有任何校验失败，直接阻断构建（Fail Build）。

---

## 2. 模块设计详情

### 模块一：自动化 Cloudflare Pages 301 边缘重定向 (`_redirects`)
*   **生成文件**：`public/_redirects`
*   **设计**：在打包过程中，读取 `data/aliases.json` 并为每个别名生成两条符合 Cloudflare 语法的重定向规则：
    *   `/model/:oldId ➔ /model/:newId 301`
    *   `/model/:oldId/ ➔ /model/:newId 301`
*   **重定向规则冲突自检**：
    *   校验 `_redirects` 中是否有重复路径定义，或同名目标冲突定义。
    *   如果有冲突，抛出 Error 并中止打包。

### 模块二：SSG 静态首屏内容预渲染 (模型页 & 对比页)
为了消除爬虫抓取骨架屏判定的“低价值薄内容”，构建阶段将直接生成预渲染的静态 DOM 结构。
*   **模型详情页 (`model/index.html`)**：
    *   在 SSG 打包时，预先切换容器属性：隐藏 `#loadingState`，显示 `#modelView`。
    *   注入模型名称、更新时间、输入价格、输出价格、上下文窗口、厂商、缓存计费详情等字段。
    *   注入不少于 50 字的中文语义化模型介绍/定价简析文字（填充在 `#modelDescription` 标签中）。
    *   为 `#detailGrid` 静态填入包含所有细节属性的项目卡片列表。
*   **对比落地页 (`compare/index.html`)**：
    *   注入标题 `${leftModel} vs ${rightModel} 价格对比` 及相关描述。
    *   为 `#summaryList` 生成 2-3 条文本对比摘要的 `<li>` 列表并插入静态源码。
    *   为 `#compareTableBody` 写入完整的对比指标行（输入、输出、上下文、官方来源等）。
*   **前端接管 (Hydration)**：
    *   当客户端 JS 运行时，若检测到页面已渲染了静态数据，**绝不能清空 DOM 或是重新拉起 Loading 动画**，而是渐进式地接管后续数据逻辑。

### 模块三：JSON-LD 结构化数据深度扩展与自动化校验
*   **SoftwareApplication 结构化数据**：在详情页静态注入符合 Schema.org 的 `SoftwareApplication` 描述（含 `name`, `description`, `applicationCategory`: "AI Model", `provider`, 以及 `offers` 定价属性）。
*   **BreadcrumbList 结构化数据**：静态注入面包屑导航结构（`首页 ➔ 所属厂商 ➔ 具体的模型`）。
*   **校验脚本重构**：
    *   修改 `scripts/check-structured-data.js`，在校验大模型详情页时，放行 `Product`、`SoftwareApplication`、`offers` 等，并对其重要字段及面包屑导航进行必填项强校验。
    *   在非详情页（如 Calculator 等），则继续封锁以防止误用。

### 模块四：内链拓扑网络优化
在详情页静态生成的最后，自动在 `</main>` 前面注入语义化内链块：
*   **同厂商其他模型**：最多列出 4 个相同 Provider 的其他模型绝对链接。
*   **相关对比推荐**：列出与当前厂商或当前模型关联的固定 Compare 对比落地页链接（若无，使用默认的前 3 个普适对比页）。
*   **规范化锚链接**：内链绝对使用以 `/` 开头的绝对路径。禁止使用任何 `#` 或空占位。

---

## 3. 验证方案

1.  **运行 `npm run build`** 验证能够顺利通过所有的校验并通过打包。
2.  **检查 `public/_redirects` 规则** 确保其生成的 301 重定向合规且没有重复。
3.  **运行结构化数据自检**：运行 `node scripts/check-structured-data.js` 验证 JSON-LD 格式无误。
4.  **人工源码审核**：在终端查看生成的 HTML，验证首屏已渲染价格和内链。
