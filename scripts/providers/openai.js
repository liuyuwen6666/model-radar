const cheerio = require("cheerio");

const OPENAI_PRICING_URL = "https://openai.com/api/pricing/";

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseUsdPer1M(line) {
  const match = normalizeWhitespace(line).match(/\$([\d.,]+)\s*\/\s*1M\s*tokens/i);

  if (!match) {
    return null;
  }

  return Number(match[1].replace(/,/g, ""));
}

function splitTextLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function findPriceBlock(heading) {
  const titleBlock = heading.parent();
  let cursor = titleBlock.next();

  while (cursor.length) {
    const headingCount = cursor.find("h2").length;
    const hasPriceHeading = normalizeWhitespace(cursor.find("h3").first().text()) === "Price";

    if (hasPriceHeading) {
      return cursor;
    }

    if (headingCount > 0) {
      return null;
    }
    cursor = cursor.next();
  }

  return null;
}

function extractPriceMap($, priceBlock) {
  const priceMap = {};

  priceBlock.find("div").each((_, row) => {
    const rowText = normalizeWhitespace($(row).text());
    const match = rowText.match(/^(Input|Cached input|Output|Audio|Text|Image):\s*(.+)$/i);

    if (!match) {
      return;
    }

    const label = normalizeWhitespace(match[1]).toLowerCase();
    const price = parseUsdPer1M(match[2]);

    if (price !== null) {
      priceMap[label] = price;
    }
  });

  return priceMap;
}

function extractModelsFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const updatedAt = options.updatedAt || new Date().toISOString();
  const sourceUrl = options.url || OPENAI_PRICING_URL;
  const results = [];

  $("h2").each((_, element) => {
    const name = normalizeWhitespace($(element).text());

    if (!name || !/^gpt/i.test(name)) {
      return;
    }

    const priceBlock = findPriceBlock($(element));

    if (!priceBlock) {
      return;
    }

    const priceMap = extractPriceMap($, priceBlock);
    const hasMixedModalities = ["audio", "image", "text"].some((label) => label in priceMap);
    const inputPrice = priceMap.input ?? null;
    const outputPrice = priceMap.output ?? null;

    if (hasMixedModalities || inputPrice === null || outputPrice === null) {
      return;
    }

    const model = {
      id: `openai-${slugify(name)}`,
      name,
      provider: "OpenAI",
      input_price_usd_per_1m: inputPrice,
      output_price_usd_per_1m: outputPrice,
      source_url: sourceUrl,
      updated_at: updatedAt
    };

    console.log(
      `[openai] parsed ${model.name} input=${model.input_price_usd_per_1m} output=${model.output_price_usd_per_1m}`
    );
    results.push(model);
  });

  return results;
}

async function fetchOpenAIModels(options = {}) {
  const sourceUrl = options.url || OPENAI_PRICING_URL;
  const updatedAt = options.updatedAt || new Date().toISOString();

  if (options.html) {
    console.log(`[openai] parsing provided HTML for ${sourceUrl}`);
    const models = extractModelsFromHtml(options.html, { url: sourceUrl, updatedAt });
    console.log(`[openai] extracted ${models.length} models from provided HTML`);
    return models;
  }

  console.log(`[openai] fetching ${sourceUrl}`);
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

  console.log(`[openai] response status ${response.status}`);

  if (!response.ok) {
    throw new Error(`OpenAI pricing request failed with status ${response.status}`);
  }

  const html = await response.text();
  console.log(`[openai] fetched ${html.length} HTML characters`);

  const models = extractModelsFromHtml(html, { url: sourceUrl, updatedAt });
  console.log(`[openai] extracted ${models.length} models`);

  return models;
}

module.exports = fetchOpenAIModels;
