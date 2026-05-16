const fs = require("node:fs/promises");
const path = require("node:path");
const fetchAnthropicModels = require("./providers/anthropic");
const fetchOpenAIModels = require("./providers/openai");
const fetchDeepSeekModels = require("./providers/deepseek");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = process.env.MODEL_RADAR_DATA_DIR
  ? path.resolve(ROOT_DIR, process.env.MODEL_RADAR_DATA_DIR)
  : path.join(ROOT_DIR, "data");
const CACHE_DIR = process.env.MODEL_RADAR_CACHE_DIR
  ? path.resolve(ROOT_DIR, process.env.MODEL_RADAR_CACHE_DIR)
  : path.join(ROOT_DIR, ".cache");
const SITEMAP_PATH = process.env.MODEL_RADAR_SITEMAP_PATH
  ? path.resolve(ROOT_DIR, process.env.MODEL_RADAR_SITEMAP_PATH)
  : path.join(ROOT_DIR, "sitemap.xml");

const MODELS_PATH = path.join(DATA_DIR, "models.json");
const SOURCES_PATH = path.join(DATA_DIR, "sources.json");
const PREVIOUS_MODELS_PATH = path.join(CACHE_DIR, "models.previous.json");
const HISTORY_DIR = path.join(DATA_DIR, "history");

const DEFAULT_SOURCE_LABEL = "Official Pricing";
const SITE_ORIGIN = (process.env.MODEL_RADAR_SITE_ORIGIN || "https://modelradar.cn").replace(
  /\/+$/,
  ""
);
const SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";
const PROVIDER_LOADERS = {
  Anthropic: fetchAnthropicModels,
  OpenAI: fetchOpenAIModels,
  DeepSeek: fetchDeepSeekModels
};
const PRICE_FIELDS = [
  "inputPriceUsdPer1M",
  "outputPriceUsdPer1M",
  "cacheWritePriceUsdPer1M",
  "cacheReadPriceUsdPer1M"
];

const MODEL_BLUEPRINTS = [
  {
    id: "anthropic-claude-3-5-haiku",
    name: "Claude 3.5 Haiku",
    provider: "Anthropic",
    family: "Claude",
    description: "低延迟、低成本的轻量模型。",
    inputPriceUsdPer1M: 0.9,
    outputPriceUsdPer1M: 4.5,
    cacheWritePriceUsdPer1M: 0.25,
    cacheReadPriceUsdPer1M: 0.08,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ["文本", "分类", "代码"],
    recommendedFor: ["批量处理", "摘要", "轻量客服"],
    status: "stable",
    detailPath: "/model/claude-3-5-haiku"
  },
  {
    id: "anthropic-claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet",
    provider: "Anthropic",
    family: "Claude",
    description: "偏复杂推理与代码的主力模型。",
    inputPriceUsdPer1M: 3,
    outputPriceUsdPer1M: 15,
    cacheWritePriceUsdPer1M: 0.8,
    cacheReadPriceUsdPer1M: 0.3,
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: ["长文本", "推理", "代码"],
    recommendedFor: ["复杂 Agent", "代码审查", "长文档分析"],
    status: "stable",
    detailPath: "/model/claude-3-7-sonnet"
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    family: "DeepSeek",
    description: "中文与通用问答的低成本模型。",
    inputPriceUsdPer1M: 0.38,
    outputPriceUsdPer1M: 1.25,
    cacheWritePriceUsdPer1M: null,
    cacheReadPriceUsdPer1M: null,
    contextWindow: 64000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "文本", "低成本"],
    recommendedFor: ["通用问答", "内容生成", "中文助手"],
    status: "stable",
    detailPath: "/model/deepseek-v4-flash"
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    family: "DeepSeek",
    description: "强化推理与代码分析场景。",
    inputPriceUsdPer1M: 0.72,
    outputPriceUsdPer1M: 2.45,
    cacheWritePriceUsdPer1M: null,
    cacheReadPriceUsdPer1M: null,
    contextWindow: 64000,
    maxOutputTokens: 8192,
    capabilities: ["推理", "代码", "中文"],
    recommendedFor: ["复杂推理", "代码生成", "分析任务"],
    status: "stable",
    detailPath: "/model/deepseek-v4-pro"
  },
  {
    id: "doubao-1-5-pro-32k",
    name: "豆包 1.5 Pro 32K",
    provider: "字节豆包",
    family: "Doubao",
    description: "偏中文企业应用的主力模型。",
    inputPriceUsdPer1M: 0.8,
    outputPriceUsdPer1M: 2.4,
    cacheWritePriceUsdPer1M: 0.2,
    cacheReadPriceUsdPer1M: 0.08,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "多模态", "企业"],
    recommendedFor: ["企业 Copilot", "中文内容", "客服助手"],
    status: "stable",
    detailPath: "/model/doubao-1-5-pro-32k"
  },
  {
    id: "google-gemini-2-5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    family: "Gemini",
    description: "面向高吞吐与低成本推理。",
    inputPriceUsdPer1M: 0.35,
    outputPriceUsdPer1M: 1.8,
    cacheWritePriceUsdPer1M: 0.08,
    cacheReadPriceUsdPer1M: 0.03,
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    capabilities: ["多模态", "长上下文", "低成本"],
    recommendedFor: ["批量摘要", "多模态分类", "低成本应用"],
    status: "stable",
    detailPath: "/model/gemini-2-5-flash"
  },
  {
    id: "google-gemini-2-5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    family: "Gemini",
    description: "适合长上下文和复杂多模态任务。",
    inputPriceUsdPer1M: 1.5,
    outputPriceUsdPer1M: 10,
    cacheWritePriceUsdPer1M: 0.35,
    cacheReadPriceUsdPer1M: 0.1,
    contextWindow: 1000000,
    maxOutputTokens: 16384,
    capabilities: ["多模态", "长上下文", "推理"],
    recommendedFor: ["长文档分析", "图文理解", "复杂工作流"],
    status: "stable",
    detailPath: "/model/gemini-2-5-pro"
  },
  {
    id: "hunyuan-turbo-s",
    name: "混元 Turbo S",
    provider: "腾讯混元",
    family: "Hunyuan",
    description: "面向腾讯生态和企业集成。",
    inputPriceUsdPer1M: 0.65,
    outputPriceUsdPer1M: 2.15,
    cacheWritePriceUsdPer1M: 0.15,
    cacheReadPriceUsdPer1M: 0.06,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "企业", "Agent"],
    recommendedFor: ["企业应用", "客服系统", "微信生态"],
    status: "stable",
    detailPath: "/model/hunyuan-turbo-s"
  },
  {
    id: "kimi-latest-128k",
    name: "Kimi Latest 128K",
    provider: "月之暗面",
    family: "Kimi",
    description: "长文本处理和中文知识问答。",
    inputPriceUsdPer1M: 1.35,
    outputPriceUsdPer1M: 4.8,
    cacheWritePriceUsdPer1M: null,
    cacheReadPriceUsdPer1M: null,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "长文本", "检索"],
    recommendedFor: ["知识库问答", "文档解读", "中文写作"],
    status: "stable",
    detailPath: "/model/kimi-latest-128k"
  },
  {
    id: "openai-gpt-4-1",
    name: "GPT-4.1",
    provider: "OpenAI",
    family: "GPT-4.1",
    description: "通用旗舰文本与工具调用模型。",
    inputPriceUsdPer1M: 2.25,
    outputPriceUsdPer1M: 8.75,
    cacheWritePriceUsdPer1M: 0.55,
    cacheReadPriceUsdPer1M: 0.2,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: ["文本", "工具调用", "多模态"],
    recommendedFor: ["通用 Agent", "代码生成", "复杂问答"],
    status: "stable",
    detailPath: "/model/openai-gpt-4-1"
  },
  {
    id: "openai-gpt-4-1-mini",
    name: "GPT-4.1 mini",
    provider: "OpenAI",
    family: "GPT-4.1",
    description: "更适合大规模在线调用的低成本版本。",
    inputPriceUsdPer1M: 0.45,
    outputPriceUsdPer1M: 1.75,
    cacheWritePriceUsdPer1M: 0.12,
    cacheReadPriceUsdPer1M: 0.04,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: ["文本", "多模态", "低成本"],
    recommendedFor: ["在线客服", "内容生成", "批量 Agent"],
    status: "stable",
    detailPath: "/model/openai-gpt-4-1-mini"
  },
  {
    id: "qwen-max",
    name: "Qwen Max",
    provider: "阿里通义",
    family: "Qwen",
    description: "适合中文企业应用与混合部署。",
    inputPriceUsdPer1M: 1.1,
    outputPriceUsdPer1M: 4.2,
    cacheWritePriceUsdPer1M: 0.28,
    cacheReadPriceUsdPer1M: 0.1,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "企业", "开源生态"],
    recommendedFor: ["企业知识库", "中文应用", "私有化方案"],
    status: "stable",
    detailPath: "/model/qwen-max"
  }
];

function getTargetDate() {
  const rawDate = process.env.MODEL_RADAR_DATE;

  if (!rawDate) {
    return new Date().toISOString().slice(0, 10);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    throw new Error("MODEL_RADAR_DATE must use YYYY-MM-DD format.");
  }

  return rawDate;
}

function buildTimestamp(dateStamp) {
  return `${dateStamp}T00:00:00.000Z`;
}

function hashString(input) {
  let hash = 0;

  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function roundPrice(value) {
  return Math.round(value * 10000) / 10000;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function readText(filePath, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

function isDataset(dataset) {
  return Boolean(
    dataset &&
      typeof dataset === "object" &&
      Array.isArray(dataset.models) &&
      typeof dataset.effectiveDate === "string"
  );
}

function buildSourceIndex(sourceList) {
  return new Map(
    (Array.isArray(sourceList) ? sourceList : []).map((source) => [source.provider, source])
  );
}

function buildBaseIndex(models) {
  const index = new Map();

  for (const model of Array.isArray(models) ? models : []) {
    index.set(model.id, model);
  }

  return index;
}

function normalizeModel(model, sourceIndex, timestamp) {
  const source = sourceIndex.get(model.provider) || {};

  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    family: model.family || model.provider,
    description: model.description || "",
    inputPriceUsdPer1M: isNumber(model.inputPriceUsdPer1M) ? roundPrice(model.inputPriceUsdPer1M) : null,
    outputPriceUsdPer1M: isNumber(model.outputPriceUsdPer1M) ? roundPrice(model.outputPriceUsdPer1M) : null,
    cacheWritePriceUsdPer1M: isNumber(model.cacheWritePriceUsdPer1M) ? roundPrice(model.cacheWritePriceUsdPer1M) : null,
    cacheReadPriceUsdPer1M: isNumber(model.cacheReadPriceUsdPer1M) ? roundPrice(model.cacheReadPriceUsdPer1M) : null,
    contextWindow: Number.isFinite(model.contextWindow) ? model.contextWindow : null,
    maxOutputTokens: Number.isFinite(model.maxOutputTokens) ? model.maxOutputTokens : null,
    capabilities: Array.isArray(model.capabilities) ? model.capabilities : [],
    recommendedFor: Array.isArray(model.recommendedFor) ? model.recommendedFor : [],
    status: model.status || "stable",
    sourceUrl: model.sourceUrl || source.url || "",
    sourceLabel: model.sourceLabel || source.label || DEFAULT_SOURCE_LABEL,
    detailPath: model.detailPath || "",
    pricingNotes: model.pricingNotes || "模拟数据，字段结构可直接切换到真实抓取结果。",
    updatedAt: timestamp
  };
}

function normalizeProviderModel(providerModel, baseModel, sourceIndex, targetDate) {
  const timestamp = providerModel.updated_at || buildTimestamp(targetDate);

  return normalizeModel(
    {
      ...baseModel,
      id: providerModel.id,
      name: providerModel.name,
      provider: providerModel.provider,
      family: baseModel?.family || providerModel.name.split(/\s+/)[0] || providerModel.provider,
      description: baseModel?.description || `抓取自 ${providerModel.provider} 官方定价页。`,
      inputPriceUsdPer1M: providerModel.input_price_usd_per_1m,
      outputPriceUsdPer1M: providerModel.output_price_usd_per_1m,
      cacheWritePriceUsdPer1M: baseModel?.cacheWritePriceUsdPer1M ?? null,
      cacheReadPriceUsdPer1M: baseModel?.cacheReadPriceUsdPer1M ?? null,
      contextWindow: baseModel?.contextWindow ?? null,
      maxOutputTokens: baseModel?.maxOutputTokens ?? null,
      capabilities: baseModel?.capabilities || ["文本"],
      recommendedFor: baseModel?.recommendedFor || ["待补充"],
      status: baseModel?.status || "live",
      sourceUrl: providerModel.source_url,
      sourceLabel: baseModel?.sourceLabel,
      detailPath: baseModel?.detailPath || `/model/${providerModel.id}`,
      pricingNotes: "由 provider 抓取器从官方定价页解析得到。",
      updatedAt: timestamp
    },
    sourceIndex,
    timestamp
  );
}

function simulatePrice(baseValue, modelId, field, targetDate) {
  if (!isNumber(baseValue)) {
    return null;
  }

  const hash = hashString(`${targetDate}:${modelId}:${field}`);
  const variant = hash % 7;

  if (variant <= 2) {
    return roundPrice(baseValue);
  }

  const delta = [0.02, 0.04, 0.06][hash % 3];
  const direction = variant % 2 === 0 ? 1 : -1;
  const nextValue = Math.max(baseValue * (1 + direction * delta), 0.01);

  return roundPrice(nextValue);
}

function simulateNextModels(baseModels, sourceIndex, targetDate) {
  const timestamp = buildTimestamp(targetDate);

  return baseModels
    .map((model) => {
      const nextModel = normalizeModel(model, sourceIndex, timestamp);

      for (const field of PRICE_FIELDS) {
        nextModel[field] = simulatePrice(nextModel[field], nextModel.id, field, targetDate);
      }

      return nextModel;
    })
    .sort((left, right) => {
      const providerCompare = left.provider.localeCompare(right.provider, "zh-CN");
      return providerCompare !== 0 ? providerCompare : left.name.localeCompare(right.name, "zh-CN");
    });
}

async function loadProviderSnapshots(sourceList, targetDate) {
  const snapshots = new Map();

  for (const source of Array.isArray(sourceList) ? sourceList : []) {
    const loader = PROVIDER_LOADERS[source.provider];

    if (!loader) {
      continue;
    }

    console.log(`[update] loading provider ${source.provider} from ${source.url}`);

    try {
      const models = await loader({
        url: source.url,
        updatedAt: buildTimestamp(targetDate)
      });

      if (Array.isArray(models) && models.length > 0) {
        snapshots.set(source.provider, models);
        console.log(`[update] provider ${source.provider} returned ${models.length} models`);
      } else {
        console.log(`[update] provider ${source.provider} returned no models, using fallback data`);
      }
    } catch (error) {
      console.warn(`[update] provider ${source.provider} failed: ${error.message}`);
    }
  }

  return snapshots;
}

function buildNextModels(baseModels, providerSnapshots, sourceIndex, targetDate, shouldSimulateFallback) {
  const timestamp = buildTimestamp(targetDate);
  const baseIndex = buildBaseIndex(baseModels);
  const loadedProviders = new Set(providerSnapshots.keys());
  const injectedProviders = new Set();
  const nextModels = [];

  for (const model of baseModels) {
    if (loadedProviders.has(model.provider) && !injectedProviders.has(model.provider)) {
      const providerModels = providerSnapshots.get(model.provider) || [];

      for (const providerModel of providerModels) {
        const baseProviderModel = baseIndex.get(providerModel.id);
        nextModels.push(normalizeProviderModel(providerModel, baseProviderModel, sourceIndex, targetDate));
      }

      injectedProviders.add(model.provider);
    }

    if (loadedProviders.has(model.provider)) {
      continue;
    }

    const nextModel = normalizeModel(model, sourceIndex, timestamp);

    if (shouldSimulateFallback) {
      for (const field of PRICE_FIELDS) {
        nextModel[field] = simulatePrice(nextModel[field], nextModel.id, field, targetDate);
      }
    }

    nextModels.push(nextModel);
  }

  for (const [providerName, providerModels] of providerSnapshots.entries()) {
    if (injectedProviders.has(providerName)) {
      continue;
    }

    for (const providerModel of providerModels) {
      const baseModel = baseIndex.get(providerModel.id);
      nextModels.push(normalizeProviderModel(providerModel, baseModel, sourceIndex, targetDate));
    }
  }

  return nextModels;
}

function buildDataset(models, targetDate) {
  return {
    schemaVersion: 1,
    generatedAt: buildTimestamp(targetDate),
    effectiveDate: targetDate,
    currency: "USD",
    billingUnit: "per_1m_tokens",
    disclaimer: "当前为模拟数据，用于演示自动更新链路；后续可将 update.js 替换为真实抓取逻辑。",
    models
  };
}

function getHistorySnapshotPath(targetDate) {
  return path.join(HISTORY_DIR, `${targetDate}.json`);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseSitemapEntries(xml) {
  const entries = [];

  for (const match of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const block = match[1];
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();

    if (!loc) {
      continue;
    }

    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim() || null;
    entries.push({ loc, lastmod });
  }

  return entries;
}

function buildManagedSitemapEntries(targetDate) {
  return [
    { loc: `${SITE_ORIGIN}/`, lastmod: targetDate },
    { loc: `${SITE_ORIGIN}/history.html`, lastmod: targetDate },
    { loc: `${SITE_ORIGIN}/model.html`, lastmod: targetDate },
    { loc: `${SITE_ORIGIN}/rankings.html`, lastmod: targetDate },
    { loc: `${SITE_ORIGIN}/data/models.json`, lastmod: targetDate },
    { loc: `${SITE_ORIGIN}/data/changelog.json`, lastmod: targetDate },
    { loc: `${SITE_ORIGIN}/data/history/${targetDate}.json`, lastmod: targetDate }
  ];
}

function mergeSitemapEntries(existingEntries, targetDate) {
  const managedEntries = buildManagedSitemapEntries(targetDate);
  const managedLocs = new Set(managedEntries.map((entry) => entry.loc));
  const preservedEntries = existingEntries.filter((entry) => !managedLocs.has(entry.loc));

  return [...managedEntries, ...preservedEntries];
}

function buildSitemapXml(entries) {
  const lines = [`<urlset xmlns="${SITEMAP_NAMESPACE}">`];

  for (const entry of entries) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);

    if (entry.lastmod) {
      lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    }

    lines.push("  </url>");
  }

  lines.push("</urlset>", "");
  return lines.join("\n");
}

async function writeJson(filePath, value) {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, stableJson(value), "utf8");
}

async function updateSitemap(targetDate) {
  const currentXml = await readText(SITEMAP_PATH, "");
  const existingEntries = parseSitemapEntries(currentXml);
  const nextEntries = mergeSitemapEntries(existingEntries, targetDate);

  await fs.writeFile(SITEMAP_PATH, buildSitemapXml(nextEntries), "utf8");
  console.log(
    `[update] wrote sitemap ${path.relative(ROOT_DIR, SITEMAP_PATH) || path.basename(SITEMAP_PATH)}`
  );
}

async function main() {
  const targetDate = getTargetDate();
  const currentDataset = await readJson(MODELS_PATH, null);
  const sourceList = await readJson(SOURCES_PATH, []);
  const sourceIndex = buildSourceIndex(sourceList);

  await ensureDirectory(CACHE_DIR);

  if (currentDataset) {
    await writeJson(PREVIOUS_MODELS_PATH, currentDataset);
  } else {
    await writeJson(
      PREVIOUS_MODELS_PATH,
      buildDataset(
        MODEL_BLUEPRINTS.map((model) => normalizeModel(model, sourceIndex, buildTimestamp(targetDate))),
        targetDate
      )
    );
  }

  const baseModels = isDataset(currentDataset) ? currentDataset.models : MODEL_BLUEPRINTS;
  const shouldSimulateFallback =
    !isDataset(currentDataset) || currentDataset.effectiveDate !== targetDate;
  const providerSnapshots = await loadProviderSnapshots(sourceList, targetDate);
  const nextModels = buildNextModels(
    baseModels,
    providerSnapshots,
    sourceIndex,
    targetDate,
    shouldSimulateFallback
  );
  const nextDataset = buildDataset(nextModels, targetDate);
  const historySnapshotPath = getHistorySnapshotPath(targetDate);

  await Promise.all([writeJson(MODELS_PATH, nextDataset), writeJson(historySnapshotPath, nextDataset)]);
  console.log(
    `[update] wrote history snapshot ${
      path.relative(ROOT_DIR, historySnapshotPath) || path.basename(historySnapshotPath)
    }`
  );
  await updateSitemap(targetDate);
  console.log(`Updated ${nextModels.length} models for ${targetDate}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
