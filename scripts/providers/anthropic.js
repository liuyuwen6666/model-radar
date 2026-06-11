const cheerio = require("cheerio");

const ANTHROPIC_PRICING_URL = "https://claude.com/pricing";
function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeModelName(value) {
  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return "";
  }

  return /^claude\b/i.test(normalized) ? normalized : `Claude ${normalized}`;
}

function parseUsdPerMTok(value, label) {
  const pattern = new RegExp(`${label}\\s*\\$([\\d.,]+)\\s*\\/\\s*MTok`, "i");
  const match = normalizeWhitespace(value).match(pattern);

  if (!match) {
    return null;
  }

  return Number(match[1].replace(/,/g, ""));
}

/**
 * 动态提取并解析 Anthropic 模型标识符 (ID) 与展示名称
 * @description 取消原有的硬编码映射，通过正则提取模型家族（Family）与版本号（Version），
 * 并根据 canonical 拼装规则自动转换为官方 API 直接接收的 ID 参数（如 `claude-opus-4-8`）。
 * @param {string} title - 来自官方定价 HTML 中 h3 元素的模型名称标题 (如 "Opus 4.8", "Fable 5")
 * @returns {Object|null} 包含 id, name, family 的标识对象，若解析失败返回 null
 */
function resolveModelIdentity(title) {
  const normalized = normalizeWhitespace(title);

  // 匹配已知模型家族名 (fable, opus, sonnet, haiku) 及后面的数字版本号
  const match = normalized.match(/\b(fable|opus|sonnet|haiku)\b\s*([\d.]+)?/i);
  if (!match) {
    return null;
  }

  const family = match[1].toLowerCase();
  const version = match[2] || "";

  // 拼装 ID：形如 `claude-${family}-${version}`（其中点号转为短横线）
  let id = `claude-${family}`;
  if (version) {
    id += `-${version.replace(/\./g, "-")}`;
  }

  // 针对 Haiku 4.5 的 API ID 进行特殊映射（官方附带了特定的日期后缀）
  if (id === "claude-haiku-4-5") {
    id = "claude-haiku-4-5-20251001";
  }

  return {
    family,
    id,
    name: normalizeModelName(normalized)
  };
}

function findPriceCard(heading) {
  let cursor = heading.parent();

  while (cursor.length) {
    const text = normalizeWhitespace(cursor.text());
    const hasInputPrice = /Input\s*\$[\d.,]+\s*\/\s*MTok/i.test(text);
    const hasOutputPrice = /Output\s*\$[\d.,]+\s*\/\s*MTok/i.test(text);

    if (hasInputPrice && hasOutputPrice) {
      return cursor;
    }

    cursor = cursor.parent();
  }

  return null;
}

function extractModelsFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const updatedAt = options.updatedAt || new Date().toISOString();
  const sourceUrl = options.url || ANTHROPIC_PRICING_URL;
  const seenIds = new Set();
  const results = [];

  $("h3").each((_, element) => {
    const heading = $(element);
    const rawTitle = normalizeWhitespace(heading.text());
    const identity = resolveModelIdentity(rawTitle);

    if (!identity) {
      return;
    }

    if (seenIds.has(identity.id)) {
      console.log(`[anthropic] skipping duplicate ${rawTitle} mapped to ${identity.id}`);
      return;
    }

    const priceCard = findPriceCard(heading);

    if (!priceCard) {
      console.log(`[anthropic] price card not found for ${rawTitle}`);
      return;
    }

    const cardText = normalizeWhitespace(priceCard.text());
    const inputPrice = parseUsdPerMTok(cardText, "Input");
    const outputPrice = parseUsdPerMTok(cardText, "Output");
    
    // Parse prompt caching prices
    const cacheWrite = parseUsdPerMTok(cardText, "Write");
    const cacheRead = parseUsdPerMTok(cardText, "Read");

    if (inputPrice === null || outputPrice === null) {
      console.log(`[anthropic] missing input/output price for ${rawTitle}`);
      return;
    }

    const model = {
      id: identity.id,
      name: identity.name,
      provider: "Anthropic",
      input_price_usd_per_1m: inputPrice,
      output_price_usd_per_1m: outputPrice,
      cache_write_price_usd_per_1m: cacheWrite,
      cache_read_price_usd_per_1m: cacheRead,
      source_url: sourceUrl,
      updated_at: updatedAt
    };

    seenIds.add(model.id);
    console.log(
      `[anthropic] parsed ${model.name} -> ${model.id} input=${model.input_price_usd_per_1m} output=${model.output_price_usd_per_1m} cacheWrite=${model.cache_write_price_usd_per_1m} cacheRead=${model.cache_read_price_usd_per_1m}`
    );
    results.push(model);
  });

  return results;
}

async function fetchAnthropicModels(options = {}) {
  const sourceUrl = options.url || ANTHROPIC_PRICING_URL;
  const updatedAt = options.updatedAt || new Date().toISOString();

  if (options.html) {
    console.log(`[anthropic] parsing provided HTML for ${sourceUrl}`);
    const models = extractModelsFromHtml(options.html, { url: sourceUrl, updatedAt });
    console.log(`[anthropic] extracted ${models.length} models from provided HTML`);
    return models;
  }

  console.log(`[anthropic] fetching ${sourceUrl}`);
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

  console.log(`[anthropic] response status ${response.status}`);

  if (!response.ok) {
    throw new Error(`Anthropic pricing request failed with status ${response.status}`);
  }

  const html = await response.text();
  console.log(`[anthropic] fetched ${html.length} HTML characters`);

  const models = extractModelsFromHtml(html, { url: sourceUrl, updatedAt });
  console.log(`[anthropic] extracted ${models.length} models`);

  return models;
}

module.exports = fetchAnthropicModels;
