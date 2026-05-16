const cheerio = require("cheerio");

const GOOGLE_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing?hl=en";
const MODEL_CONFIGS = [
  {
    id: "google-gemini-2-5-flash",
    name: "Gemini 2.5 Flash",
    headingId: "gemini-2.5-flash",
    fallbackInputPrice: 0.3,
    fallbackOutputPrice: 2.5
  },
  {
    id: "google-gemini-2-5-pro",
    name: "Gemini 2.5 Pro",
    headingId: "gemini-2.5-pro",
    fallbackInputPrice: 1.25,
    fallbackOutputPrice: 10
  }
];

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeMoneyText(value) {
  return normalizeWhitespace(value)
    .replace(/\u00a0/g, " ")
    .replace(/\bUSD\s*/gi, "$")
    .replace(/\s+/g, " ");
}

function parseUsdAmount(value, options = {}) {
  const normalized = normalizeMoneyText(value);

  if (!normalized) {
    return null;
  }

  if (options.preferText) {
    const textMatch = normalized.match(
      /\$([\d.,]+)\s*\((?:text|texto)(?:\s*[\/,]|(?:\s+or\s+)|(?:\s+o\s+))?(?:\s*(?:image|imagen))?(?:\s*[\/,]|(?:\s+or\s+)|(?:\s+o\s+))?(?:\s*(?:video|vídeo))?\)/i
    );

    if (textMatch) {
      return Number(textMatch[1].replace(/,/g, ""));
    }
  }

  const firstMatch = normalized.match(/\$([\d.,]+)/);
  return firstMatch ? Number(firstMatch[1].replace(/,/g, "")) : null;
}

function findModelSection($, modelConfig) {
  const heading = $("h2")
    .filter((_, element) => {
      const id = $(element).attr("id");
      const text = normalizeWhitespace($(element).text());
      return id === modelConfig.headingId || text.toLowerCase() === modelConfig.name.toLowerCase();
    })
    .first();

  return heading.length ? heading.closest(".models-section") : null;
}

function findStandardPricingTable($, modelSection) {
  if (!modelSection || !modelSection.length) {
    return null;
  }

  let cursor = modelSection.next();

  while (cursor.length) {
    if (cursor.hasClass("models-section")) {
      return null;
    }

    const table = cursor.find("table.pricing-table").first();

    if (table.length) {
      return table;
    }

    cursor = cursor.next();
  }

  return null;
}

function getPricingRows($, table) {
  const rows = new Map();

  table.find("tr").each((_, row) => {
    const cells = $(row)
      .find("th,td")
      .toArray()
      .map((cell) => normalizeWhitespace($(cell).text()))
      .filter(Boolean);

    if (cells.length > 0) {
      rows.set(cells[0].toLowerCase(), cells);
    }
  });

  return rows;
}

function findPricingRow(rowMap, pattern) {
  return Array.from(rowMap.entries()).find(([label]) => pattern.test(label))?.[1] || null;
}

function makeModel(modelConfig, inputPrice, outputPrice, options = {}) {
  return {
    id: modelConfig.id,
    name: modelConfig.name,
    provider: "Google",
    input_price_usd_per_1m: inputPrice,
    output_price_usd_per_1m: outputPrice,
    source_url: options.sourceUrl || GOOGLE_PRICING_URL,
    updated_at: options.updatedAt || new Date().toISOString()
  };
}

function makeFallbackModel(modelConfig, options = {}) {
  console.warn(
    `[google] using fallback pricing for ${modelConfig.name}: input=${modelConfig.fallbackInputPrice} output=${modelConfig.fallbackOutputPrice}`
  );
  return makeModel(modelConfig, modelConfig.fallbackInputPrice, modelConfig.fallbackOutputPrice, options);
}

function extractModelFromTable($, modelConfig, table, options = {}) {
  const rowMap = getPricingRows($, table);
  const inputRow = findPricingRow(rowMap, /^(input price|precio de entrada)\b/i);
  const outputRow = findPricingRow(rowMap, /^(output price|precio de salida)\b/i);

  if (!inputRow || !outputRow) {
    console.warn(`[google] missing input/output rows for ${modelConfig.name}`);
    return null;
  }

  const paidInputCell = inputRow[inputRow.length - 1];
  const paidOutputCell = outputRow[outputRow.length - 1];
  const inputPrice = parseUsdAmount(paidInputCell, { preferText: true });
  const outputPrice = parseUsdAmount(paidOutputCell);

  if (inputPrice === null || outputPrice === null) {
    console.warn(`[google] missing parsed prices for ${modelConfig.name}`);
    return null;
  }

  const model = makeModel(modelConfig, inputPrice, outputPrice, options);
  console.log(
    `[google] parsed ${model.name} -> ${model.id} input=${model.input_price_usd_per_1m} output=${model.output_price_usd_per_1m}`
  );

  return model;
}

function extractModelsFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const models = [];

  for (const modelConfig of MODEL_CONFIGS) {
    const modelSection = findModelSection($, modelConfig);

    if (!modelSection || !modelSection.length) {
      console.warn(`[google] heading not found for ${modelConfig.name}`);
      models.push(makeFallbackModel(modelConfig, options));
      continue;
    }

    const table = findStandardPricingTable($, modelSection);

    if (!table) {
      console.warn(`[google] pricing table not found for ${modelConfig.name}`);
      models.push(makeFallbackModel(modelConfig, options));
      continue;
    }

    models.push(extractModelFromTable($, modelConfig, table, options) || makeFallbackModel(modelConfig, options));
  }

  return models;
}

async function fetchHtml(url) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9"
      }
    });

    console.log(`[google] response status ${response.status} for ${response.url}`);

    if (!response.ok) {
      throw new Error(`Google pricing request failed with status ${response.status}`);
    }

    return {
      html: await response.text(),
      finalUrl: response.url || url
    };
  } catch (error) {
    if (url !== GOOGLE_PRICING_URL) {
      console.warn(
        `[google] fetch failed for ${url}: ${error.message}. Retrying canonical ${GOOGLE_PRICING_URL}`
      );
      return fetchHtml(GOOGLE_PRICING_URL);
    }

    throw error;
  }
}

async function fetchGoogleModels(options = {}) {
  const sourceUrl = options.url || GOOGLE_PRICING_URL;
  const updatedAt = options.updatedAt || new Date().toISOString();

  if (options.html) {
    console.log(`[google] parsing provided HTML for ${sourceUrl}`);
    const models = extractModelsFromHtml(options.html, { sourceUrl, updatedAt });
    console.log(`[google] extracted ${models.length} models from provided HTML`);
    return models;
  }

  console.log(`[google] fetching ${sourceUrl}`);
  const { html, finalUrl } = await fetchHtml(sourceUrl);
  console.log(`[google] fetched ${html.length} HTML characters`);

  const models = extractModelsFromHtml(html, {
    sourceUrl: finalUrl.replace(/\?hl=[^&]+$/i, ""),
    updatedAt
  });

  console.log(`[google] extracted ${models.length} models`);
  return models;
}

module.exports = fetchGoogleModels;
