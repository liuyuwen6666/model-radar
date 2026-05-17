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
  "history.html",
  "model.html",
  "compare.html",
  "rankings.html",
  "provider.html",
  "calculator.html",
  "data-schema.html",
  "robots.txt",
  "sitemap.xml",
  "data"
];
const ROUTE_ALIASES = [
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

  console.log("[build] clearing public/");
  await fs.rm(PUBLIC_DIR, { recursive: true, force: true });
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
