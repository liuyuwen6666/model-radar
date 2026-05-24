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

function parseFirstCny(value) {
  const match = normalizeWhitespace(value).match(/([\d.]+)\s*元/);
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

  const isChinese = rowMap.has("模型");

  const modelRow = rowMap.get(isChinese ? "模型" : "MODEL");
  const versionRow = rowMap.get(isChinese ? "模型版本" : "MODEL VERSION");
  const inputRow = rowMap.get(isChinese ? "百万tokens输入（缓存未命中）" : "1M INPUT TOKENS (CACHE MISS)");
  const pricingRow = rowMap.get(isChinese ? "价格" : "PRICING");
  const outputRow = rowMap.get(isChinese ? "百万tokens输出" : "1M OUTPUT TOKENS");

  if (!modelRow || !versionRow || !inputRow || !outputRow) {
    console.log("[deepseek] required pricing table rows were not found");
    return [];
  }

  const modelKeys = modelRow.slice(1).map(cleanModelKey);
  const modelNames = versionRow.slice(1);
  const inputPrices = inputRow.slice(1).map(isChinese ? parseFirstCny : parseFirstUsd);
  const inputHitPrices = pricingRow ? pricingRow.slice(2).map(isChinese ? parseFirstCny : parseFirstUsd) : [];
  const outputPrices = outputRow.slice(1).map(isChinese ? parseFirstCny : parseFirstUsd);
  const results = [];

  for (let index = 0; index < modelKeys.length; index += 1) {
    const modelKey = modelKeys[index];
    const modelName = modelNameFromVersion(modelNames[index], modelKey);
    const inputPrice = inputPrices[index];
    const inputHitPrice = inputHitPrices[index] !== undefined ? inputHitPrices[index] : null;
    const outputPrice = outputPrices[index];

    if (!modelKey || inputPrice === null || outputPrice === null) {
      continue;
    }

    const model = {
      id: resolveModelId(modelKey),
      name: modelName,
      provider: "DeepSeek",
      currency: isChinese ? "CNY" : "USD",
      inputPricePer1M: inputPrice,
      outputPricePer1M: outputPrice,
      cacheReadPricePer1M: inputHitPrice,
      sourceUrl: sourceUrl,
      updatedAt: updatedAt
    };

    console.log(
      `[deepseek] parsed ${model.name} (${isChinese ? 'CNY' : 'USD'}) input=${model.inputPricePer1M} output=${model.outputPricePer1M}`
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

  const enUrl = "https://api-docs.deepseek.com/quick_start/pricing/";
  const zhUrl = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";

  console.log(`[deepseek] fetching English prices from ${enUrl}`);
  let enHtml = "";
  try {
    const enResponse = await fetch(enUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
      }
    });
    if (enResponse.ok) {
      enHtml = await enResponse.text();
    }
  } catch (err) {
    console.error(`[deepseek] failed to fetch English prices:`, err);
  }

  console.log(`[deepseek] fetching Chinese prices from ${zhUrl}`);
  let zhHtml = "";
  try {
    const zhResponse = await fetch(zhUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9",
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
      }
    });
    if (zhResponse.ok) {
      zhHtml = await zhResponse.text();
    }
  } catch (err) {
    console.error(`[deepseek] failed to fetch Chinese prices:`, err);
  }

  const enModels = enHtml ? extractModelsFromHtml(enHtml, { url: enUrl, updatedAt }) : [];
  const zhModels = zhHtml ? extractModelsFromHtml(zhHtml, { url: zhUrl, updatedAt }) : [];

  const mergedMap = new Map();

  enModels.forEach((m) => {
    mergedMap.set(m.id, {
      id: m.id,
      name: m.name,
      provider: "DeepSeek",
      family: "DeepSeek",
      currency: "CNY",
      hasOfficialDualCurrency: true,
      inputPriceUsdPer1M: m.inputPricePer1M,
      outputPriceUsdPer1M: m.outputPricePer1M,
      cacheReadPriceUsdPer1M: m.cacheReadPricePer1M,
      sourceUrl: zhUrl,
      updatedAt: m.updatedAt
    });
  });

  zhModels.forEach((m) => {
    const existing = mergedMap.get(m.id);
    if (existing) {
      existing.inputPricePer1M = m.inputPricePer1M;
      existing.outputPricePer1M = m.outputPricePer1M;
      existing.cacheReadPricePer1M = m.cacheReadPricePer1M;
    } else {
      mergedMap.set(m.id, {
        id: m.id,
        name: m.name,
        provider: "DeepSeek",
        family: "DeepSeek",
        currency: "CNY",
        hasOfficialDualCurrency: true,
        inputPricePer1M: m.inputPricePer1M,
        outputPricePer1M: m.outputPricePer1M,
        cacheReadPricePer1M: m.cacheReadPricePer1M,
        sourceUrl: zhUrl,
        updatedAt: m.updatedAt
      });
    }
  });

  return Array.from(mergedMap.values());
}

module.exports = fetchDeepSeekModels;
