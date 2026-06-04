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
  const normalized = normalizeWhitespace(value);
  const matchWithDollar = normalized.match(/\$([\d.]+)/);
  if (matchWithDollar) return Number(matchWithDollar[1]);
  const matchNumber = normalized.match(/([\d.]+)/);
  return matchNumber ? Number(matchNumber[1]) : null;
}

function parseFirstCny(value) {
  const normalized = normalizeWhitespace(value);
  const matchWithYuan = normalized.match(/([\d.]+)\s*元/);
  if (matchWithYuan) return Number(matchWithYuan[1]);
  const matchWithYenSign = normalized.match(/¥\s*([\d.]+)/);
  if (matchWithYenSign) return Number(matchWithYenSign[1]);
  const matchNumber = normalized.match(/([\d.]+)/);
  return matchNumber ? Number(matchNumber[1]) : null;
}

function buildTableGrid($, tableEl) {
  const grid = [];
  const trs = $(tableEl).find("tr");
  
  trs.each((r, tr) => {
    if (!grid[r]) {
      grid[r] = [];
    }
    
    let c = 0;
    $(tr).find("th, td").each((_, cell) => {
      while (grid[r][c] !== undefined) {
        c++;
      }
      
      const text = normalizeWhitespace($(cell).text());
      const rowspan = parseInt($(cell).attr("rowspan") || "1", 10);
      const colspan = parseInt($(cell).attr("colspan") || "1", 10);
      
      for (let dr = 0; dr < rowspan; dr++) {
        const nr = r + dr;
        if (!grid[nr]) {
          grid[nr] = [];
        }
        for (let dc = 0; dc < colspan; dc++) {
          grid[nr][c + dc] = text;
        }
      }
      
      c += colspan;
    });
  });
  
  return grid;
}

function cleanModelKey(value) {
  return normalizeWhitespace(value).replace(/\s*\(\d+\)$/g, "").trim();
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

function findRowByLabel(grid, regex) {
  return grid.find(row => 
    row.slice(0, 2).some(cell => regex.test(cell))
  );
}

function extractModelsFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const updatedAt = options.updatedAt || new Date().toISOString();
  const sourceUrl = options.url || DEEPSEEK_PRICING_URL;

  console.log(`[deepseek] analyzing page structure for ${sourceUrl}`);

  // Find pricing table
  let pricingTable = null;
  $("table").each((_, table) => {
    const text = $(table).text();
    if (/模型|MODEL|PRICING|价格/i.test(text)) {
      pricingTable = table;
      return false; // break
    }
  });

  if (!pricingTable) {
    console.log("[deepseek] pricing table not found");
    return [];
  }

  const grid = buildTableGrid($, pricingTable);
  console.log(`[deepseek] built 2D matrix: ${grid.length} rows, ${grid[0] ? grid[0].length : 0} columns`);

  const modelRow = findRowByLabel(grid, /^(模型|MODEL)$/i);
  const versionRow = findRowByLabel(grid, /^(模型版本|MODEL VERSION)$/i);
  const inputRow = findRowByLabel(grid, /(缓存未命中|CACHE MISS)/i);
  const inputHitRow = findRowByLabel(grid, /(缓存命中|CACHE HIT)/i);
  const outputRow = findRowByLabel(grid, /(百万tokens输出|1M OUTPUT TOKENS)/i);

  console.log(`[deepseek] row detection:
    - model row: ${modelRow ? 'found' : 'missing'}
    - version row: ${versionRow ? 'found' : 'missing'}
    - input row (cache miss): ${inputRow ? 'found' : 'missing'}
    - input hit row (cache hit): ${inputHitRow ? 'found' : 'missing'}
    - output row: ${outputRow ? 'found' : 'missing'}`);

  if (!modelRow || !versionRow || !inputRow || !outputRow) {
    console.log("[deepseek] required pricing table rows were not found");
    return [];
  }

  const results = [];
  const isChinese = /模型/i.test(modelRow[0]);
  const currency = isChinese ? "CNY" : "USD";

  for (let col = 2; col < modelRow.length; col += 1) {
    const modelKey = cleanModelKey(modelRow[col]);
    const modelName = modelNameFromVersion(versionRow[col], modelKey);
    const inputPrice = isChinese ? parseFirstCny(inputRow[col]) : parseFirstUsd(inputRow[col]);
    const inputHitPrice = inputHitRow ? (isChinese ? parseFirstCny(inputHitRow[col]) : parseFirstUsd(inputHitRow[col])) : null;
    const outputPrice = isChinese ? parseFirstCny(outputRow[col]) : parseFirstUsd(outputRow[col]);

    if (!modelKey || inputPrice === null || outputPrice === null) {
      continue;
    }

    const model = {
      id: resolveModelId(modelKey),
      name: modelName,
      provider: "DeepSeek",
      currency: currency,
      inputPricePer1M: inputPrice,
      outputPricePer1M: outputPrice,
      cacheReadPricePer1M: inputHitPrice,
      sourceUrl: sourceUrl,
      updatedAt: updatedAt
    };

    console.log(
      `[deepseek] parsed ${model.name} (${currency}) input=${model.inputPricePer1M} output=${model.outputPricePer1M} cacheRead=${model.cacheReadPricePer1M}`
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
