const fs = require("node:fs/promises");
const path = require("node:path");
const { writeSitemapFromDatasetPath } = require("./lib/sitemap");

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
