# SEO 与 Google 索引量优化 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在打包构建阶段为所有单模型页、厂商页、对比页批量注入独一无二的 Title、Description、OG 标签及静态正文表格，并构建全拓扑静态内链与完整 Sitemap 覆盖，解决 Google Search Console 中“已发现 - 尚未编入索引”的问题。

**架构：**
1. 动态提取 `models.json` 中的厂商列表，扩展 `FIXED_PROVIDERS` 与 `sitemap.xml` 生成。
2. 升级 `scripts/prepare-static.js` 中的 `processHtmlSEOAndAliases`、`modelExtraReplacer`、`compareExtraReplacer` 并新增 `providerExtraReplacer`，实现首屏 HTML 表格与 Head 标签 SSG 预渲染。
3. 在单模型页、厂商页、对比页静态源码及页脚注入多向静态 `<a href="...">` 拓扑内链。
4. 扩充 `scripts/check-structured-data.js` 实施严苛的静态 Title 唯一性与预渲染 HTML 结构校验。

**技术栈：** Node.js, HTML5, JSON-LD, Tailwind CSS, Cloudflare Pages static build

---

### 任务 1：动态厂商列表扩展与 Sitemap 生成更新

**文件：**
- 修改：`scripts/lib/provider-pages.js`
- 修改：`scripts/lib/sitemap.js`
- 测试：`scripts/lib/sitemap.js`

- [ ] **步骤 1：修改 `scripts/lib/provider-pages.js` 支持从 dataset 动态提取厂商**

在 `scripts/lib/provider-pages.js` 中增加从 `models.json` 提取所有 `provider` 规范化 slug 的函数 `getDynamicProviders(dataset)`。

```javascript
const FIXED_PROVIDERS = [
  { slug: 'openai', name: 'OpenAI' },
  { slug: 'anthropic', name: 'Anthropic' },
  { slug: 'deepseek', name: 'DeepSeek' },
  { slug: 'google', name: 'Google' },
  { slug: 'kimi', name: '月之暗面' },
  { slug: 'qwen', name: '阿里通义' },
  { slug: 'doubao', name: '字节豆包' },
  { slug: 'hunyuan', name: '腾讯混元' }
];

function getDynamicProviders(dataset) {
  const models = Array.isArray(dataset?.models) ? dataset.models : [];
  const map = new Map();
  
  // 先注入默认的 FIXED_PROVIDERS
  for (const p of FIXED_PROVIDERS) {
    map.set(p.slug, p);
  }

  // 动态扫描 dataset 中的所有 provider
  for (const m of models) {
    if (!m || !m.provider) continue;
    const providerName = m.provider.trim();
    const slug = providerName.toLowerCase().replace(/\s+/g, '-');
    if (!map.has(slug)) {
      map.set(slug, { slug, name: providerName });
    }
  }

  return Array.from(map.values());
}

module.exports = {
  FIXED_PROVIDERS,
  getDynamicProviders
};
```

- [ ] **步骤 2：更新 `scripts/lib/sitemap.js` 使用动态厂商生成 Sitemap**

修改 `scripts/lib/sitemap.js` 中的 `buildSitemapEntries`，改用 `getDynamicProviders(dataset)`。

```javascript
const { FIXED_PROVIDERS, getDynamicProviders } = require("./provider-pages");

// ...在 buildSitemapEntries 中：
  const providers = getDynamicProviders(dataset);
  for (const provider of providers) {
    appendEntry(entries, seen, `${origin}/provider/${provider.slug}`, effectiveDate);
  }
```

- [ ] **步骤 3：验证 sitemap 生成**

运行命令：`node -e "const { writeSitemapFromDatasetPath } = require('./scripts/lib/sitemap'); writeSitemapFromDatasetPath({ datasetPath: './data/models.json', sitemapPath: './sitemap.xml' }).then(res => console.log('Entries:', res.entries.length));"`
预期：输出 entries 数量且包含全部 280+ 模型页及所有厂商页。

- [ ] **步骤 4：Commit**

```bash
git add scripts/lib/provider-pages.js scripts/lib/sitemap.js sitemap.xml
git commit -m "feat(seo): dynamically extract provider pages and update sitemap entries"
```

---

### 任务 2：SSG Head 元信息 (Title/Description/OG) 与 厂商页 HTML 静态预渲染

**文件：**
- 修改：`scripts/prepare-static.js`
- 修改：`model.html`
- 修改：`compare.html`
- 修改：`provider.html`

- [ ] **步骤 1：增加通用 HTML SEO Head 替换工具函数**

在 `scripts/prepare-static.js` 的 `processHtmlSEOAndAliases` 中增加针对 `<title>`、`<meta name="description">`、`og:title`、`og:description` 的正则表达式替换逻辑。

```javascript
async function processHtmlSEOAndAliases(targetRelativePath, seoMeta, aliases, extraReplacer = null) {
  const targetPath = path.join(PUBLIC_DIR, targetRelativePath);
  let content = await fs.readFile(targetPath, "utf8");

  // 1. 注入 MODEL_ID_ALIASES 全局变量
  if (aliases && !content.includes("window.MODEL_ID_ALIASES")) {
    const scriptTag = `\n  <script>window.MODEL_ID_ALIASES = ${JSON.stringify(aliases)};</script>`;
    content = content.replace(/<head>/i, `<head>${scriptTag}`);
  }

  // 2. 重写 SEO 标签（title, description, canonical, og 标签）
  if (seoMeta) {
    if (seoMeta.title) {
      content = content.replace(/<title>[\s\S]*?<\/title>/i, `<title>${seoMeta.title}</title>`);
      content = content.replace(/<meta\s+property=["']og:title["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta property="og:title" content="${seoMeta.title}" />`);
      content = content.replace(/<meta\s+name=["']twitter:title["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta name="twitter:title" content="${seoMeta.title}" />`);
    }

    if (seoMeta.description) {
      content = content.replace(/<meta\s+name=["']description["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta name="description" content="${seoMeta.description}" />`);
      content = content.replace(/<meta\s+property=["']og:description["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta property="og:description" content="${seoMeta.description}" />`);
      content = content.replace(/<meta\s+name=["']twitter:description["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta name="twitter:description" content="${seoMeta.description}" />`);
    }

    if (seoMeta.canonicalUrl) {
      content = content.replace(/<link\s+rel=["']canonical["']\s+href=["'][\s\S]*?["']\s*\/?>/i, `<link rel="canonical" href="${seoMeta.canonicalUrl}" />`);
      content = content.replace(/<meta\s+property=["']og:url["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta property="og:url" content="${seoMeta.canonicalUrl}" />`);
    }
  }

  // 3. 执行额外的文本替换（主要用于 SSG 预渲染和内链注入）
  if (extraReplacer && typeof extraReplacer === "function") {
    content = extraReplacer(content);
  }

  await fs.writeFile(targetPath, content, "utf8");
}
```

- [ ] **步骤 2：实现 `providerExtraReplacer` 预渲染厂商正文与 JSON-LD**

在 `scripts/prepare-static.js` 中创建 `providerExtraReplacer(content, providerObj, models)` 函数：
1. 筛选出属于当前 `providerObj.name` 的模型集合；
2. 计算 `modelCount`、`maxContext`、`minInput`、`minOutput`；
3. 生成全套模型行的 HTML 字符串注入 `#modelTableBody`；
4. 取消 `#providerView` 的 `hidden` 属性，设置 `#loadingState` 为 `hidden`；
5. 注入包含全量模型的 `CollectionPage` / `ItemList` JSON-LD 脚本块到 `<head>`。

- [ ] **步骤 3：升级 `createModelAliases`、`createCompareAliases` 与 `createProviderAliases`**

在 `createModelAliases` 中计算独有的 title 与 description 传入 `processHtmlSEOAndAliases`：
- Title: `${model.name} API 价格、上下文与性能规格｜ModelRadar`
- Description: `${model.name}（${model.provider}）API 输入价格为 ${inputPrice}，输出价格为 ${outputPrice}，上下文窗口 ${context}。提供最新官方计费标准与历史变化记录。`

在 `createCompareAliases` 中计算独有的 title 与 description 传入 `processHtmlSEOAndAliases`：
- Title: `${page.titleLabel} 价格对比与参数评测｜ModelRadar`
- Description: `${page.descriptionLabel}`

在 `createProviderAliases` 中遍历 `getDynamicProviders(dataset)` 生成每个厂商的 index.html 并传入独有 meta。

- [ ] **步骤 4：运行构建测试并检查产物 HTML**

运行命令：`npm run build`
预期：构建完成，检查 `public/model/gpt-5.5/index.html` 与 `public/provider/openai/index.html` 的源码，确认包含独一无二的 `<title>` 和无 JS 的全量正文表格。

- [ ] **步骤 5：Commit**

```bash
git add scripts/prepare-static.js model.html compare.html provider.html
git commit -m "feat(ssg): pre-render head metadata and provider table HTML for static pages"
```

---

### 任务 3：构建全拓扑静态 HTML 内链网络与 Footer 链接优化

**文件：**
- 修改：`scripts/prepare-static.js`
- 修改：`model.html`
- 修改：`provider.html`

- [ ] **步骤 1：在 `modelExtraReplacer` 中优化底部拓扑内链结构**

修改 `getRelatedModelsLinksHtml` 和 `getRelatedCompareLinksHtml`，并在单模型页面底端渲染时增加指向当前厂商主页的静态 HTML 标签链接：

```html
<a href="/provider/${providerSlug}" style="color: var(--brand); font-weight: 700;">查看 ${model.provider} 全部 API 模型 ➔</a>
```

- [ ] **步骤 2：在全站 Footer 模版中注入全厂商静态入口链接**

修改 `model.html`、`compare.html`、`provider.html`、`index.html` 等静态 HTML 文件的 `<footer>` 区域，补充所有已知 AI 厂商的静态链接：

```html
<div style="margin-top: 12px; font-size: 13px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 8px;">
  <span>厂商导航：</span>
  <a href="/provider/openai">OpenAI</a> ·
  <a href="/provider/anthropic">Anthropic</a> ·
  <a href="/provider/deepseek">DeepSeek</a> ·
  <a href="/provider/google">Google</a> ·
  <a href="/provider/kimi">月之暗面</a> ·
  <a href="/provider/qwen">阿里通义</a> ·
  <a href="/provider/doubao">字节豆包</a> ·
  <a href="/provider/hunyuan">腾讯混元</a>
</div>
```

- [ ] **步骤 3：验证静态内链可爬行性**

运行命令：`npm run build`
检查 `public/model/claude-sonnet-5/index.html` 源码，确认包含到同厂商模型、厂商主页 `/provider/anthropic` 和热门对比页的超链接。

- [ ] **步骤 4：Commit**

```bash
git add scripts/prepare-static.js model.html compare.html provider.html index.html rankings.html about.html history.html calculator.html data-schema.html api.html en.html
git commit -m "feat(seo): add rich static internal link topology and provider footer links"
```

---

### 任务 4：扩充 `scripts/check-structured-data.js` 静态断言与自校验

**文件：**
- 修改：`scripts/check-structured-data.js`

- [ ] **步骤 1：增加针对 HTML 源码 `<title>` 唯一性与 Description 格式的自动化检查**

在 `scripts/check-structured-data.js` 中新增断言函数 `checkHtmlSeoMetadata(filePath, html)`：
1. 校验 `public/model/*/index.html` 页面不能包含通用的 `模型详情｜ModelRadar` 默认 Title；
2. 校验 `public/provider/*/index.html` 不能包含通用的 `厂商详情｜ModelRadar` 默认 Title 且正文中 `#modelTableBody` 不能为空；
3. 校验 `public/compare/*/index.html` 不能包含通用的 `AI 模型对比｜ModelRadar` 默认 Title。

```javascript
// 在 checkHtmlFile 中添加：
if (parts[0] === 'public') {
  if (parts[1] === 'model' && parts[3] === 'index.html') {
    if (html.includes('<title>模型详情｜ModelRadar</title>')) {
      errors.push(`${relativePath}: model detail static page must not use default non-unique title`);
    }
  }
  if (parts[1] === 'provider' && parts[3] === 'index.html') {
    if (html.includes('<title>厂商详情｜ModelRadar</title>')) {
      errors.push(`${relativePath}: provider static page must not use default non-unique title`);
    }
    if (!html.includes('<tbody id="modelTableBody"><tr>')) {
      errors.push(`${relativePath}: provider static page model table body is empty`);
    }
  }
  if (parts[1] === 'compare' && parts[3] === 'index.html') {
    if (html.includes('<title>AI 模型对比｜ModelRadar</title>')) {
      errors.push(`${relativePath}: compare static page must not use default non-unique title`);
    }
  }
}
```

- [ ] **步骤 2：运行 `schema:check` 测试**

运行命令：`npm run schema:check`
预期：输出 `[schema] JSON-LD checks passed` 且零 Error。

- [ ] **步骤 3：Commit**

```bash
git add scripts/check-structured-data.js
git commit -m "test(seo): enforce static title uniqueness and pre-rendered content assertions"
```

---

### 任务 5：全流程自动化构建校验与成果回归断言

**文件：**
- 构建产物全量测试

- [ ] **步骤 1：运行全量更新与构建流程**

运行命令：`npm run build && npm run schema:check`
预期：全部打包步骤和 Schema / SEO 断言校验成功。

- [ ] **步骤 2：运行 sitemap 完整校验脚本**

运行命令：`node scripts/lib/sitemap-check.js` (或者检查现有的 sitemap 校验命令)
预期：所有 310+ URLs 均能正常被解析无死链。

- [ ] **步骤 3： Commit 与推送**

```bash
git status
```
确认工作区干净，完成任务交接。
