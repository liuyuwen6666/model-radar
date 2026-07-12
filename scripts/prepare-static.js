/**
 * @file prepare-static.js
 * 
 * @description
 * 【静态页面构建与路由别名准备脚本】
 * 本脚本是项目在发布/部署前的核心静态页面生成器（SSG 辅助工具）。
 * 由于本项目是一个部署在 Cloudflare 上的纯静态站点，为了在没有动态服务器后端的情况下实现优雅路由（即 Pretty URLs，如：
 * 访问 `/about` 实际渲染 `about.html`；访问 `/model/openai-gpt-5-5` 实际渲染模型详情页且不带后缀），
 * 本脚本会在构建阶段（build 步骤）执行以下操作：
 * 1. 同步站点地图：读取最新的模型数据集，在根目录下重新同步生成 sitemap.xml。
 * 2. 清理发布目录：清空用于存放最终发布资源的 `public/` 文件夹。
 * 3. 拷贝基础资源：将根目录下的 HTML 页面、数据目录（data/）和媒体资源（assets/）安全拷贝到 `public/` 下。
 * 4. 创建伪静态路由目录别名：
 *    - 基础页面：如将 `about.html` 写入 `public/about/index.html`，使用户访问 `/about` 路由时，托管服务器能自适应加载。
 *    - 模型详情页：读取 `models.json` 中的模型 ID，将 `model.html` 循环拷贝为 `public/model/<model-id>/index.html`。
 *    - 对比页及厂商页：根据预设的对比和厂商列表，将对应的模板拷贝为别名路径。
 * 
 * @usage
 * 本脚本在本地执行打包或 Cloudflare 线上 Git 集成自动部署时，在 `npm run build` 流程中被自动触发：
 * $ npm run build   (内部会先调用 node scripts/prepare-static.js，再运行 Tailwind CSS 编译)
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { writeSitemapFromDatasetPath } = require("./lib/sitemap");
const { FIXED_COMPARE_PAGES } = require("./lib/compare-pages");
const { FIXED_PROVIDERS } = require("./lib/provider-pages");

const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const MODELS_PATH = path.join(ROOT_DIR, "data", "models.json");
const SITEMAP_PATH = path.join(ROOT_DIR, "sitemap.xml");
const STATIC_ENTRIES = [
  "index.html",
  "about.html",
  "history.html",
  "model.html",
  "compare.html",
  "rankings.html",
  "provider.html",
  "calculator.html",
  "data-schema.html",
  "api.html",
  "robots.txt",
  "sitemap.xml",
  "_headers",
  "data"
];
const ROUTE_ALIASES = [
  {
    source: "en.html",
    target: path.join("en", "index.html")
  },
  {
    source: "about.html",
    target: path.join("about", "index.html")
  },
  {
    source: "history.html",
    target: path.join("history", "index.html")
  },
  {
    source: "rankings.html",
    target: path.join("rankings", "index.html")
  },
  {
    source: "model.html",
    target: path.join("model", "index.html")
  },
  {
    source: "compare.html",
    target: path.join("compare", "index.html")
  },
  {
    source: "provider.html",
    target: path.join("provider", "index.html")
  },
  {
    source: "calculator.html",
    target: path.join("calculator", "index.html")
  },
  {
    source: "data-schema.html",
    target: path.join("data-schema", "index.html")
  },
  {
    source: "api.html",
    target: path.join("api", "index.html")
  }
];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyEntry(sourceRelativePath, targetRelativePath = sourceRelativePath) {
  const sourcePath = path.join(ROOT_DIR, sourceRelativePath);
  const targetPath = path.join(PUBLIC_DIR, targetRelativePath);
  const sourceStats = await fs.stat(sourcePath);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, {
    force: true,
    recursive: sourceStats.isDirectory()
  });

  console.log(`[build] copied ${sourceRelativePath} -> public/${targetRelativePath}`);
}

async function processHtmlSEOAndAliases(targetRelativePath, newCanonicalUrl, aliases, extraReplacer = null) {
  const targetPath = path.join(PUBLIC_DIR, targetRelativePath);
  let content = await fs.readFile(targetPath, "utf8");

  // 1. 注入 MODEL_ID_ALIASES 全局变量
  if (aliases && !content.includes("window.MODEL_ID_ALIASES")) {
    const scriptTag = `\n  <script>window.MODEL_ID_ALIASES = ${JSON.stringify(aliases)};</script>`;
    content = content.replace(/<head>/i, `<head>${scriptTag}`);
  }

  // 2. 重写 canonical (如果传了的话)
  if (newCanonicalUrl) {
    content = content.replace(
      /<link\s+rel=["']canonical["']\s+href=["']([\s\S]*?)["']\s*\/?>/i,
      `<link rel="canonical" href="${newCanonicalUrl}" />`
    );
    content = content.replace(
      /<meta\s+property=["']og:url["']\s+content=["']([\s\S]*?)["']\s*\/?>/i,
      `<meta property="og:url" content="${newCanonicalUrl}" />`
    );
  }

  // 3. 执行额外的文本替换（主要用于 SSG 预渲染和内链注入）
  if (extraReplacer && typeof extraReplacer === "function") {
    content = extraReplacer(content);
  }

  await fs.writeFile(targetPath, content, "utf8");
}

function validateAliases(aliases, dataset) {
  console.log("[build] validating aliases.json...");
  const models = Array.isArray(dataset?.models) ? dataset.models : [];
  const modelIds = new Set(models.map(m => m.id));

  for (const [alias, target] of Object.entries(aliases)) {
    // 1. Value 必须物理存在
    if (!modelIds.has(target)) {
      throw new Error(`Alias target model ID '${target}' for alias '${alias}' does not exist in models.json!`);
    }

    // 2. 避免循环映射
    if (alias === target) {
      throw new Error(`Alias '${alias}' points to itself!`);
    }

    let visited = new Set([alias]);
    let current = target;
    while (aliases[current]) {
      if (visited.has(current)) {
        throw new Error(`Circular alias mapping detected: ${Array.from(visited).join(' -> ')} -> ${current}`);
      }
      visited.add(current);
      current = aliases[current];
    }
  }

  console.log("[build] aliases.json validation passed.");
}

async function generateRedirects(aliases) {
  console.log("[build] generating public/_redirects...");
  const lines = [];
  const seenSourcePaths = new Set();

  for (const [alias, target] of Object.entries(aliases)) {
    const source1 = `/model/${alias}`;
    const source2 = `/model/${alias}/`;
    const dest = `/model/${target}`;

    if (seenSourcePaths.has(source1)) {
      throw new Error(`Duplicate redirect source rule detected in _redirects generation: ${source1}`);
    }
    seenSourcePaths.add(source1);
    lines.push(`${source1} ${dest} 301`);

    if (seenSourcePaths.has(source2)) {
      throw new Error(`Duplicate redirect source rule detected in _redirects generation: ${source2}`);
    }
    seenSourcePaths.add(source2);
    lines.push(`${source2} ${dest} 301`);
  }

  const redirectsPath = path.join(PUBLIC_DIR, "_redirects");
  await fs.writeFile(redirectsPath, lines.join("\n") + "\n", "utf8");
  console.log(`[build] public/_redirects generated successfully with ${lines.length} rules.`);
}

function generateDescriptionText(model) {
  const name = model.name || model.id;
  const provider = model.provider || "未知";
  const family = model.family || "优秀";
  const capabilities = Array.isArray(model.capabilities) && model.capabilities.length ? model.capabilities.join("、") : "文本处理与逻辑推理";
  const inputPrice = model.inputPriceUsdPer1M !== null ? `$${model.inputPriceUsdPer1M}` : "待更新";
  const outputPrice = model.outputPriceUsdPer1M !== null ? `$${model.outputPriceUsdPer1M}` : "待更新";
  const context = model.contextWindow ? `${(model.contextWindow / 1000).toFixed(0)}K` : "待更新";
  const sourceLabel = model.sourceLabel || "官方公开定价";
  const dateStr = model.updatedAt ? model.updatedAt.slice(0, 10) : "近期";

  return `${name} 是由 AI 厂商 ${provider} 推出的 ${family} 系列模型，主要适用于 ${capabilities} 等应用场景。当前 API 的输入价格为每百万 tokens ${inputPrice}，输出价格为每百万 tokens ${outputPrice}。该模型提供了高达 ${context} 的上下文窗口长度，价格更新于 ${dateStr}，并且是基于 ${sourceLabel} 的计费标准。`;
}

function getRelatedModelsLinksHtml(currentModel, allModels) {
  const sameProviderModels = allModels.filter(m => m.provider === currentModel.provider && m.id !== currentModel.id).slice(0, 4);
  if (sameProviderModels.length === 0) {
    return '<li style="color:var(--muted);font-size:14px;">暂无同厂商其他模型推荐。</li>';
  }
  return sameProviderModels.map(m => {
    const encodedId = encodeURIComponent(m.id.trim());
    return `<li style="margin-bottom: 8px;"><a href="/model/${encodedId}" style="font-size: 14px; color: var(--brand); font-weight: 600; text-decoration: underline;">${m.name} API 定价与性能详情 ➔</a></li>`;
  }).join('');
}

function getRelatedCompareLinksHtml(currentModel) {
  const providerName = currentModel.provider || "";
  const modelId = currentModel.id || "";
  
  const matches = FIXED_COMPARE_PAGES.filter(p => {
    return (p.leftId && p.leftId === modelId) || 
           (p.rightId && p.rightId === modelId) || 
           (p.titleLabel && p.titleLabel.toLowerCase().includes(providerName.toLowerCase()));
  }).slice(0, 3);

  const finalPages = matches.length ? matches : FIXED_COMPARE_PAGES.slice(0, 3);

  return finalPages.map(p => {
    return `<li style="margin-bottom: 8px;"><a href="/compare/${p.slug}" style="font-size: 14px; color: var(--brand); font-weight: 600; text-decoration: underline;">${p.titleLabel} 价格比对评测 ➔</a></li>`;
  }).join('');
}

function modelExtraReplacer(content, model, allModels) {
  // 1. 隐藏 loadingState 盒子，展现 modelView
  content = content.replace(/id="loadingState"/i, 'id="loadingState" hidden');
  content = content.replace(/id="modelView"\s+hidden/i, 'id="modelView"');

  // 2. 注入首屏静态信息
  const descriptionText = generateDescriptionText(model);
  const inputPrice = model.inputPriceUsdPer1M !== null ? `$${model.inputPriceUsdPer1M.toFixed(4).replace(/\.?0+$/, '')}` : "待更新";
  const outputPrice = model.outputPriceUsdPer1M !== null ? `$${model.outputPriceUsdPer1M.toFixed(4).replace(/\.?0+$/, '')}` : "待更新";
  const context = model.contextWindow ? `${(model.contextWindow / 1000).toFixed(0)}K` : "待更新";
  
  content = content.replace(/<h1 id="modelName">模型名称<\/h1>/i, `<h1 id="modelName">${model.name}</h1>`);
  content = content.replace(/<p id="modelDescription">模型描述<\/p>/i, `<p id="modelDescription">${descriptionText}</p>`);
  
  content = content.replace(/<strong id="inputPriceStat">-<\/strong>/i, `<strong id="inputPriceStat">${inputPrice}</strong>`);
  content = content.replace(/<strong id="outputPriceStat">-<\/strong>/i, `<strong id="outputPriceStat">${outputPrice}</strong>`);
  content = content.replace(/<strong id="contextStat">-<\/strong>/i, `<strong id="contextStat">${context}</strong>`);

  // 3. 快照数据注入
  content = content.replace(/<strong id="providerValue">-<\/strong>/i, `<strong id="providerValue">${model.provider}</strong>`);
  
  const cacheParts = [];
  if (typeof model.cacheWritePriceUsdPer1M === 'number') {
    cacheParts.push(`写入 $${model.cacheWritePriceUsdPer1M.toFixed(4).replace(/\.?0+$/, '')}`);
  }
  if (typeof model.cacheReadPriceUsdPer1M === 'number') {
    cacheParts.push(`读取 $${model.cacheReadPriceUsdPer1M.toFixed(4).replace(/\.?0+$/, '')}`);
  }
  const cacheSummary = cacheParts.length ? cacheParts.join(' / ') : '无';
  content = content.replace(/<strong id="cacheValue">-<\/strong>/i, `<strong id="cacheValue">${cacheSummary}</strong>`);
  
  const statusStr = model.sourceType === 'provider' ? '官方来源抓取' : '自备蓝图数据';
  content = content.replace(/<strong id="statusValue">-<\/strong>/i, `<strong id="statusValue">${statusStr}</strong>`);
  content = content.replace(/id="updatedLabel">最后更新：未知/i, `id="updatedLabel">最后更新：${model.updatedAt ? model.updatedAt.slice(0, 10) : '近期'}`);

  // 4. #detailGrid 静态卡片组组装
  const gridHtml = `
    <div class="info-item"><span>模型 ID</span><strong>${model.id}</strong></div>
    <div class="info-item"><span>所属厂商</span><strong>${model.provider}</strong></div>
    <div class="info-item"><span>计量单位</span><strong>${model.billingUnit || '1M tokens'}</strong></div>
    <div class="info-item"><span>输入价格</span><strong>${inputPrice}</strong></div>
    <div class="info-item"><span>输出价格</span><strong>${outputPrice}</strong></div>
    <div class="info-item"><span>最大上下文</span><strong>${context}</strong></div>
    <div class="info-item"><span>更新日期</span><strong>${model.updatedAt ? model.updatedAt.slice(0, 10) : '近期'}</strong></div>
  `;
  content = content.replace(/<div class="detail-grid" id="detailGrid"><\/div>/i, `<div class="detail-grid" id="detailGrid">${gridHtml}</div>`);

  // 5. 注入 JSON-LD 面包屑与产品 Schema
  const providerSlug = (model.provider || '').toLowerCase().replace(/\s+/g, '-');
  const encodedId = encodeURIComponent(model.id.trim());
  const schemaHtml = `
  <script id="modelStructuredData" type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "${model.name}",
    "description": "${descriptionText}",
    "applicationCategory": "AI Model",
    "operatingSystem": "All",
    "provider": {
      "@type": "Organization",
      "name": "${model.provider}"
    },
    "offers": {
      "@type": "Offer",
      "price": "${model.inputPriceUsdPer1M || 0}",
      "priceCurrency": "USD",
      "description": "输入价格: ${inputPrice}, 输出价格: ${outputPrice}"
    }
  }
  </script>
  <script id="breadcrumbStructuredData" type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "首页",
        "item": "https://modelradar.cn/"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "${model.provider}",
        "item": "https://modelradar.cn/provider/${providerSlug}"
      },
      {
        "@type": "ListItem",
        "position": 3,
        "name": "${model.name}",
        "item": "https://modelradar.cn/model/${encodedId}"
      }
    ]
  }
  </script>
  `;
  content = content.replace(/<\/head>/i, `${schemaHtml}\n</head>`);

  // 6. 注入底部拓扑内链
  const relatedModelsHtml = getRelatedModelsLinksHtml(model, allModels);
  const relatedCompareHtml = getRelatedCompareLinksHtml(model);
  const internalLinksHtml = `
<section class="related-links" style="margin-top: 40px; padding-top: 32px; border-top: 2px solid #f1f5f9; background: #fff; border-radius: 8px; padding: 24px;">
  <div class="container" style="max-width: 1200px; margin: 0 auto;">
    <div style="display: grid; grid-template-columns: 1fr; gap: 32px;">
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px; color: #0f172a;">同厂商其他模型推荐</h3>
        <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 12px;" id="relatedModelsLinks">
          ${relatedModelsHtml}
        </ul>
      </div>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 16px; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px; color: #0f172a;">热门模型规格价格对比</h3>
        <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 12px;" id="relatedCompareLinks">
          ${relatedCompareHtml}
        </ul>
      </div>
    </div>
  </div>
</section>
  `;
  content = content.replace(/<\/main>/i, `${internalLinksHtml}\n</main>`);

  return content;
}

function compareExtraReplacer(content, leftModel, rightModel, page) {
  const title = page ? `${page.titleLabel} 价格对比` : `${leftModel.name} vs ${rightModel.name} 价格对比`;
  const desc = page ? page.descriptionLabel : `对比 ${leftModel.name} 与 ${rightModel.name} 的输入价格、输出价格、缓存价格、上下文长度和官方来源，帮助开发团队评估 API 接口调用成本。`;
  
  content = content.replace(/<h1 id="compareHeroTitle">AI 模型对比<\/h1>/i, `<h1 id="compareHeroTitle">${title}</h1>`);
  
  // 支持把 "默认比较..." 或是其他描述替换掉
  content = content.replace(/<p id="compareHeroDescription">默认比较[\s\S]*?<\/p>/i, `<p id="compareHeroDescription">${desc}</p>`);

  const leftInput = leftModel.inputPriceUsdPer1M !== null ? leftModel.inputPriceUsdPer1M : 999999;
  const rightInput = rightModel.inputPriceUsdPer1M !== null ? rightModel.inputPriceUsdPer1M : 999999;
  const isLeftCheaper = leftInput < rightInput;
  const ratio = leftInput && rightInput ? (isLeftCheaper ? rightInput / leftInput : leftInput / rightInput).toFixed(1) : 1;
  const summaryText = isLeftCheaper
    ? `${leftModel.name} 比 ${rightModel.name} 价格更为优惠，输入价约是其 ${ratio} 分之一。`
    : `${rightModel.name} 比 ${leftModel.name} 价格更为优惠，输入价约是其 ${ratio} 分之一。`;

  const summaryHtml = `
    <li>
      <span class="tag green">输入对比</span>
      <div><strong>${summaryText}</strong><br><span class="updated">以上对比数据由 models.json 最新汇率及价格计算得出。</span></div>
    </li>
  `;
  content = content.replace(/<ul class="summary-list" id="summaryList">[\s\S]*?<\/ul>/i, `<ul class="summary-list" id="summaryList">${summaryHtml}</ul>`);

  const formatCompareVal = (val) => val !== null && val !== undefined ? `$${val.toFixed(4).replace(/\.?0+$/, '')}` : '待更新';
  const leftContext = leftModel.contextWindow ? `${(leftModel.contextWindow / 1000).toFixed(0)}K` : '待更新';
  const rightContext = rightModel.contextWindow ? `${(rightModel.contextWindow / 1000).toFixed(0)}K` : '待更新';

  const tableHtml = `
    <tr>
      <td><strong>厂商</strong></td>
      <td>${leftModel.provider}</td>
      <td>${rightModel.provider}</td>
    </tr>
    <tr>
      <td><strong>输入价格 (1M)</strong></td>
      <td class="mono">${formatCompareVal(leftModel.inputPriceUsdPer1M)}</td>
      <td class="mono">${formatCompareVal(rightModel.inputPriceUsdPer1M)}</td>
    </tr>
    <tr>
      <td><strong>输出价格 (1M)</strong></td>
      <td class="mono">${formatCompareVal(leftModel.outputPriceUsdPer1M)}</td>
      <td class="mono">${formatCompareVal(rightModel.outputPriceUsdPer1M)}</td>
    </tr>
    <tr>
      <td><strong>最大上下文</strong></td>
      <td class="mono">${leftContext}</td>
      <td class="mono">${rightContext}</td>
    </tr>
    <tr>
      <td><strong>更新日期</strong></td>
      <td>${leftModel.updatedAt ? leftModel.updatedAt.slice(0, 10) : '近期'}</td>
      <td>${rightModel.updatedAt ? rightModel.updatedAt.slice(0, 10) : '近期'}</td>
    </tr>
  `;
  content = content.replace(/<tbody id="compareTableBody">[\s\S]*?<\/tbody>/i, `<tbody id="compareTableBody">${tableHtml}</tbody>`);

  return content;
}

async function createModelAliases(dataset, aliases) {
  const models = Array.isArray(dataset?.models) ? dataset.models : [];

  for (const model of models) {
    if (!model || typeof model.id !== "string" || !model.id.trim()) {
      continue;
    }

    const encodedId = encodeURIComponent(model.id.trim());
    const aliasPath = path.join("model", encodedId, "index.html");
    await copyEntry("model.html", aliasPath);
    await processHtmlSEOAndAliases(
      aliasPath, 
      `https://modelradar.cn/model/${encodedId}`, 
      aliases,
      (html) => modelExtraReplacer(html, model, models)
    );
  }

  console.log(`[build] generated ${models.length} model clean-route aliases`);
}

async function createCompareAliases(dataset, aliases) {
  const models = Array.isArray(dataset?.models) ? dataset.models : [];
  
  for (const page of FIXED_COMPARE_PAGES) {
    const aliasPath = path.join("compare", page.slug, "index.html");
    await copyEntry("compare.html", aliasPath);
    
    const leftModel = models.find(m => m.id === page.leftId) || { name: page.leftId, provider: "AI" };
    const rightModel = models.find(m => m.id === page.rightId) || { name: page.rightId, provider: "AI" };

    await processHtmlSEOAndAliases(
      aliasPath, 
      `https://modelradar.cn/compare/${page.slug}`, 
      aliases,
      (html) => compareExtraReplacer(html, leftModel, rightModel, page)
    );
  }

  console.log(`[build] generated ${FIXED_COMPARE_PAGES.length} fixed compare landing pages`);
}

async function createProviderAliases(aliases) {
  for (const provider of FIXED_PROVIDERS) {
    const aliasPath = path.join("provider", provider.slug, "index.html");
    await copyEntry("provider.html", aliasPath);
    await processHtmlSEOAndAliases(aliasPath, `https://modelradar.cn/provider/${provider.slug}`, aliases);
  }

  console.log(`[build] generated ${FIXED_PROVIDERS.length} provider landing pages`);
}

async function main() {
  console.log("[build] syncing sitemap.xml from data/models.json");
  const { dataset } = await writeSitemapFromDatasetPath({
    datasetPath: MODELS_PATH,
    sitemapPath: SITEMAP_PATH
  });

  const ALIASES_PATH = path.join(ROOT_DIR, "data", "aliases.json");
  const aliases = require(ALIASES_PATH);
  
  // 校验别名真理源别名与循环链路
  validateAliases(aliases, dataset);

  console.log("[build] clearing public/ contents");
  try {
    const entries = await fs.readdir(PUBLIC_DIR);
    for (const entry of entries) {
      await fs.rm(path.join(PUBLIC_DIR, entry), { recursive: true, force: true });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  // 生成 Cloudflare _redirects 并进行自检冲突
  await generateRedirects(aliases);

  for (const entry of STATIC_ENTRIES) {
    await copyEntry(entry);
    if (entry.endsWith(".html")) {
      await processHtmlSEOAndAliases(entry, null, aliases);
    }
  }

  for (const alias of ROUTE_ALIASES) {
    await copyEntry(alias.source, alias.target);
    await processHtmlSEOAndAliases(alias.target, null, aliases);
  }

  await createModelAliases(dataset, aliases);
  await createCompareAliases(dataset, aliases);
  await createProviderAliases(aliases);

  const assetsPath = path.join(ROOT_DIR, "assets");

  if (await pathExists(assetsPath)) {
    await copyEntry("assets", "assets");
  } else {
    console.log("[build] assets/ not found, skipping");
  }

  console.log("[build] static output ready in public/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
