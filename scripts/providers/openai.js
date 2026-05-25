const cheerio = require("cheerio");

const OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/pricing";

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanPrice(priceStr) {
  if (!priceStr || priceStr === '-' || priceStr === '—') return null;
  const match = priceStr.match(/\$([\d.,]+)/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ''));
}

function formatDisplayName(name) {
  let formatted = name.replace(/^gpt/i, 'GPT');
  formatted = formatted.replace(/-mini/i, ' mini');
  formatted = formatted.replace(/-nano/i, ' nano');
  formatted = formatted.replace(/-pro/i, ' pro');
  formatted = formatted.replace(/-codex/i, ' Codex');
  return formatted;
}

function extractModelsFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const updatedAt = options.updatedAt || new Date().toISOString();
  const sourceUrl = options.url || OPENAI_PRICING_URL;
  const results = [];

  $('table').each((_, tableElement) => {
    $(tableElement).find('tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 4) return;

      const cells = [];
      tds.each((_, td) => {
        cells.push(normalizeWhitespace($(td).text()));
      });

      let modelIndex = 0;
      if (!/^gpt/i.test(cells[0]) && /^gpt/i.test(cells[1])) {
        modelIndex = 1;
      }

      const rawName = cells[modelIndex];
      if (!rawName || !/^gpt/i.test(rawName)) return;

      let shortInput = null;
      let shortOutput = null;
      let longInput = null;
      let longOutput = null;

      if (cells.length - modelIndex >= 7) {
        shortInput = cleanPrice(cells[modelIndex + 1]);
        shortOutput = cleanPrice(cells[modelIndex + 3]);
        longInput = cleanPrice(cells[modelIndex + 4]);
        longOutput = cleanPrice(cells[modelIndex + 6]);
      } else if (cells.length - modelIndex >= 4) {
        shortInput = cleanPrice(cells[modelIndex + 1]);
        shortOutput = cleanPrice(cells[modelIndex + 3]);
      }

      if (shortInput === null || shortOutput === null) return;

      const name = formatDisplayName(rawName);
      const modelId = `openai-${slugify(rawName)}`;

      if (results.some(m => m.id === modelId)) return;

      const model = {
        id: modelId,
        name,
        provider: "OpenAI",
        input_price_usd_per_1m: shortInput,
        output_price_usd_per_1m: shortOutput,
        long_context_input_price_usd_per_1m: longInput,
        long_context_output_price_usd_per_1m: longOutput,
        source_url: sourceUrl,
        updated_at: updatedAt
      };

      console.log(
        `[openai] parsed ${model.name} input=${model.input_price_usd_per_1m} output=${model.output_price_usd_per_1m} (long input=${model.long_context_input_price_usd_per_1m})`
      );
      results.push(model);
    });
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
