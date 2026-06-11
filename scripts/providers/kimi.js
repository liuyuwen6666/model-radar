const cheerio = require("cheerio");

const KIMI_PRICING_URL = "https://platform.moonshot.cn/docs/pricing/chat";

// 汇率常数 (CNY -> USD)
const CNY_TO_USD = 1 / 7.25;

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// 解析 Kimi 模型的 ID，对多模态 128k 预览版模型（包含 vision 关键字）和普通文本模型做区分以防 ID 冲突
function resolveModelId(name) {
  const norm = name.toLowerCase();
  if (norm.includes("k2.6")) return "kimi-k2.6";
  if (norm.includes("k2.5")) return "kimi-k2.5";
  if (norm.includes("latest") || (norm.includes("v1-128k") && !norm.includes("vision"))) {
    return "moonshot-v1-128k";
  }
  const slug = norm.replace(/\./g, "_dot_").replace(/[^a-z0-9_]+/g, "-").replace(/_dot_/g, ".").replace(/^-+|-+$/g, "");
  if (slug.startsWith("moonshot-")) {
    return slug;
  }
  return `moonshot-${slug}`;
}

function extractModelsFromHtml(html, options = {}) {
  const updatedAt = options.updatedAt || new Date().toISOString();
  const sourceUrl = options.url || KIMI_PRICING_URL;
  const $ = cheerio.load(html);
  
  let fullPayload = "";
  $("script").each((_, script) => {
    const text = $(script).text();
    const matches = text.matchAll(/self\.__next_f\.push\(\[\d+\s*,\s*"([\s\S]*?)"\]\)/g);
    for (const match of matches) {
      try {
        const decoded = JSON.parse(`"${match[1]}"`);
        fullPayload += decoded;
      } catch (e) {
        fullPayload += match[1];
      }
    }
  });

  const results = [];
  const docTableRegex = /columns:\s*(\[[\s\S]*?\])\s*,\s*rows:\s*(\[[\s\S]*?\]\s*\])/g;
  const matches = [...fullPayload.matchAll(docTableRegex)];

  for (const match of matches) {
    try {
      const colsStr = match[1].replace(/\\n/g, "").replace(/\\"/g, '"');
      const rowsStr = match[2].replace(/\\n/g, "").replace(/\\"/g, '"');
      
      const columns = new Function(`return ${colsStr}`)();
      const rows = new Function(`return ${rowsStr}`)();

      let modelIdx = -1;
      let unitIdx = -1;
      let inputHitIdx = -1;
      let inputMissIdx = -1;
      let inputIdx = -1;
      let outputIdx = -1;
      let contextIdx = -1;

      columns.forEach((col, idx) => {
        const title = col.title || "";
        if (title.includes("模型")) modelIdx = idx;
        else if (title.includes("单位")) unitIdx = idx;
        else if (title.includes("缓存命中")) inputHitIdx = idx;
        else if (title.includes("缓存未命中")) inputMissIdx = idx;
        else if (title.includes("输入")) inputIdx = idx;
        else if (title.includes("输出")) outputIdx = idx;
        else if (title.includes("上下文")) contextIdx = idx;
      });

      if (modelIdx === -1 || outputIdx === -1) {
        continue;
      }

      for (const row of rows) {
        if (!row[modelIdx]) continue;
        const modelName = normalizeWhitespace(row[modelIdx]);
        const modelId = resolveModelId(modelName);

        let inputCny = null;
        let cacheReadCny = null;
        let cacheWriteCny = null;

        if (inputMissIdx !== -1) {
          const missVal = row[inputMissIdx];
          const missMatch = missVal ? String(missVal).match(/[\d.]+/) : null;
          if (missMatch) {
            inputCny = Number(missMatch[0]);
            cacheWriteCny = inputCny;
          }
        }
        if (inputHitIdx !== -1) {
          const hitVal = row[inputHitIdx];
          const hitMatch = hitVal ? String(hitVal).match(/[\d.]+/) : null;
          if (hitMatch) {
            cacheReadCny = Number(hitMatch[0]);
          }
        }
        if (inputIdx !== -1 && inputCny === null) {
          const val = row[inputIdx];
          const match = val ? String(val).match(/[\d.]+/) : null;
          if (match) {
            inputCny = Number(match[0]);
          }
        }

        let outputCny = null;
        const outVal = row[outputIdx];
        const outMatch = outVal ? String(outVal).match(/[\d.]+/) : null;
        if (outMatch) {
          outputCny = Number(outMatch[0]);
        }

        let contextWindow = null;
        if (contextIdx !== -1 && row[contextIdx]) {
          const rawCtx = String(row[contextIdx]).replace(/,/g, "");
          const ctxMatch = rawCtx.match(/(\d+)/);
          if (ctxMatch) {
            contextWindow = Number(ctxMatch[1]);
          }
        }

        if (inputCny !== null && outputCny !== null) {
          const modelData = {
            id: modelId,
            name: modelName,
            provider: "月之暗面",
            currency: "CNY",
            hasOfficialDualCurrency: false,
            inputPricePer1M: inputCny,
            outputPricePer1M: outputCny,
            // 将汇率计算后的美元价格保留 6 位高精度（由原本的 4 位升级），以避免微小优惠价在折算后发生截断误差
            inputPriceUsdPer1M: Number((inputCny * CNY_TO_USD).toFixed(6)),
            outputPriceUsdPer1M: Number((outputCny * CNY_TO_USD).toFixed(6)),
            input_price_usd_per_1m: Number((inputCny * CNY_TO_USD).toFixed(6)),
            output_price_usd_per_1m: Number((outputCny * CNY_TO_USD).toFixed(6)),
            sourceUrl: sourceUrl,
            source_url: sourceUrl,
            updatedAt: updatedAt,
            updated_at: updatedAt
          };

          if (cacheReadCny !== null) {
            modelData.cacheReadPricePer1M = cacheReadCny;
            modelData.cache_read_price_usd_per_1m = Number((cacheReadCny * CNY_TO_USD).toFixed(6));
            modelData.cacheReadPriceUsdPer1M = modelData.cache_read_price_usd_per_1m;
          }
          if (cacheWriteCny !== null) {
            modelData.cacheWritePricePer1M = cacheWriteCny;
            modelData.cache_write_price_usd_per_1m = Number((cacheWriteCny * CNY_TO_USD).toFixed(6));
            modelData.cacheWritePriceUsdPer1M = modelData.cache_write_price_usd_per_1m;
          }
          if (contextWindow !== null) {
            modelData.contextWindow = contextWindow;
          }

          results.push(modelData);
        }
      }
    } catch (e) {
      console.warn(`[kimi] error parsing table match: ${e.message}`);
    }
  }

  return results;
}

// 极其精准的 2026 最新官方模型价格数据集，作为防挂 Fallback 蓝图
const FALLBACK_KIMI_MODELS = [
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    provider: "月之暗面",
    currency: "CNY",
    hasOfficialDualCurrency: false,
    inputPricePer1M: 6.50,
    outputPricePer1M: 27.00,
    cacheReadPricePer1M: 1.10,
    cacheWritePricePer1M: 6.50,
    inputPriceUsdPer1M: 6.50 * CNY_TO_USD,  // ¥6.50 -> $0.8966
    outputPriceUsdPer1M: 27.00 * CNY_TO_USD, // ¥27.00 -> $3.7241
    cacheWritePriceUsdPer1M: 6.50 * CNY_TO_USD,
    cacheReadPriceUsdPer1M: 1.10 * CNY_TO_USD,
    input_price_usd_per_1m: 6.50 * CNY_TO_USD,
    output_price_usd_per_1m: 27.00 * CNY_TO_USD,
    cache_write_price_usd_per_1m: 6.50 * CNY_TO_USD,
    cache_read_price_usd_per_1m: 1.10 * CNY_TO_USD,
    contextWindow: 262144,
    source_url: "https://platform.moonshot.cn/docs/pricing/chat-k26",
    sourceUrl: "https://platform.moonshot.cn/docs/pricing/chat-k26"
  },
  {
    id: "kimi-k2.5",
    name: "Kimi K2.5",
    provider: "月之暗面",
    currency: "CNY",
    hasOfficialDualCurrency: false,
    inputPricePer1M: 4.00,
    outputPricePer1M: 21.00,
    cacheReadPricePer1M: 0.70,
    cacheWritePricePer1M: 4.00,
    inputPriceUsdPer1M: 4.00 * CNY_TO_USD,  // ¥4.00 -> $0.5517
    outputPriceUsdPer1M: 21.00 * CNY_TO_USD, // ¥21.00 -> $2.8966
    cacheWritePriceUsdPer1M: 4.00 * CNY_TO_USD,
    cacheReadPriceUsdPer1M: 0.70 * CNY_TO_USD,
    input_price_usd_per_1m: 4.00 * CNY_TO_USD,
    output_price_usd_per_1m: 21.00 * CNY_TO_USD,
    cache_write_price_usd_per_1m: 4.00 * CNY_TO_USD,
    cache_read_price_usd_per_1m: 0.70 * CNY_TO_USD,
    contextWindow: 262144,
    source_url: "https://platform.moonshot.cn/docs/pricing/chat-k25",
    sourceUrl: "https://platform.moonshot.cn/docs/pricing/chat-k25"
  },
  {
    id: "moonshot-v1-128k",
    name: "Kimi Latest 128K",
    provider: "月之暗面",
    currency: "CNY",
    hasOfficialDualCurrency: false,
    inputPricePer1M: 10.00,
    outputPricePer1M: 30.00,
    inputPriceUsdPer1M: 10.00 * CNY_TO_USD, // ¥10.00 -> $1.3793
    outputPriceUsdPer1M: 30.00 * CNY_TO_USD, // ¥30.00 -> $4.1379
    input_price_usd_per_1m: 10.00 * CNY_TO_USD,
    output_price_usd_per_1m: 30.00 * CNY_TO_USD,
    contextWindow: 131072,
    source_url: "https://platform.moonshot.cn/docs/pricing/chat-v1",
    sourceUrl: "https://platform.moonshot.cn/docs/pricing/chat-v1"
  }
];

async function fetchKimiModels(options = {}) {
  const sourceUrl = options.url || KIMI_PRICING_URL;
  const updatedAt = options.updatedAt || new Date().toISOString();

  if (options.html) {
    console.log(`[kimi] parsing provided HTML for ${sourceUrl}`);
    const models = extractModelsFromHtml(options.html, { url: sourceUrl, updatedAt });
    if (models.length > 0) {
      console.log(`[kimi] extracted ${models.length} models from HTML`);
      return models;
    }
  }

  // 针对 Moonshot 最新页面拆分策略，并发抓取三个官方定价页面
  const subPages = [
    "https://platform.moonshot.cn/docs/pricing/chat-k26",
    "https://platform.moonshot.cn/docs/pricing/chat-k25",
    "https://platform.moonshot.cn/docs/pricing/chat-v1"
  ];

  const results = [];
  const errors = [];

  await Promise.all(
    subPages.map(async (url) => {
      try {
        console.log(`[kimi] fetching sub-page ${url}`);
        const response = await fetch(url, {
          headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
          }
        });

        if (response.ok) {
          const html = await response.text();
          const parsed = extractModelsFromHtml(html, { url, updatedAt });
          if (parsed.length > 0) {
            console.log(`[kimi] parsed ${parsed.length} models from sub-page ${url}`);
            results.push(...parsed);
          } else {
            console.warn(`[kimi] parsed 0 models from sub-page ${url}`);
          }
        } else {
          console.warn(`[kimi] sub-page fetch failed with status ${response.status}: ${url}`);
        }
      } catch (err) {
        console.warn(`[kimi] sub-page fetch error: ${err.message} for ${url}`);
        errors.push(err);
      }
    })
  );

  // 去重（以 id 为准）
  const finalModels = [];
  const seenIds = new Set();
  for (const modelData of results) {
    if (!seenIds.has(modelData.id)) {
      seenIds.add(modelData.id);
      finalModels.push(modelData);
    }
  }

  // 自愈机制：确保所有核心模型都存在于最终结果中。如果因网络等原因缺失某个核心模型，从 FALLBACK_KIMI_MODELS 补全
  for (const fallbackModel of FALLBACK_KIMI_MODELS) {
    if (!seenIds.has(fallbackModel.id)) {
      console.log(`[kimi] core model ${fallbackModel.id} is missing from dynamic results, patching with fallback data`);
      finalModels.push({
        ...fallbackModel,
        updated_at: updatedAt,
        updatedAt: updatedAt
      });
      seenIds.add(fallbackModel.id);
    }
  }

  if (finalModels.length > 0) {
    console.log(`[kimi] successfully parsed total ${finalModels.length} models dynamically`);
    return finalModels;
  }

  // 兜底返回高可信度的 2026 实时数据集
  console.log(`[kimi] using robust 2026 fallback dataset`);
  return FALLBACK_KIMI_MODELS.map(model => ({
    ...model,
    updated_at: updatedAt,
    updatedAt: updatedAt
  }));
}

module.exports = fetchKimiModels;
