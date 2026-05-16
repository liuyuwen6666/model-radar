const cheerio = require("cheerio");

const ANTHROPIC_PRICING_URL = "https://www.anthropic.com/pricing";
const MODEL_ID_MAP = {
  sonnet: "anthropic-claude-3-7-sonnet",
  haiku: "anthropic-claude-3-5-haiku"
};

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

function resolveModelIdentity(title) {
  const normalized = normalizeWhitespace(title);

  if (/\bsonnet\b/i.test(normalized)) {
    return {
      family: "sonnet",
      id: MODEL_ID_MAP.sonnet,
      name: normalizeModelName(normalized)
    };
  }

  if (/\bhaiku\b/i.test(normalized)) {
    return {
      family: "haiku",
      id: MODEL_ID_MAP.haiku,
      name: normalizeModelName(normalized)
    };
  }

  return null;
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
      source_url: sourceUrl,
      updated_at: updatedAt
    };

    seenIds.add(model.id);
    console.log(
      `[anthropic] parsed ${model.name} -> ${model.id} input=${model.input_price_usd_per_1m} output=${model.output_price_usd_per_1m}`
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
