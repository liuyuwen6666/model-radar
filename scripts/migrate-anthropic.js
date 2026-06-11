const fs = require('fs');
const path = require('path');
const fetchAnthropicModels = require('./providers/anthropic');

const DATA_DIR = path.join(__dirname, '../data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const RAW_DIR = path.join(__dirname, '../raw/anthropic');

const OLD_TO_NEW_MAP = {
  'claude-3-opus-20240229': 'claude-opus-4-8',
  'claude-3-7-sonnet-20250219': 'claude-sonnet-4-6',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5-20251001'
};

/**
 * 填充模型的元数据参数（根据 ID 的不同前缀自动规范化配置参数）
 */
function fillMetaData(id, baseModel) {
  let contextWindow = null;
  let maxOutputTokens = null;
  let capabilities = ["文本"];
  
  if (id.includes('opus')) {
    contextWindow = 1000000;
    maxOutputTokens = 128000;
    capabilities = ["长文本", "推理", "代码", "多模态"];
  } else if (id.includes('sonnet')) {
    contextWindow = 200000;
    maxOutputTokens = 16384;
    capabilities = ["长文本", "推理", "代码"];
  } else if (id.includes('haiku')) {
    contextWindow = 200000;
    maxOutputTokens = 8192;
    capabilities = ["文本", "分类", "代码"];
  } else if (id.includes('fable')) {
    contextWindow = 1000000;
    maxOutputTokens = 128000;
    capabilities = ["文本", "旗舰模型"];
  }

  return {
    description: baseModel.description || `抓取自 Anthropic 官方定价页。`,
    contextWindow,
    maxOutputTokens,
    capabilities,
    recommendedFor: baseModel.recommendedFor || ["待补充"]
  };
}

async function runMigration() {
  console.log("=== Start Anthropic Migration & Repair ===");

  // 1. 迁移 data/sources.json
  const sourcesPath = path.join(DATA_DIR, 'sources.json');
  if (fs.existsSync(sourcesPath)) {
    const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
    sources.forEach(source => {
      if (source.provider === 'Anthropic') {
        source.models = source.models.map(id => OLD_TO_NEW_MAP[id] || id);
      }
    });
    fs.writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + '\n', 'utf8');
    console.log("[1/4] sources.json updated.");
  }

  // 2. 遍历并修正 history/*.json
  const historyFiles = fs.readdirSync(HISTORY_DIR).filter(file => file.endsWith('.json'));
  for (const file of historyFiles) {
    const filePath = path.join(HISTORY_DIR, file);
    const dataset = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const dateStr = file.replace('.json', '');
    const [year, month, day] = dateStr.split('-');

    const htmlPath = path.join(RAW_DIR, `${year}/${month}/${day}.html`);
    let hasHtml = fs.existsSync(htmlPath);

    if (hasHtml) {
      console.log(`[2/4] [Re-Scrape] Processing ${file} using raw HTML...`);
      const html = fs.readFileSync(htmlPath, 'utf8');
      const parsedModels = await fetchAnthropicModels({
        html,
        url: 'https://claude.com/pricing',
        updatedAt: `${dateStr}T00:00:00.000Z`
      });
      
      const nonAnthropic = dataset.models.filter(m => m.provider !== 'Anthropic');
      const anthropicBase = dataset.models.filter(m => m.provider === 'Anthropic');
      
      const normalizedAnthropic = parsedModels.map(pm => {
        const baseModel = anthropicBase.find(bm => bm.id === OLD_TO_NEW_MAP[pm.id] || bm.id === pm.id) || {};
        const meta = fillMetaData(pm.id, baseModel);
        
        return {
          id: pm.id,
          name: pm.name,
          provider: "Anthropic",
          family: "Claude",
          description: meta.description,
          currency: "USD",
          hasOfficialDualCurrency: false,
          inputPricePer1M: pm.input_price_usd_per_1m,
          outputPricePer1M: pm.output_price_usd_per_1m,
          cacheWritePricePer1M: pm.cache_write_price_usd_per_1m,
          cacheReadPricePer1M: pm.cache_read_price_usd_per_1m,
          inputPriceUsdPer1M: pm.input_price_usd_per_1m,
          outputPriceUsdPer1M: pm.output_price_usd_per_1m,
          cacheWritePriceUsdPer1M: pm.cache_write_price_usd_per_1m,
          cacheReadPriceUsdPer1M: pm.cache_read_price_usd_per_1m,
          contextWindow: meta.contextWindow,
          maxOutputTokens: meta.maxOutputTokens,
          capabilities: meta.capabilities,
          recommendedFor: meta.recommendedFor,
          status: "stable",
          sourceUrl: pm.source_url,
          sourceLabel: "Anthropic Pricing",
          detailPath: `/model/${pm.id}`,
          pricingNotes: "由 provider 抓取器从官方定价页解析得到。",
          updatedAt: pm.updated_at,
          sourceType: "provider"
        };
      });

      dataset.models = [...nonAnthropic, ...normalizedAnthropic];
    } else {
      console.log(`[2/4] [Rename Mapping] Processing ${file} (no HTML found)...`);
      dataset.models = dataset.models.map(m => {
        if (m.provider === 'Anthropic') {
          const newId = OLD_TO_NEW_MAP[m.id] || m.id;
          m.id = newId;
          m.detailPath = `/model/${newId}`;
          // 早期快照的名字同步纠偏为新格式
          if (m.name === 'Claude Opus 4.7' && newId === 'claude-opus-4-8') {
            m.name = 'Claude Opus 4.8';
          }
        }
        return m;
      });
    }

    fs.writeFileSync(filePath, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
  }
  console.log("[2/4] history snapshot files complete.");

  // 3. 修正 models.json
  const modelsPath = path.join(DATA_DIR, 'models.json');
  if (fs.existsSync(modelsPath)) {
    const dataset = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
    const dateStr = dataset.effectiveDate || '2026-06-11';
    const [year, month, day] = dateStr.split('-');
    const htmlPath = path.join(RAW_DIR, `${year}/${month}/${day}.html`);
    
    if (fs.existsSync(htmlPath)) {
      console.log(`[3/4] Re-scraping models.json...`);
      const html = fs.readFileSync(htmlPath, 'utf8');
      const parsedModels = await fetchAnthropicModels({
        html,
        url: 'https://claude.com/pricing',
        updatedAt: `${dateStr}T00:00:00.000Z`
      });
      const nonAnthropic = dataset.models.filter(m => m.provider !== 'Anthropic');
      const anthropicBase = dataset.models.filter(m => m.provider === 'Anthropic');
      
      const normalizedAnthropic = parsedModels.map(pm => {
        const baseModel = anthropicBase.find(bm => bm.id === OLD_TO_NEW_MAP[pm.id] || bm.id === pm.id) || {};
        const meta = fillMetaData(pm.id, baseModel);
        
        return {
          id: pm.id,
          name: pm.name,
          provider: "Anthropic",
          family: "Claude",
          description: meta.description,
          currency: "USD",
          hasOfficialDualCurrency: false,
          inputPricePer1M: pm.input_price_usd_per_1m,
          outputPricePer1M: pm.output_price_usd_per_1m,
          cacheWritePricePer1M: pm.cache_write_price_usd_per_1m,
          cacheReadPricePer1M: pm.cache_read_price_usd_per_1m,
          inputPriceUsdPer1M: pm.input_price_usd_per_1m,
          outputPriceUsdPer1M: pm.output_price_usd_per_1m,
          cacheWritePriceUsdPer1M: pm.cache_write_price_usd_per_1m,
          cacheReadPriceUsdPer1M: pm.cache_read_price_usd_per_1m,
          contextWindow: meta.contextWindow,
          maxOutputTokens: meta.maxOutputTokens,
          capabilities: meta.capabilities,
          recommendedFor: meta.recommendedFor,
          status: "stable",
          sourceUrl: pm.source_url,
          sourceLabel: "Anthropic Pricing",
          detailPath: `/model/${pm.id}`,
          pricingNotes: "由 provider 抓取器从官方定价页解析得到。",
          updatedAt: pm.updated_at,
          sourceType: "provider"
        };
      });
      dataset.models = [...nonAnthropic, ...normalizedAnthropic];
    }
    fs.writeFileSync(modelsPath, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
    console.log("[3/4] models.json updated.");
  }

  // 4. 修复 changelog.json
  const changelogPath = path.join(DATA_DIR, 'changelog.json');
  if (fs.existsSync(changelogPath)) {
    const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
    
    // A. 纠正条目中的旧 ID 及其关联字符串 (包括 Google 前缀等历史脏数据一并解决)
    changelog.history = changelog.history.map(entry => {
      // 修正 Google 去前缀
      if (entry.modelId === 'google-gemini-3-5-live-translate-preview') {
        entry.modelId = 'gemini-3-5-live-translate-preview';
        entry.id = entry.id.replace('google-gemini-3-5-live-translate-preview', 'gemini-3-5-live-translate-preview');
      }
      // 修正 Anthropic 对应 ID
      if (OLD_TO_NEW_MAP[entry.modelId]) {
        const newId = OLD_TO_NEW_MAP[entry.modelId];
        entry.id = entry.id.replace(entry.modelId, newId);
        entry.modelId = newId;
      }
      return entry;
    });

    // B. 检查补齐 2026-06-10 新增 Fable 5 记录
    const fableExist = changelog.history.some(h => h.date === '2026-06-10' && h.modelId === 'claude-fable-5');
    if (!fableExist) {
      console.log("[4/4] Injecting Fable 5 changelog entry for 2026-06-10...");
      const newEntry = {
        id: "2026-06-10:claude-fable-5:model:new_model",
        date: "2026-06-10",
        modelId: "claude-fable-5",
        modelName: "Claude Fable 5",
        provider: "Anthropic",
        field: "model",
        fieldLabel: "model",
        type: "new_model",
        previousValue: null,
        currentValue: "Claude Fable 5",
        delta: null,
        deltaPercent: null,
        summary: "新增模型 Claude Fable 5。",
        currency: "USD",
        sourceUrl: "https://claude.com/pricing",
        sourceType: "provider"
      };
      changelog.history.unshift(newEntry);
    }
    
    // C. 重新对 history 数组排序 (保证日期的递减和同一天内按拼音排序)
    changelog.history.sort((left, right) => {
      if (left.date !== right.date) {
        return right.date.localeCompare(left.date);
      }
      return left.modelName.localeCompare(right.modelName, "zh-CN");
    });

    fs.writeFileSync(changelogPath, JSON.stringify(changelog, null, 2) + '\n', 'utf8');
    console.log("[4/4] changelog.json updated.");
  }

  console.log("=== Migration & Repair Complete! ===");
}

runMigration().catch(console.error);
