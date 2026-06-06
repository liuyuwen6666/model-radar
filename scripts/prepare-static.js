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

async function createModelAliases(dataset) {
  const models = Array.isArray(dataset?.models) ? dataset.models : [];

  for (const model of models) {
    if (!model || typeof model.id !== "string" || !model.id.trim()) {
      continue;
    }

    const encodedId = encodeURIComponent(model.id.trim());
    await copyEntry("model.html", path.join("model", encodedId, "index.html"));
  }

  console.log(`[build] generated ${models.length} model clean-route aliases`);
}

async function createCompareAliases() {
  for (const page of FIXED_COMPARE_PAGES) {
    await copyEntry("compare.html", path.join("compare", page.slug, "index.html"));
  }

  console.log(`[build] generated ${FIXED_COMPARE_PAGES.length} fixed compare landing pages`);
}

async function createProviderAliases() {
  for (const provider of FIXED_PROVIDERS) {
    await copyEntry("provider.html", path.join("provider", provider.slug, "index.html"));
  }

  console.log(`[build] generated ${FIXED_PROVIDERS.length} provider landing pages`);
}

async function main() {
  console.log("[build] syncing sitemap.xml from data/models.json");
  const { dataset } = await writeSitemapFromDatasetPath({
    datasetPath: MODELS_PATH,
    sitemapPath: SITEMAP_PATH
  });

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

  for (const entry of STATIC_ENTRIES) {
    await copyEntry(entry);
  }

  for (const alias of ROUTE_ALIASES) {
    await copyEntry(alias.source, alias.target);
  }

  await createModelAliases(dataset);
  await createCompareAliases();
  await createProviderAliases();

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
