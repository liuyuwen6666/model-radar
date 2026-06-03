const cheerio = require("cheerio");

const GOOGLE_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing?hl=zh-cn";

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
      /\$([\d.,]+)\s*\((?:text|texto|文本)(?:\s*[\/,]|(?:\s+or\s+)|(?:\s+o\s+))?(?:\s*(?:image|imagen|图片))?(?:\s*[\/,]|(?:\s+or\s+)|(?:\s+o\s+))?(?:\s*(?:video|vídeo|视频))?\)/i
    );
    if (textMatch) {
      return Number(textMatch[1].replace(/,/g, ""));
    }
  }

  const priceMatch = normalized.match(/(?:\$|美金|美元\s*)\s*([\d.,]+)|([\d.,]+)\s*美元/);
  if (priceMatch) {
    const numStr = priceMatch[1] || priceMatch[2];
    return Number(numStr.replace(/,/g, ""));
  }

  const firstMatch = normalized.match(/\$?\s*([\d.,]+)/);
  return firstMatch ? Number(firstMatch[1].replace(/,/g, "")) : null;
}

function determineCapabilities(name, code, h2Text) {
  const combined = `${name} ${code} ${h2Text}`.toLowerCase();
  const caps = [];

  if (combined.includes("live") || combined.includes("audio") || combined.includes("语音") || combined.includes("tts") || combined.includes("lyria") || combined.includes("music") || combined.includes("音乐")) {
    caps.push("语音");
  }
  if (combined.includes("image") || combined.includes("imagen") || combined.includes("图片") || combined.includes("图像")) {
    caps.push("图片");
  }
  if (combined.includes("video") || combined.includes("veo") || combined.includes("视频")) {
    caps.push("视频");
  }
  if (combined.includes("embedding") || combined.includes("嵌入")) {
    caps.push("嵌入");
  }
  if (combined.includes("robotics") || combined.includes("机器人")) {
    caps.push("机器人学");
  }
  if (combined.includes("computer-use") || combined.includes("computer use") || combined.includes("计算机")) {
    caps.push("计算机使用");
  }

  const isSpecial = caps.includes("图片") || caps.includes("视频") || caps.includes("嵌入") || caps.includes("语音") || caps.includes("机器人学") || caps.includes("计算机使用");
  if (isSpecial) {
    if (combined.includes("gemini")) {
      caps.push("多模态");
    }
  } else {
    caps.push("多模态");
  }

  if (combined.includes("pro") || combined.includes("preview") || combined.includes("er") || combined.includes("think") || combined.includes("思考")) {
    caps.push("推理");
  }

  return Array.from(new Set(caps));
}

function extractModelsFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const results = [];
  const crawledIds = new Set();

  const updatedAt = options.updatedAt || new Date().toISOString();
  const sourceUrl = options.sourceUrl || GOOGLE_PRICING_URL;

  const elements = $("h2, h3, table.pricing-table, code");

  const contexts = [];
  let currentCtx = null;
  let currentH3 = "None";

  elements.each((_, el) => {
    const tagName = el.name || el.tagName || "";
    const $el = $(el);

    if (tagName.toLowerCase() === "h2") {
      const h2Text = $el.text().trim();
      if (!/工具价格|智能体的价格|备注/i.test(h2Text)) {
        currentCtx = {
          h2: h2Text,
          codes: [],
          tables: []
        };
        contexts.push(currentCtx);
        currentH3 = "None";
      } else {
        currentCtx = null;
      }
    } else if (currentCtx) {
      if (tagName.toLowerCase() === "h3") {
        currentH3 = $el.text().trim();
      } else if (tagName.toLowerCase() === "code") {
        const text = $el.text().trim();
        // 过滤非模型名 code
        if (text.length > 5 && !text.includes(" ") && !text.includes("{") && !/^\d/.test(text) && !/^[A-Z_]+$/.test(text)) {
          if (!currentCtx.codes.includes(text)) {
            currentCtx.codes.push(text);
          }
        }
      } else if (tagName.toLowerCase() === "table") {
        currentCtx.tables.push({
          h3: currentH3,
          el: $el
        });
      }
    }
  });

  // 处理 Gemma 4 的特殊情况
  const gemmaCtx = contexts.find(ctx => ctx.h2.includes("Gemma 4"));
  if (gemmaCtx && gemmaCtx.codes.length === 0) {
    gemmaCtx.codes.push("gemma-4");
  }

  // 遍历处理每个 context
  contexts.forEach((ctx) => {
    if (ctx.codes.length === 0) return;

    // 找出标准价格 table
    let standardTable = null;
    if (ctx.tables.length > 0) {
      const std = ctx.tables.find(t => /标准|standard|標準/i.test(t.h3));
      if (std) {
        standardTable = std.el;
      } else {
        standardTable = ctx.tables[0].el;
      }
    }

    if (!standardTable) {
      console.warn(`[google] warning: no table found for ${ctx.h2}`);
      return;
    }

    // 解析 table rows
    const rows = [];
    $(standardTable).find("tr").each((_, tr) => {
      const cells = [];
      $(tr).find("th, td").each((_, td) => {
        cells.push($(td).text().trim().replace(/\s+/g, ' '));
      });
      if (cells.length > 0) {
        rows.push(cells);
      }
    });

    // 关联 codes 和 rows
    ctx.codes.forEach((code) => {
      const modelId = `google-${slugify(code)}`;
      if (crawledIds.has(modelId)) return;
      crawledIds.add(modelId);

      let matchingRows = rows;
      if (ctx.codes.length > 1) {
        const isFastCode = code.toLowerCase().includes("fast");
        const isUltraCode = code.toLowerCase().includes("ultra");
        const isLiteCode = code.toLowerCase().includes("lite");
        const isCustomTools = code.toLowerCase().includes("customtools");
        const isProCode = code.toLowerCase().includes("pro");
        const isClipCode = code.toLowerCase().includes("clip");

        if (isFastCode) {
          matchingRows = rows.filter(r => r[0].toLowerCase().includes("fast"));
        } else if (isUltraCode) {
          matchingRows = rows.filter(r => r[0].toLowerCase().includes("ultra"));
        } else if (isLiteCode) {
          matchingRows = rows.filter(r => r[0].toLowerCase().includes("lite"));
        } else if (isProCode) {
          matchingRows = rows.filter(r => r[0].toLowerCase().includes("pro") || r[0].includes("完整") || r[0].includes("专业"));
        } else if (isClipCode) {
          matchingRows = rows.filter(r => r[0].toLowerCase().includes("clip") || r[0].includes("短片") || r[0].includes("预览"));
        } else if (isCustomTools) {
          const hasCustom = rows.some(r => r[0].toLowerCase().includes("customtools"));
          if (hasCustom) {
            matchingRows = rows.filter(r => r[0].toLowerCase().includes("customtools"));
          }
        } else {
          // 标准模型行（排除含有 fast/ultra/lite/pro/clip 等的行）
          matchingRows = rows.filter(r => !/fast|ultra|lite|pro|clip|短片|完整/i.test(r[0]));
        }
      }

      if (matchingRows.length === 0) {
        matchingRows = rows;
      }

      let inputPrice = null;
      let outputPrice = null;
      let cacheReadPrice = null;
      let cacheWritePrice = null;

      const findRowVal = (pattern) => {
        const r = matchingRows.find(row => pattern.test(row[0]));
        return r ? r[r.length - 1] : null;
      };

      const inputCell = findRowVal(/输入价格|input price|input\b/i);
      const outputCell = findRowVal(/输出价格|output price|output\b/i);
      const cacheCell = findRowVal(/context caching|caching price|caching|上下文缓存/i);

      if (inputCell) {
        inputPrice = parseUsdAmount(inputCell, { preferText: true });
      }
      if (outputCell) {
        outputPrice = parseUsdAmount(outputCell);
      }
      if (cacheCell) {
        cacheReadPrice = parseUsdAmount(cacheCell);
        cacheWritePrice = inputPrice;
      }

      // 特殊处理多模态嵌入等
      if (inputPrice === null && code.includes("embedding")) {
        const textInputCell = findRowVal(/文本输入|text input/i) || findRowVal(/输入价格|input/i);
        if (textInputCell) {
          inputPrice = parseUsdAmount(textInputCell);
        }
      }

      // 特殊处理生成模型（没有 input，只有按张数/按秒计费的 output 价格）
      if (inputPrice === null && outputPrice === null) {
        const valRow = matchingRows.find(r => r[0] && !/用于改进我们的产品|改进/i.test(r[0]) && r.length >= 2);
        if (valRow) {
          outputPrice = parseUsdAmount(valRow[valRow.length - 1]);
        }
      }

      if (code.includes("gemma")) {
        inputPrice = 0;
        outputPrice = 0;
      }

      const displayName = code === "gemma-4" ? "Gemma 4" : code;
      const caps = determineCapabilities(displayName, code, ctx.h2);

      results.push({
        id: modelId,
        name: displayName,
        provider: "Google",
        input_price_usd_per_1m: inputPrice,
        output_price_usd_per_1m: outputPrice,
        cache_read_price_usd_per_1m: cacheReadPrice,
        cache_write_price_usd_per_1m: cacheWritePrice,
        capabilities: caps,
        source_url: sourceUrl,
        updated_at: updatedAt
      });
    });
  });

  return results;
}

async function fetchHtml(url) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9"
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
    console.error(`[google] fetch error:`, error.stack);
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
