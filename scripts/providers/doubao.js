const cheerio = require("cheerio");

const DOUBAO_PRICING_URL = "https://www.volcengine.com/docs/82379/1544106?lang=zh";

// Exchange rate CNY -> USD
const CNY_TO_USD = 1 / 7.25;

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\bUSD\s*/gi, "$")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractDoubaoModelsFromMarkdown(mdContent, sourceUrl, updatedAt) {
  const lines = mdContent.split("\n");
  let inSection = false;
  let tableLines = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes("## 在线推理（常规）")) {
      inSection = true;
      continue;
    }
    if (inSection && trimmed.startsWith("##") && !trimmed.includes("在线推理（常规）")) {
      break;
    }
    if (inSection) {
      if (trimmed.startsWith("|")) {
        tableLines.push(trimmed);
      }
    }
  }
  
  if (tableLines.length < 2) {
    console.error("[doubao] could not find pricing table in markdown");
    return [];
  }
  
  const headers = tableLines[0].split("|").map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
  let inputIdx = -1;
  let cacheStorageIdx = -1;
  let cacheReadIdx = -1;
  let outputIdx = -1;

  for (let idx = 0; idx < headers.length; idx++) {
    const h = headers[idx];
    if (h.includes("输入")) {
      if (h.includes("非音频")) {
        inputIdx = idx;
      } else if (inputIdx === -1 && !h.includes("音频")) {
        inputIdx = idx;
      }
    } else if (h.includes("缓存存储")) {
      cacheStorageIdx = idx;
    } else if (h.includes("缓存命中")) {
      if (h.includes("非音频")) {
        cacheReadIdx = idx;
      } else if (cacheReadIdx === -1 && !h.includes("音频")) {
        cacheReadIdx = idx;
      }
    } else if (h.includes("输出")) {
      outputIdx = idx;
    }
  }

  // Fallbacks if not found dynamically
  if (inputIdx === -1) inputIdx = 2;
  if (cacheStorageIdx === -1) cacheStorageIdx = headers.length > 6 ? 4 : 3;
  if (cacheReadIdx === -1) cacheReadIdx = headers.length > 6 ? 5 : 4;
  if (outputIdx === -1) outputIdx = headers.length > 6 ? 7 : 5;

  const results = [];
  let currentModelName = "";
  const maxIdx = Math.max(inputIdx, cacheStorageIdx, cacheReadIdx, outputIdx);
  
  for (let i = 2; i < tableLines.length; i++) {
    const cells = tableLines[i].split("|").map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (cells.length <= maxIdx) continue;
    
    let nameCell = cells[0].replace(/\\-/g, "-");
    if (nameCell) {
      currentModelName = nameCell;
    }
    
    const contextCell = cells[1];
    const inputStr = cells[inputIdx];
    const cacheStorageStr = cells[cacheStorageIdx];
    const cacheReadStr = cells[cacheReadIdx];
    const outputStr = cells[outputIdx];
    
    const inputPriceCny = parseFloat(inputStr);
    const outputPriceCny = parseFloat(outputStr);
    const cacheReadPriceCny = parseFloat(cacheReadStr);
    
    if (isNaN(inputPriceCny) || isNaN(outputPriceCny)) {
      continue;
    }
    
    if (!currentModelName.includes("doubao")) {
      continue;
    }
    
    let displayName = currentModelName;
    if (currentModelName.startsWith("doubao-")) {
      const parts = currentModelName.split("-");
      displayName = "豆包 " + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
    }
    
    let idSuffix = "";
    let nameSuffix = "";
    if (contextCell.includes("[0, 32]")) {
      idSuffix = "-32k";
      nameSuffix = " (32K)";
    } else if (contextCell.includes("(32, 128]")) {
      idSuffix = "-128k";
      nameSuffix = " (128K)";
    } else if (contextCell.includes("(128, 256]")) {
      idSuffix = "-256k";
      nameSuffix = " (256K)";
    }
    
    const modelId = `${currentModelName}${idSuffix}`;
    const modelName = `${displayName}${nameSuffix}`;
    
    const inputPriceUsd = inputPriceCny * CNY_TO_USD;
    const outputPriceUsd = outputPriceCny * CNY_TO_USD;
    const cacheReadPriceUsd = isNaN(cacheReadPriceCny) ? null : cacheReadPriceCny * CNY_TO_USD;
    const cacheWritePriceCny = isNaN(cacheReadPriceCny) ? null : parseFloat(cacheStorageStr);
    
    if (results.some(r => r.id === modelId)) continue;
    
    results.push({
      id: modelId,
      name: modelName,
      provider: "字节豆包",
      currency: "CNY",
      hasOfficialDualCurrency: false,
      inputPricePer1M: inputPriceCny,
      outputPricePer1M: outputPriceCny,
      cacheReadPricePer1M: isNaN(cacheReadPriceCny) ? null : cacheReadPriceCny,
      cacheWritePricePer1M: cacheWritePriceCny,
      input_price_usd_per_1m: Math.round(inputPriceUsd * 10000) / 10000,
      output_price_usd_per_1m: Math.round(outputPriceUsd * 10000) / 10000,
      cache_read_price_usd_per_1m: cacheReadPriceUsd ? Math.round(cacheReadPriceUsd * 10000) / 10000 : null,
      cache_write_price_usd_per_1m: cacheWritePriceCny ? Math.round(cacheWritePriceCny * CNY_TO_USD * 10000) / 10000 : null,
      source_url: sourceUrl,
      updated_at: updatedAt
    });
  }
  
  return results;
}

function extractModelsFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const updatedAt = options.updatedAt || new Date().toISOString();
  const sourceUrl = options.url || DOUBAO_PRICING_URL;
  
  let routerDataText = "";
  $("script").each((_, script) => {
    const text = $(script).text();
    if (text.includes("window._ROUTER_DATA")) {
      routerDataText = text;
    }
  });
  
  if (!routerDataText) {
    console.error("[doubao] could not find window._ROUTER_DATA script tag");
    return [];
  }
  
  const startIndex = routerDataText.indexOf("window._ROUTER_DATA = ");
  if (startIndex === -1) return [];
  
  let jsonText = routerDataText.substring(startIndex + "window._ROUTER_DATA = ".length).trim();
  const lastBraceIndex = jsonText.lastIndexOf("}");
  if (lastBraceIndex !== -1) {
    jsonText = jsonText.substring(0, lastBraceIndex + 1);
  }
  
  try {
    const data = JSON.parse(jsonText);
    let mdContent = "";
    const docsData = data.loaderData;
    
    for (const key of Object.keys(docsData)) {
      if (key.includes("docid") && docsData[key] && docsData[key].curDoc) {
        mdContent = docsData[key].curDoc.MDContent;
        break;
      }
    }
    
    if (!mdContent) {
      console.error("[doubao] could not find MDContent dynamically in router data");
      return [];
    }
    
    return extractDoubaoModelsFromMarkdown(mdContent, sourceUrl, updatedAt);
  } catch (err) {
    console.error("[doubao] failed to parse router data JSON:", err.message);
    return [];
  }
}

// Highly reliable fallback models blueprint
const FALLBACK_DOUBAO_MODELS = [
  {
    id: "doubao-1-5-pro-32k",
    name: "豆包 1.5 Pro 32K",
    provider: "字节豆包",
    currency: "CNY",
    inputPricePer1M: 0.80,
    outputPricePer1M: 2.00,
    cacheReadPricePer1M: 0.16,
    cacheWritePricePer1M: 0.017,
    input_price_usd_per_1m: Math.round(0.80 * CNY_TO_USD * 1000) / 1000,
    output_price_usd_per_1m: Math.round(2.00 * CNY_TO_USD * 1000) / 1000,
    cache_read_price_usd_per_1m: Math.round(0.16 * CNY_TO_USD * 1000) / 1000,
    cache_write_price_usd_per_1m: Math.round(0.017 * CNY_TO_USD * 1000) / 1000,
    source_url: DOUBAO_PRICING_URL
  }
];

async function fetchDoubaoModels(options = {}) {
  const sourceUrl = options.url || DOUBAO_PRICING_URL;
  const updatedAt = options.updatedAt || new Date().toISOString();

  if (options.html) {
    console.log(`[doubao] parsing provided HTML for ${sourceUrl}`);
    const models = extractModelsFromHtml(options.html, { url: sourceUrl, updatedAt });
    if (models.length > 0) {
      console.log(`[doubao] extracted ${models.length} models from HTML`);
      return models;
    }
  }

  try {
    console.log(`[doubao] fetching ${sourceUrl}`);
    const response = await fetch(sourceUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
      }
    });

    if (response.ok) {
      const html = await response.text();
      const models = extractModelsFromHtml(html, { url: sourceUrl, updatedAt });
      if (models.length > 0) {
        console.log(`[doubao] successfully parsed ${models.length} models dynamically`);
        return models;
      }
    }
  } catch (err) {
    console.warn(`[doubao] dynamic fetch failed, using fallback pricing data: ${err.message}`);
  }

  console.log(`[doubao] using robust 2026 fallback dataset`);
  return FALLBACK_DOUBAO_MODELS.map(model => ({
    ...model,
    updated_at: updatedAt
  }));
}

module.exports = fetchDoubaoModels;
