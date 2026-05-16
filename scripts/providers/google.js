const cheerio = require("cheerio");

const GOOGLE_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing";
const MODEL_CONFIGS = [
  {
    id: "google-gemini-2-5-pro",
    name: "Gemini 2.5 Pro",
    headingPattern: /^gemini 2\.5 pro$/i
  },
  {
    id: "google-gemini-2-5-flash",
    name: "Gemini 2.5 Flash",
    headingPattern: /^gemini 2\.5 flash$/i
  }
];

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseUsdAmount(value, options = {}) {
  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return null;
  }

  if (options.preferText) {
    const textMatch = normalized.match(
      /\$([\d.,]+)\s*\((?:text(?:\s*\/\s*image(?:\s*\/\s*video)?)?|text\/image(?:\/video)?)\)/i
    );

    if (textMatch) {
      return Number(textMatch[1].replace(/,/g, ""));
    }
  }

  const firstMatch = normalized.match(/\$([\d.,]+)/);
  return firstMatch ? Number(firstMatch[1].replace(/,/g, "")) : null;
}

function findModelHeading($, modelConfig) {
  return $("h2")
    .filter((_, element) => modelConfig.headingPattern.test(normalizeWhitespace($(element).text())))
    .first();
}

function findStandardPricingTable($, heading) {
  let cursor = heading.closest(".models-section").next();

  while (cursor.length) {
    if (cursor.hasClass("models-section")) {
      break;
    }

    const standardSection = cursor
      .find("section")
      .filter((_, section) => {
        const title = normalizeWhitespace($(section).find("h3").first().text());
        return /^standard$/i.test(title);
      })
      .first();

    if (standardSection.length) {
      const table = standardSection.find("table.pricing-table").first();

      if (table.length) {
        return table;
      }
    }

    if (cursor.find("h2").length) {
      break;
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
      rows.set(cells[0], cells);
    }
  });

  return rows;
}

function extractModelFromTable($, modelConfig, table, options = {}) {
  const rowMap = getPricingRows($, table);
  const inputRowEntry =
    Array.from(rowMap.entries()).find(([label]) => /^input price\b/i.test(label)) || null;
  const outputRowEntry =
    Array.from(rowMap.entries()).find(([label]) => /^output price\b/i.test(label)) || null;

  if (!inputRowEntry || !outputRowEntry) {
    console.warn(`[google] missing input/output rows for ${modelConfig.name}`);
    return null;
  }

  const [, inputRow] = inputRowEntry;
  const [, outputRow] = outputRowEntry;
  const inputPrice = parseUsdAmount(inputRow[2], { preferText: true });
  const outputPrice = parseUsdAmount(outputRow[2]);

  if (inputPrice === null || outputPrice === null) {
    console.warn(`[google] missing parsed prices for ${modelConfig.name}`);
    return null;
  }

  const model = {
    id: modelConfig.id,
    name: modelConfig.name,
    provider: "Google",
    input_price_usd_per_1m: inputPrice,
    output_price_usd_per_1m: outputPrice,
    source_url: options.sourceUrl || GOOGLE_PRICING_URL,
    updated_at: options.updatedAt || new Date().toISOString()
  };

  console.log(
    `[google] parsed ${model.name} -> ${model.id} input=${model.input_price_usd_per_1m} output=${model.output_price_usd_per_1m}`
  );

  return model;
}

function extractModelsFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const models = [];

  for (const modelConfig of MODEL_CONFIGS) {
    const heading = findModelHeading($, modelConfig);

    if (!heading.length) {
      console.warn(`[google] heading not found for ${modelConfig.name}`);
      continue;
    }

    const table = findStandardPricingTable($, heading);

    if (!table) {
      console.warn(`[google] Standard pricing table not found for ${modelConfig.name}`);
      continue;
    }

    const model = extractModelFromTable($, modelConfig, table, options);

    if (model) {
      models.push(model);
    }
  }

  if (models.length === 0) {
    console.warn("[google] extracted 0 models, update.js will keep fallback pricing");
  }

  return models;
}

async function fetchHtml(url) {
  try {
    const response = await fetch(url, {
      headers: {
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
