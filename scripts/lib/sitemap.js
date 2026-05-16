const fs = require("node:fs/promises");
const { FIXED_COMPARE_PAGES } = require("./compare-pages");
const { FIXED_PROVIDERS } = require("./provider-pages");

const DEFAULT_SITE_ORIGIN = "https://modelradar.cn";
const SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";
const PRIORITY_COMPARE_PAIRS = [
  ["deepseek-v4-flash", "anthropic-claude-3-7-sonnet"],
  ["deepseek-v4-flash", "openai-gpt-5-5"],
  ["anthropic-claude-3-7-sonnet", "openai-gpt-5-5"]
];

function normalizeSiteOrigin(siteOrigin = process.env.MODEL_RADAR_SITE_ORIGIN || DEFAULT_SITE_ORIGIN) {
  return String(siteOrigin || DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");
}

function resolveEffectiveDate(dataset) {
  if (dataset && typeof dataset.effectiveDate === "string" && dataset.effectiveDate) {
    return dataset.effectiveDate;
  }

  if (dataset && typeof dataset.generatedAt === "string" && dataset.generatedAt) {
    return dataset.generatedAt.slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function appendEntry(entries, seen, loc, lastmod) {
  if (!loc || seen.has(loc)) {
    return;
  }

  seen.add(loc);
  entries.push({ loc, lastmod });
}

function buildSitemapEntries(dataset, siteOrigin = normalizeSiteOrigin()) {
  const origin = normalizeSiteOrigin(siteOrigin);
  const effectiveDate = resolveEffectiveDate(dataset);
  const models = Array.isArray(dataset?.models) ? dataset.models : [];
  const entries = [];
  const seen = new Set();

  appendEntry(entries, seen, `${origin}/`, effectiveDate);
  appendEntry(entries, seen, `${origin}/history`, effectiveDate);
  appendEntry(entries, seen, `${origin}/rankings`, effectiveDate);
  appendEntry(entries, seen, `${origin}/compare`, effectiveDate);
  appendEntry(entries, seen, `${origin}/data/models.json`, effectiveDate);
  appendEntry(entries, seen, `${origin}/data/changelog.json`, effectiveDate);
  appendEntry(entries, seen, `${origin}/data/history/${effectiveDate}.json`, effectiveDate);

  for (const model of models) {
    if (!model || typeof model.id !== "string" || !model.id.trim()) {
      continue;
    }

    const encodedId = encodeURIComponent(model.id.trim());
    appendEntry(entries, seen, `${origin}/model?id=${encodedId}`, effectiveDate);
  }

  for (const [leftId, rightId] of PRIORITY_COMPARE_PAIRS) {
    const left = encodeURIComponent(leftId);
    const right = encodeURIComponent(rightId);
    appendEntry(entries, seen, `${origin}/compare?left=${left}&right=${right}`, effectiveDate);
  }

  for (const page of FIXED_COMPARE_PAGES) {
    appendEntry(entries, seen, `${origin}/compare/${page.slug}`, effectiveDate);
  }

  for (const provider of FIXED_PROVIDERS) {
    appendEntry(entries, seen, `${origin}/provider/${provider.slug}`, effectiveDate);
  }

  return entries;
}

function buildSitemapXml(entries) {
  const lines = [`<urlset xmlns="${SITEMAP_NAMESPACE}">`];

  for (const entry of Array.isArray(entries) ? entries : []) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);

    if (entry.lastmod) {
      lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    }

    lines.push("  </url>");
  }

  lines.push("</urlset>", "");
  return lines.join("\n");
}

async function loadDatasetFromPath(datasetPath) {
  const raw = await fs.readFile(datasetPath, "utf8");
  return JSON.parse(raw);
}

async function writeSitemapForDataset({ dataset, sitemapPath, siteOrigin }) {
  const entries = buildSitemapEntries(dataset, siteOrigin);
  await fs.writeFile(sitemapPath, buildSitemapXml(entries), "utf8");
  return entries;
}

async function writeSitemapFromDatasetPath({ datasetPath, sitemapPath, siteOrigin }) {
  const dataset = await loadDatasetFromPath(datasetPath);
  const entries = await writeSitemapForDataset({ dataset, sitemapPath, siteOrigin });
  return { dataset, entries };
}

module.exports = {
  buildSitemapEntries,
  buildSitemapXml,
  loadDatasetFromPath,
  normalizeSiteOrigin,
  resolveEffectiveDate,
  writeSitemapForDataset,
  writeSitemapFromDatasetPath
};
