const cheerio = require("cheerio");

const OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/pricing?latest-pricing=standard";

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\./g, "_dot_")
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/_dot_/g, ".")
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
  formatted = formatted.replace(/^sora/i, 'Sora');
  formatted = formatted.replace(/^chat/i, 'ChatGPT');
  formatted = formatted.replace(/-mini/i, ' mini');
  formatted = formatted.replace(/-nano/i, ' nano');
  formatted = formatted.replace(/-pro/i, ' pro');
  formatted = formatted.replace(/-codex/i, ' Codex');
  formatted = formatted.replace(/-cyber/i, ' Cyber');
  formatted = formatted.replace(/-realtime/i, ' Realtime');
  formatted = formatted.replace(/-image/i, ' Image');
  formatted = formatted.replace(/-transcribe/i, ' Transcribe');
  formatted = formatted.trim();
  return formatted;
}

function getSectionAndSubsection(text, classes = '') {
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  if (cleanText.includes('Flagship models') || cleanText.includes('Our latest models')) {
    return { section: 'Flagship models', subsection: null };
  }
  if (cleanText.includes('Amazon Bedrock')) {
    return { section: 'Amazon Bedrock pricing', subsection: null };
  }
  if (cleanText.includes('Realtime and audio')) {
    return { section: 'Multimodal models', subsection: 'Realtime and audio generation models' };
  }
  if (cleanText.includes('Image generation')) {
    return { section: 'Multimodal models', subsection: 'Image generation models' };
  }
  if (cleanText.includes('Video generation')) {
    return { section: 'Multimodal models', subsection: 'Video generation models' };
  }
  if (cleanText.includes('Transcription models')) {
    return { section: 'Multimodal models', subsection: 'Transcription models' };
  }
  if (cleanText.includes('Tools')) {
    return { section: 'Tools', subsection: null };
  }
  if (cleanText.includes('Specialized models')) {
    return { section: 'Specialized models', subsection: null };
  }
  if (cleanText.includes('Finetuning')) {
    return { section: 'Finetuning', subsection: null };
  }
  
  if (classes.includes('pricing-multimodal-subsection')) {
    return { section: 'Multimodal models', subsection: cleanText };
  }
  
  return null;
}

function parseTable($, $table, section, subsection, tab, results, crawledIds, sourceUrl, updatedAt) {
  const headers = [];
  $table.find('thead th').each((_, th) => {
    headers.push(normalizeWhitespace($(th).text()));
  });
  
  let currentModelName = ''; 
  
  $table.find('tbody tr').each((_, tr) => {
    const cells = [];
    $(tr).find('td').each((_, td) => {
      cells.push(normalizeWhitespace($(td).text()));
    });
    
    if (cells.length === 0) return;
    
    if (section === 'Flagship models') {
      const name = cells[0];
      if (!name || name === 'Model') return;
      
      const shortInput = cleanPrice(cells[1]);
      const shortCache = cleanPrice(cells[2]);
      const shortOutput = cleanPrice(cells[3]);
      
      let longInput = null;
      let longOutput = null;
      if (cells.length >= 7) {
        longInput = cleanPrice(cells[4]);
        longOutput = cleanPrice(cells[6]);
      }
      
      if (shortInput === null) return;
      
      const modelId = `openai-${slugify(name)}`;
      if (crawledIds.has(modelId)) return;
      crawledIds.add(modelId);
      
      const displayName = formatDisplayName(name);
      
      results.push({
        id: modelId,
        name: displayName,
        provider: "OpenAI",
        input_price_usd_per_1m: shortInput,
        cache_read_price_usd_per_1m: shortCache,
        output_price_usd_per_1m: shortOutput,
        long_context_input_price_usd_per_1m: longInput,
        long_context_output_price_usd_per_1m: longOutput,
        capabilities: ["文本", "旗舰模型"],
        pricingNotes: `分类：旗舰模型 (${tab})。由 provider 抓取器从官方定价页解析得到。`,
        source_url: sourceUrl,
        updated_at: updatedAt
      });
    }
    else if (subsection === 'Realtime and audio generation models') {
      let name = cells[0];
      let modality = cells[1];
      let inputVal = cells[2];
      let cacheVal = cells[3];
      let outputVal = cells[4];
      
      if (cells.length < 5) {
        modality = cells[0];
        inputVal = cells[1];
        cacheVal = cells[2];
        outputVal = cells[3];
        name = currentModelName;
      } else {
        currentModelName = name;
      }
      
      if (!name) return;
      
      const inputPrice = cleanPrice(inputVal);
      const cachePrice = cleanPrice(cacheVal);
      const outputPrice = cleanPrice(outputVal);
      
      const modalityStr = modality ? modality.toLowerCase() : 'audio';
      const modelId = `openai-${slugify(name)}-${modalityStr}`;
      if (crawledIds.has(modelId)) return;
      crawledIds.add(modelId);
      
      const displayName = `${formatDisplayName(name)} (${modality})`;
      
      let notes = `分类：多模态模型 - 实时与语音生成模型 (${tab})。由 provider 抓取器从官方定价页解析得到。`;
      if (outputVal && outputVal.includes('minute')) {
        notes += ` 音频输出计费：${outputVal}。`;
      }
      
      results.push({
        id: modelId,
        name: displayName,
        provider: "OpenAI",
        input_price_usd_per_1m: inputPrice,
        cache_read_price_usd_per_1m: cachePrice,
        output_price_usd_per_1m: outputPrice,
        capabilities: ["多模态", "实时与语音生成模型", modality],
        pricingNotes: notes,
        source_url: sourceUrl,
        updated_at: updatedAt
      });
    }
    else if (subsection === 'Image generation models') {
      let name = cells[0];
      let modality = cells[1];
      let inputVal = cells[2];
      let cacheVal = cells[3];
      let outputVal = cells[4];
      
      if (cells.length < 5) {
        modality = cells[0];
        inputVal = cells[1];
        cacheVal = cells[2];
        outputVal = cells[3];
        name = currentModelName;
      } else {
        currentModelName = name;
      }
      
      if (!name) return;
      
      const inputPrice = cleanPrice(inputVal);
      const cachePrice = cleanPrice(cacheVal);
      const outputPrice = cleanPrice(outputVal);
      
      const modalityStr = modality ? modality.toLowerCase() : 'image';
      const modelId = `openai-${slugify(name)}-${modalityStr}`;
      if (crawledIds.has(modelId)) return;
      crawledIds.add(modelId);
      
      const displayName = `${formatDisplayName(name)} (${modality})`;
      
      results.push({
        id: modelId,
        name: displayName,
        provider: "OpenAI",
        input_price_usd_per_1m: inputPrice,
        cache_read_price_usd_per_1m: cachePrice,
        output_price_usd_per_1m: outputPrice,
        capabilities: ["多模态", "图像生成模型", modality],
        pricingNotes: `分类：多模态模型 - 图像生成模型 (${tab})。由 provider 抓取器从官方定价页解析得到。`,
        source_url: sourceUrl,
        updated_at: updatedAt
      });
    }
    else if (subsection === 'Video generation models') {
      let name = cells[0];
      let size = cells[1];
      let portrait = cells[2];
      let landscape = cells[3];
      let priceVal = cells[4];
      
      if (cells.length < 5) {
        size = cells[0];
        portrait = cells[1];
        landscape = cells[2];
        priceVal = cells[3];
        name = currentModelName;
      } else {
        currentModelName = name;
      }
      
      if (!name) return;
      
      const sizeStr = size ? size.toLowerCase() : '720p';
      const modelId = `openai-${slugify(name)}-${sizeStr}`;
      if (crawledIds.has(modelId)) return;
      crawledIds.add(modelId);
      
      const displayName = `${formatDisplayName(name)} (${size})`;
      
      results.push({
        id: modelId,
        name: displayName,
        provider: "OpenAI",
        input_price_usd_per_1m: null,
        output_price_usd_per_1m: null,
        capabilities: ["多模态", "视频生成模型", size],
        pricingNotes: `分类：多模态模型 - 视频生成模型 (${tab})。视频尺寸：竖屏 ${portrait || '-'} / 横屏 ${landscape || '-'}。计费方式：${priceVal || '-'} / 秒。由 provider 抓取器从官方定价页解析得到。`,
        source_url: sourceUrl,
        updated_at: updatedAt
      });
    }
    else if (subsection === 'Transcription models') {
      const name = cells[0];
      if (!name) return;
      
      const inputPrice = cleanPrice(cells[2]);
      const outputPrice = cleanPrice(cells[3]);
      const estCost = cells[4];
      
      const modelId = `openai-${slugify(name)}`;
      if (crawledIds.has(modelId)) return;
      crawledIds.add(modelId);
      
      const displayName = formatDisplayName(name);
      
      results.push({
        id: modelId,
        name: displayName,
        provider: "OpenAI",
        input_price_usd_per_1m: inputPrice,
        output_price_usd_per_1m: outputPrice,
        capabilities: ["多模态", "语音转文字模型"],
        pricingNotes: `分类：多模态模型 - 语音转文字模型。估算成本：${estCost || '-'}。由 provider 抓取器从官方定价页解析得到。`,
        source_url: sourceUrl,
        updated_at: updatedAt
      });
    }
    else if (section === 'Specialized models') {
      let category = cells[0];
      let name = cells[1];
      let inputVal = cells[2];
      let cacheVal = cells[3];
      let outputVal = cells[4];
      
      if (cells.length < 5) {
        name = cells[0];
        inputVal = cells[1];
        cacheVal = cells[2];
        outputVal = cells[3];
        category = currentModelName; 
      } else {
        currentModelName = category;
      }
      
      if (!name) return;
      
      const inputPrice = cleanPrice(inputVal);
      const cachePrice = cleanPrice(cacheVal);
      const outputPrice = cleanPrice(outputVal);
      
      const modelId = `openai-${slugify(name)}`;
      if (crawledIds.has(modelId)) return;
      crawledIds.add(modelId);
      
      const displayName = formatDisplayName(name);
      
      results.push({
        id: modelId,
        name: displayName,
        provider: "OpenAI",
        input_price_usd_per_1m: inputPrice,
        cache_read_price_usd_per_1m: cachePrice,
        output_price_usd_per_1m: outputPrice,
        capabilities: ["专用模型", category || "特殊"],
        pricingNotes: `分类：专用模型 - ${category || '其他'}。由 provider 抓取器从官方定价页解析得到。`,
        source_url: sourceUrl,
        updated_at: updatedAt
      });
    }
    else if (section === 'Finetuning') {
      const name = cells[0];
      if (!name) return;
      
      const trainingVal = cells[1];
      const inputPrice = cleanPrice(cells[2]);
      const cachePrice = cleanPrice(cells[3]);
      const outputPrice = cleanPrice(cells[4]);
      
      const isSharing = name.toLowerCase().includes('sharing');
      const suffix = isSharing ? '-sharing' : '';
      const modelId = `openai-${slugify(name)}${suffix}`;
      if (crawledIds.has(modelId)) return;
      crawledIds.add(modelId);
      
      const displayName = formatDisplayName(name);
      
      results.push({
        id: modelId,
        name: displayName,
        provider: "OpenAI",
        input_price_usd_per_1m: inputPrice,
        cache_read_price_usd_per_1m: cachePrice,
        output_price_usd_per_1m: outputPrice,
        capabilities: ["微调模型", "文本"],
        pricingNotes: `分类：微调模型。训练费用：${trainingVal || '-'}。由 provider 抓取器从官方定价页解析得到。`,
        source_url: sourceUrl,
        updated_at: updatedAt
      });
    }
  });
}

function extractModelsFromHtml(html, options = {}) {
  const $ = cheerio.load(html);
  const updatedAt = options.updatedAt || new Date().toISOString();
  const sourceUrl = options.url || OPENAI_PRICING_URL;
  const results = [];
  const crawledIds = new Set();
  
  let currentSection = 'Flagship models';
  let currentSubsection = null;
  
  const article = $('article');
  if (article.length === 0) {
    console.warn("[openai] could not find article element, using fallback body traversal");
  }
  
  const container = article.length > 0 ? article : $('body');
  
  container.children().each((_, child) => {
    const $child = $(child);
    
    // 1. Switcher layout first
    if ($child.hasClass('pricing-switcher-layout')) {
      const headerText = $child.find('.pricing-switcher-header').text().replace(/\s+/g, ' ').trim();
      const mapped = getSectionAndSubsection(headerText, $child.attr('class') || '');
      if (mapped) {
        currentSection = mapped.section;
        currentSubsection = mapped.subsection;
      }
      
      const tabs = [];
      $child.find('button, .pricing-tab').each((_, btn) => {
        tabs.push($(btn).text().trim());
      });
      
      $child.find('table').each((tIdx, table) => {
        const tabName = tabs[tIdx] || 'Standard';
        
        parseTable($, $(table), currentSection, currentSubsection, tabName, results, crawledIds, sourceUrl, updatedAt);
      });
      return;
    }
    
    // 2. Headings next
    if ($child.hasClass('pricing-section-heading') || $child.hasClass('pricing-subsection') || child.tagName === 'h2' || child.tagName === 'h3') {
      const headingText = $child.text().replace(/\s+/g, ' ').trim();
      const mapped = getSectionAndSubsection(headingText, $child.attr('class') || '');
      if (mapped) {
        currentSection = mapped.section;
        currentSubsection = mapped.subsection;
      }
      return;
    }
    
    // 3. Other tables
    $child.find('table').each((_, table) => {
      if ($(table).closest('.pricing-switcher-layout').length > 0) return;
      
      parseTable($, $(table), currentSection, currentSubsection, 'Standard', results, crawledIds, sourceUrl, updatedAt);
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
