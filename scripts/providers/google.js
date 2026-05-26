const cheerio = require("cheerio");

const GOOGLE_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing?hl=en";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\bUSD\s*/gi, "$")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseUsdAmount(value, options = {}) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  
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

function extractModelsFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const headingsAndTables = $("h2, table.pricing-table");
  let currentH2 = null;
  const h2ToTables = new Map();
  const results = [];
  
  const updatedAt = options.updatedAt || new Date().toISOString();
  const sourceUrl = options.sourceUrl || GOOGLE_PRICING_URL;
  
  headingsAndTables.each((_, el) => {
    const tagName = el.name || el.tagName || "";
    if (tagName.toLowerCase() === 'h2') {
      const name = $(el).text().trim().replace(/\s+/g, ' ');
      const isTextChatModel = /gemini/i.test(name) && 
                              !/image|audio|tts|embedding|robotics|computer|tool|agent/i.test(name);
      if (isTextChatModel) {
        currentH2 = el;
        h2ToTables.set(currentH2, []);
      } else {
        currentH2 = null;
      }
    } else if (tagName.toLowerCase() === 'table' && currentH2) {
      h2ToTables.get(currentH2).push(el);
    }
  });
  
  for (const [h2, h2Tables] of h2ToTables.entries()) {
    const name = $(h2).text().trim().replace(/\s+/g, ' ');
    if (h2Tables.length === 0) continue;
    
    // Find standard table (inside tabpanel-standard, or first table)
    let standardTable = h2Tables.find(t => {
      let parent = $(t).parent();
      while (parent.length && parent[0] !== $("body")[0]) {
        const parentId = parent.attr("id") || "";
        if (parentId === 'tabpanel-standard') {
          return true;
        }
        parent = parent.parent();
      }
      return false;
    });
    
    if (!standardTable) {
      standardTable = h2Tables[0];
    }
    
    // Map table rows
    const rowMap = new Map();
    $(standardTable).find("tr").each((_, tr) => {
      const cells = [];
      $(tr).find("th, td").each((_, td) => {
        cells.push($(td).text().trim().replace(/\s+/g, ' '));
      });
      if (cells.length > 0) {
        rowMap.set(cells[0].toLowerCase(), cells);
      }
    });
    
    // Find input and output rows
    const findPricingRow = (pattern) => {
      return Array.from(rowMap.entries()).find(([label]) => pattern.test(label))?.[1] || null;
    };
    
    const inputRow = findPricingRow(/^(input price|precio de entrada|input\b)/i);
    const outputRow = findPricingRow(/^(output price|precio de salida|output\b)/i);
    const cacheRow = findPricingRow(/^(context caching price|caching price|caching\b)/i);
    
    if (!inputRow || !outputRow) {
      console.warn(`[google] missing input/output rows for ${name}`);
      continue;
    }
    
    const paidInputCell = inputRow[inputRow.length - 1];
    const paidOutputCell = outputRow[outputRow.length - 1];
    const inputPrice = parseUsdAmount(paidInputCell, { preferText: true });
    const outputPrice = parseUsdAmount(paidOutputCell);
    
    if (inputPrice === null || outputPrice === null) {
      console.warn(`[google] failed to parse prices for ${name}`);
      continue;
    }
    
    let cacheReadPrice = null;
    if (cacheRow) {
      const paidCacheCell = cacheRow[cacheRow.length - 1];
      cacheReadPrice = parseUsdAmount(paidCacheCell);
    }
    
    const modelId = `google-${slugify(name)}`;
    results.push({
      id: modelId,
      name: name,
      provider: "Google",
      input_price_usd_per_1m: inputPrice,
      output_price_usd_per_1m: outputPrice,
      cache_read_price_usd_per_1m: cacheReadPrice,
      cache_write_price_usd_per_1m: Math.round(inputPrice * 0.25 * 10000) / 10000,
      source_url: sourceUrl,
      updated_at: updatedAt
    });
  }
  
  return results;
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
