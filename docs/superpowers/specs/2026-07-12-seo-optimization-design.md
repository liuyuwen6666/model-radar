# SEO 与 Google Indexing 优化技术规格说明书

本文档规定了 AI Model Price Radar 项目针对 Google Search Console (GSC) 出现的“已发现/已抓取尚未索引”以及 404 等问题的深度 SEO 代码优化技术方案。

## 1. 架构目标

1. **零模板字符串泄露**：确保任何客户端 HTML/JS 中不存在由于模板字面量 `${...}` 语法导致爬虫静态分析解析出带有占位符的乱码 URL。
2. **零 404 外部链接**：自动向下兼容 `changelog.json` 中的历史老 ID，避免渲染历史价格页面时产生死链。
3. **精准收录**：仅收录有阅读价值 of HTML 网页，完全屏蔽 JSON 数据和历史快照，引入 sitemap 自动静态准入校验。
4. **HTML 唯一 H1 规范**：保证各状态切换的页面在任意静态及渲染状态下均只有一个主旨 `<h1>` 标签。
5. **Meta 与 Canonical 规范**：补全缺失的社交媒体标签，确保各页面 canonical 地址与 Sitemap 中定义的 URL 逐字完全匹配。

---

## 2. 模块设计详情

### 模块一：数据接口屏蔽、Sitemap 净化与本地自动校验

#### 1. Robots.txt 屏蔽
*   修改 `robots.txt`，添加精准过滤：
    ```txt
    User-agent: *
    Disallow: /data/
    Disallow: /*.json$
    Allow: /
    
    Sitemap: https://modelradar.cn/sitemap.xml
    ```

#### 2. Cloudflare Pages Headers 响应头 (`_headers`)
*   配置内容：
    ```text
    /data/*
      X-Robots-Tag: noindex, nofollow, noarchive
    ```

#### 3. Sitemap 净化
*   修改 `scripts/lib/sitemap.js`，彻底移除 `/data/models.json`、`/data/changelog.json` 和 `/data/history/*.json` 的写入。
*   删除动态 Query 对比页面 URL (`/compare?left=...`)。
*   保留静态路由的 Compare 落地页（从 `FIXED_COMPARE_PAGES` 提取）。
*   将 `/en` 改为 `/en/` 以保持末尾斜杠的一致。

#### 4. ⭐ Sitemap 自动校验脚本 (`scripts/check-sitemap.js`)
*   读取生成后的 `sitemap.xml`，对其中的每一个 `<loc>` 进行本地校验：
    1.  **File mapping check**：解析 loc 路径（如 `https://modelradar.cn/compare` ➔ `public/compare/index.html`）。如果对应的本地静态 HTML 文件不存在，直接报错抛出。
    2.  **Data block check**：若包含 `.json`、`history` 等，直接报错。
    3.  **Repeat & Placeholder check**：若包含 `${...}`、`undefined`、`null`、`#` 或包含重复项，直接报错。
    4.  **Canonical strict match check**：读取映射的本地 HTML 文件，解析 `<link rel="canonical" href="..." />`。若其 href 属性与 sitemap 中的 loc URL 不一致，直接报错。
*   该脚本将在打包构建 `npm run build` 的最后自动调用。

---

### 模块二：HTML 标签净化与 Meta/H1 唯一性设计

#### 1. 规范 H1 标签唯一性
*   **`model.html`**：
    *   将 `<h1>正在读取模型详情...</h1>` 降级为 `<h2 class="loading-title">正在读取模型详情...</h2>`。
    *   将 `<h1 class="error-code">404</h1>` 降级为 `<div class="error-code">404</div>`。
    *   只保留 `<h1 id="modelName">模型名称</h1>` 为唯一 `<h1>`。
*   **`provider.html`**：
    *   将 `<h1>正在读取厂商模型...</h1>` 降级为 `<h2 class="loading-title">正在读取厂商模型...</h2>`。
    *   将 `<h1>AI 厂商列表</h1>` 降级为 `<h2>AI 厂商列表</h2>`。
    *   只保留 `<h1 id="providerName">厂商名称</h1>` 为唯一 `<h1>`。

#### 2. Meta 元数据补全
*   **`about.html`** 补全缺失的 Twitter 标签：
    ```html
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="关于我们｜AI 模型价格雷达" />
    <meta name="twitter:description" content="了解 AI 模型价格雷达 (ModelRadar) 的愿景、工作原理与数据可靠性说明。" />
    ```

#### 3. href 占位符净化与硬编码 ID 纠正
*   **`calculator.html`**：将静态默认的 `href="#"` 替换为 `/`。
*   **硬编码 ID 纠正**（在 `compare.html` 与 `compare-pages.js` 中）：
    *   `anthropic-claude-3-7-sonnet` ➔ `claude-sonnet-5`
    *   `openai-gpt-5-5` ➔ `gpt-5.5`
    *   `google-gemini-2-5-flash` ➔ `gemini-2.5-flash`

---

### 模块三：JS 链接防泄露与旧 ID 向下兼容映射设计

#### 1. 消除 JS 模板字面量泄露
*   将所有 HTML/JS 文件中动态拼接 `/model/` 或 `/compare` 的模板字面量 `` `/model/${...}` `` 改写为传统的加号拼接，例如：`'/model/' + encodeURIComponent(...)`。

#### 2. 前端模型 ID 规范化兜底
*   在 `history.html`、`index.html` 和 `model.html` 的前端渲染逻辑中，加入 `normalizeModelId(id)` 函数。
*   通过正则自动剥离历史数据中带有的 `google-`、`openai-`、`kimi-` 等前缀，并将中划线版本的 `qwen2-5` 纠正为 `qwen2.5`，使渲染出的详情跳转链接全部指向存在的有效页面。

---

## 3. 验证方案

1.  **静态构建测试**：运行 `npm run build` 确保能够正常进行打包。
2.  **Sitemap 校验脚本运行**：确认 `scripts/check-sitemap.js` 校验流程能够在打包结束时正常触发。
3.  **人工抽检**：
    - 检查打包后的 `public/sitemap.xml` 和 `public/robots.txt` 以及 `public/_headers` 内容是否正确。
    - 检查 `public/history/index.html` 渲染历史条目时的模型链接，确认已无带厂商前缀的旧 404 ID。
