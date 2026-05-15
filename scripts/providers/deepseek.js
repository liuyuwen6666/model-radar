const cheerio = require("cheerio");

const DEEPSEEK_PRICING_URL = "https://api-docs.deepseek.com/quick_start/pricing/";
const MODEL_ID_MAP = {
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-pro",
  "deepseek-v4-flash": "deepseek-v4-flash",
  "deepseek-v4-pro": "deepseek-v4-pro"
};

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseFirstUsd(value) {
  const match = normalizeWhitespace(value).match(/\$([\d.]+)/);
  return match ? Number(match[1]) : null;
}

function getRowMap($) {
  const rows = new Map();

  $("table tr").each((_, row) => {
    const cells = $(row)
      .find("th,td")
      .toArray()
      .map((cell) => normalizeWhitespace($(cell).text()))
      .filter(Boolean);

    if (cells.length > 0) {
      rows.set(cells[0], cells);
    }
  });

  return rows;
}

function cleanModelKey(value) {
  return normalizeWhitespace(value).replace(/\(\d+\)$/g, "");
}

function modelNameFromVersion(value, fallback) {
  const normalized = normalizeWhitespace(value).replace(/-/g, " ");
  return normalized || fallback;
}

function resolveModelId(modelKey) {
  const stableId = MODEL_ID_MAP[modelKey];

  if (stableId) {
    console.log(`[deepseek] mapped ${modelKey} -> ${stableId}`);
    return stableId;
  }

  const fallbackId = slugify(modelKey);
  console.log(`[deepseek] unknown model key ${modelKey}, fallback id ${fallbackId}`);
  return fallbackId;
}

function extractModelsFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const updatedAt = options.updatedAt || new Date().toISOString();
  const sourceUrl = options.url || DEEPSEEK_PRICING_URL;
  const rowMap = getRowMap($);

  const modelRow = rowMap.get("MODEL");
  const versionRow = rowMap.get("MODEL VERSION");
  const inputRow = rowMap.get("1M INPUT TOKENS (CACHE MISS)");
  const outputRow = rowMap.get("1M OUTPUT TOKENS");

  if (!modelRow || !versionRow || !inputRow || !outputRow) {
    console.log("[deepseek] required pricing table rows were not found");
    return [];
  }

  const modelKeys = modelRow.slice(1).map(cleanModelKey);
  const modelNames = versionRow.slice(1);
  const inputPrices = inputRow.slice(1).map(parseFirstUsd);
  const outputPrices = outputRow.slice(1).map(parseFirstUsd);
  const results = [];

  for (let index = 0; index < modelKeys.length; index += 1) {
    const modelKey = modelKeys[index];
    const modelName = modelNameFromVersion(modelNames[index], modelKey);
    const inputPrice = inputPrices[index];
    const outputPrice = outputPrices[index];

    if (!modelKey || inputPrice === null || outputPrice === null) {
      continue;
    }

    const model = {
      id: resolveModelId(modelKey),
      name: modelName,
      provider: "DeepSeek",
      input_price_usd_per_1m: inputPrice,
      output_price_usd_per_1m: outputPrice,
      source_url: sourceUrl,
      updated_at: updatedAt
    };

    console.log(
      `[deepseek] parsed ${model.name} input=${model.input_price_usd_per_1m} output=${model.output_price_usd_per_1m}`
    );
    results.push(model);
  }

  return results;
}

async function fetchDeepSeekModels(options = {}) {
  const sourceUrl = options.url || DEEPSEEK_PRICING_URL;
  const updatedAt = options.updatedAt || new Date().toISOString();

  if (options.html) {
    console.log(`[deepseek] parsing provided HTML for ${sourceUrl}`);
    const models = extractModelsFromHtml(options.html, { url: sourceUrl, updatedAt });
    console.log(`[deepseek] extracted ${models.length} models from provided HTML`);
    return models;
  }

  console.log(`[deepseek] fetching ${sourceUrl}`);
  const response = await fetch(sourceUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    }
  });

  console.log(`[deepseek] response status ${response.status}`);

  if (!response.ok) {
    throw new Error(`DeepSeek pricing request failed with status ${response.status}`);
  }

  const html = await response.text();
  console.log(`[deepseek] fetched ${html.length} HTML characters`);

  const models = extractModelsFromHtml(html, { url: sourceUrl, updatedAt });
  console.log(`[deepseek] extracted ${models.length} models`);

  return models;
}

module.exports = fetchDeepSeekModels;
