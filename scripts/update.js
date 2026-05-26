const fs = require("node:fs/promises");
const path = require("node:path");
const fetchAnthropicModels = require("./providers/anthropic");
const fetchGoogleModels = require("./providers/google");
const fetchOpenAIModels = require("./providers/openai");
const fetchDeepSeekModels = require("./providers/deepseek");
const fetchKimiModels = require("./providers/kimi");
const fetchQwenModels = require("./providers/qwen");
const fetchDoubaoModels = require("./providers/doubao");
const fetchHunyuanModels = require("./providers/hunyuan");
const { writeSitemapForDataset } = require("./lib/sitemap");

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
const PROVIDER_LOADERS = {
  Anthropic: fetchAnthropicModels,
  Google: fetchGoogleModels,
  OpenAI: fetchOpenAIModels,
  DeepSeek: fetchDeepSeekModels,
  "月之暗面": fetchKimiModels,
  "阿里通义": fetchQwenModels,
  "字节豆包": fetchDoubaoModels,
  "腾讯混元": fetchHunyuanModels
};
const PRICE_FIELDS = [
  "inputPriceUsdPer1M",
  "outputPriceUsdPer1M",
  "cacheWritePriceUsdPer1M",
  "cacheReadPriceUsdPer1M"
];

const MODEL_BLUEPRINTS = [
  {
    id: "anthropic-claude-3-opus",
    name: "Claude Opus 4.7",
    provider: "Anthropic",
    family: "Claude",
    description: "最智能的多模态旗舰模型，适合高难度推理与复杂代码任务。",
    inputPriceUsdPer1M: 5,
    outputPriceUsdPer1M: 25,
    cacheWritePriceUsdPer1M: 6.25,
    cacheReadPriceUsdPer1M: 0.5,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ["长文本", "推理", "代码", "多模态"],
    recommendedFor: ["高难度编程", "科学研究", "复杂战略分析"],
    status: "stable",
    detailPath: "/model/claude-3-opus",
    sourceType: "provider"
  },
  {
    id: "anthropic-claude-3-5-haiku",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    family: "Claude",
    description: "低延迟、低成本的轻量模型。",
    inputPriceUsdPer1M: 1,
    outputPriceUsdPer1M: 5,
    cacheWritePriceUsdPer1M: 1.25,
    cacheReadPriceUsdPer1M: 0.1,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ["文本", "分类", "代码"],
    recommendedFor: ["批量处理", "摘要", "轻量客服"],
    status: "stable",
    detailPath: "/model/claude-3-5-haiku",
    sourceType: "provider"
  },
  {
    id: "anthropic-claude-3-7-sonnet",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    family: "Claude",
    description: "偏复杂推理与代码的主力模型。",
    inputPriceUsdPer1M: 3,
    outputPriceUsdPer1M: 15,
    cacheWritePriceUsdPer1M: 3.75,
    cacheReadPriceUsdPer1M: 0.3,
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: ["长文本", "推理", "代码"],
    recommendedFor: ["复杂 Agent", "代码审查", "长文档分析"],
    status: "stable",
    detailPath: "/model/claude-3-7-sonnet",
    sourceType: "provider"
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
    detailPath: "/model/deepseek-v4-flash",
    sourceType: "provider"
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
    detailPath: "/model/deepseek-v4-pro",
    sourceType: "provider"
  },
  {
    id: "doubao-1-5-pro-32k",
    name: "豆包 1.5 Pro 32K",
    provider: "字节豆包",
    family: "Doubao",
    description: "偏中文企业应用的主力模型。",
    inputPriceUsdPer1M: 0.80 / 7.25,  // ¥0.80 -> $0.1103
    outputPriceUsdPer1M: 2.00 / 7.25, // ¥2.00 -> $0.2759
    cacheWritePriceUsdPer1M: 0.20 / 7.25, // ¥0.20 -> $0.0276
    cacheReadPriceUsdPer1M: 0.08 / 7.25,  // ¥0.08 -> $0.0110
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "多模态", "企业"],
    recommendedFor: ["企业 Copilot", "中文内容", "客服助手"],
    status: "stable",
    detailPath: "/model/doubao-1-5-pro-32k",
    sourceType: "provider"
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
    detailPath: "/model/gemini-2-5-flash",
    sourceType: "provider"
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
    detailPath: "/model/gemini-2-5-pro",
    sourceType: "provider"
  },
  {
    id: "hunyuan-turbo-s",
    name: "混元 Turbo S",
    provider: "腾讯混元",
    family: "Hunyuan",
    description: "面向腾讯生态和企业集成。",
    inputPriceUsdPer1M: 0.80 / 7.25,  // ¥0.80 -> $0.1103
    outputPriceUsdPer1M: 2.00 / 7.25, // ¥2.00 -> $0.2759
    cacheWritePriceUsdPer1M: 0.15 / 7.25, // ¥0.15 -> $0.0207
    cacheReadPriceUsdPer1M: 0.06 / 7.25,  // ¥0.06 -> $0.0083
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "企业", "Agent"],
    recommendedFor: ["企业应用", "客服系统", "微信生态"],
    status: "stable",
    detailPath: "/model/hunyuan-turbo-s",
    sourceType: "provider"
  },
  {
    id: "kimi-k2-6",
    name: "Kimi K2.6",
    provider: "月之暗面",
    family: "Kimi",
    description: "最新旗舰多模态大模型，长程代码与自我纠错能力卓越。",
    inputPriceUsdPer1M: 6.50 / 7.25,   // ¥6.50 -> $0.8966
    outputPriceUsdPer1M: 27.00 / 7.25, // ¥27.00 -> $3.7241
    cacheWritePriceUsdPer1M: 6.50 / 7.25, // ¥6.50 -> $0.8966
    cacheReadPriceUsdPer1M: 1.10 / 7.25,  // ¥1.10 -> $0.1517
    contextWindow: 262144,
    maxOutputTokens: 16384,
    capabilities: ["中文", "长文本", "多模态", "推理"],
    recommendedFor: ["长程代码", "智能对话", "自我纠错"],
    status: "stable",
    detailPath: "/model/kimi-k2-6",
    sourceType: "provider"
  },
  {
    id: "kimi-k2-5",
    name: "Kimi K2.5",
    provider: "月之暗面",
    family: "Kimi",
    description: "支持长思考与多模态的深度推理模型。",
    inputPriceUsdPer1M: 4.00 / 7.25,   // ¥4.00 -> $0.5517
    outputPriceUsdPer1M: 21.00 / 7.25, // ¥21.00 -> $2.8966
    cacheWritePriceUsdPer1M: 4.00 / 7.25, // ¥4.00 -> $0.5517
    cacheReadPriceUsdPer1M: 0.70 / 7.25,  // ¥0.70 -> $0.0966
    contextWindow: 262144,
    maxOutputTokens: 16384,
    capabilities: ["中文", "多模态", "推理"],
    recommendedFor: ["对话系统", "Agent任务", "多模态分析"],
    status: "stable",
    detailPath: "/model/kimi-k2-5",
    sourceType: "provider"
  },
  {
    id: "kimi-latest-128k",
    name: "Kimi Latest 128K",
    provider: "月之暗面",
    family: "Kimi",
    description: "长文本处理和中文知识问答。",
    inputPriceUsdPer1M: 10.00 / 7.25, // ¥10.00 -> $1.3793
    outputPriceUsdPer1M: 30.00 / 7.25, // ¥30.00 -> $4.1379
    cacheWritePriceUsdPer1M: null,
    cacheReadPriceUsdPer1M: null,
    contextWindow: 131072,
    maxOutputTokens: 8192,
    capabilities: ["中文", "长文本", "检索"],
    recommendedFor: ["知识库问答", "文档解读", "中文写作"],
    status: "stable",
    detailPath: "/model/kimi-latest-128k",
    sourceType: "provider"
  },
  {
    id: "openai-gpt-5-5",
    name: "GPT-5.5",
    provider: "OpenAI",
    family: "GPT-5.5",
    description: "为编码和专业工作而打造的新一代智能。",
    inputPriceUsdPer1M: 5,
    outputPriceUsdPer1M: 30,
    longContextInputPriceUsdPer1M: 10,
    longContextOutputPriceUsdPer1M: 45,
    contextWindow: 1000000,
    maxOutputTokens: 16384,
    capabilities: ["文本", "工具调用", "长上下文"],
    recommendedFor: ["复杂开发", "深度推理", "长程任务"],
    status: "stable",
    detailPath: "/model/openai-gpt-5-5",
    sourceType: "provider"
  },
  {
    id: "openai-gpt-5-4",
    name: "GPT-5.4",
    provider: "OpenAI",
    family: "GPT-5.4",
    description: "面向编码和专业工作的更实惠模型。",
    inputPriceUsdPer1M: 2.5,
    outputPriceUsdPer1M: 15,
    longContextInputPriceUsdPer1M: 5,
    longContextOutputPriceUsdPer1M: 22.5,
    contextWindow: 1000000,
    maxOutputTokens: 16384,
    capabilities: ["文本", "长上下文", "低成本"],
    recommendedFor: ["大规模日常任务", "辅助编程", "文本概括"],
    status: "stable",
    detailPath: "/model/openai-gpt-5-4",
    sourceType: "provider"
  },
  {
    id: "openai-gpt-5-4-mini",
    name: "GPT-5.4 mini",
    provider: "OpenAI",
    family: "GPT-5.4",
    description: "我们迄今最强大的 mini 模型，适用于编码、计算机使用和子代理。",
    inputPriceUsdPer1M: 0.75,
    outputPriceUsdPer1M: 4.5,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: ["文本", "多模态", "极低成本"],
    recommendedFor: ["高并发调用", "简单子代理", "实时客服"],
    status: "stable",
    detailPath: "/model/openai-gpt-5-4-mini",
    sourceType: "provider"
  },
  {
    id: "qwen-max",
    name: "Qwen Max",
    provider: "阿里通义",
    family: "Qwen",
    description: "适合中文企业应用与混合部署。",
    inputPriceUsdPer1M: 12.00 / 7.25,  // ¥12.00 -> $1.6552
    outputPriceUsdPer1M: 36.00 / 7.25, // ¥36.00 -> $4.9655
    cacheWritePriceUsdPer1M: 0.30 / 7.25, // ¥0.30 -> $0.0414
    cacheReadPriceUsdPer1M: 0.10 / 7.25,  // ¥0.10 -> $0.0138
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "企业", "开源生态"],
    recommendedFor: ["企业知识库", "中文应用", "私有化方案"],
    status: "stable",
    detailPath: "/model/qwen-max",
    sourceType: "provider"
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
  const isDomestic = ["字节豆包", "阿里通义", "月之暗面", "腾讯混元"].includes(model.provider);
  const currency = model.currency || (isDomestic ? "CNY" : "USD");

  // 获取高精度官方价格
  let inputPricePer1M = model.inputPricePer1M;
  let outputPricePer1M = model.outputPricePer1M;
  let cacheWritePricePer1M = model.cacheWritePricePer1M;
  let cacheReadPricePer1M = model.cacheReadPricePer1M;

  if (inputPricePer1M === undefined || inputPricePer1M === null) {
    if (isDomestic) {
      inputPricePer1M = model.inputPriceUsdPer1M ? roundPrice(model.inputPriceUsdPer1M * 7.25) : null;
      outputPricePer1M = model.outputPriceUsdPer1M ? roundPrice(model.outputPriceUsdPer1M * 7.25) : null;
      cacheWritePricePer1M = model.cacheWritePriceUsdPer1M ? roundPrice(model.cacheWritePriceUsdPer1M * 7.25) : null;
      cacheReadPricePer1M = model.cacheReadPriceUsdPer1M ? roundPrice(model.cacheReadPriceUsdPer1M * 7.25) : null;
    } else {
      inputPricePer1M = model.inputPriceUsdPer1M;
      outputPricePer1M = model.outputPriceUsdPer1M;
      cacheWritePricePer1M = model.cacheWritePriceUsdPer1M;
      cacheReadPricePer1M = model.cacheReadPriceUsdPer1M;
    }
  }

  let inputPriceUsdPer1M = model.inputPriceUsdPer1M;
  let outputPriceUsdPer1M = model.outputPriceUsdPer1M;
  let cacheWritePriceUsdPer1M = model.cacheWritePriceUsdPer1M;
  let cacheReadPriceUsdPer1M = model.cacheReadPriceUsdPer1M;

  if (inputPriceUsdPer1M === undefined || inputPriceUsdPer1M === null) {
    if (isDomestic) {
      inputPriceUsdPer1M = inputPricePer1M ? roundPrice(inputPricePer1M / 7.25) : null;
      outputPriceUsdPer1M = outputPricePer1M ? roundPrice(outputPricePer1M / 7.25) : null;
      cacheWritePriceUsdPer1M = cacheWritePricePer1M ? roundPrice(cacheWritePricePer1M / 7.25) : null;
      cacheReadPriceUsdPer1M = cacheReadPricePer1M ? roundPrice(cacheReadPricePer1M / 7.25) : null;
    } else {
      inputPriceUsdPer1M = inputPricePer1M;
      outputPriceUsdPer1M = outputPricePer1M;
      cacheWritePriceUsdPer1M = cacheWritePricePer1M;
      cacheReadPriceUsdPer1M = cacheReadPricePer1M;
    }
  }

  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    family: model.family || model.provider,
    description: model.description || "",
    currency,
    hasOfficialDualCurrency: model.hasOfficialDualCurrency || false,
    inputPricePer1M: isNumber(inputPricePer1M) ? roundPrice(inputPricePer1M) : null,
    outputPricePer1M: isNumber(outputPricePer1M) ? roundPrice(outputPricePer1M) : null,
    cacheWritePricePer1M: isNumber(cacheWritePricePer1M) ? roundPrice(cacheWritePricePer1M) : null,
    cacheReadPricePer1M: isNumber(cacheReadPricePer1M) ? roundPrice(cacheReadPricePer1M) : null,
    inputPriceUsdPer1M: isNumber(inputPriceUsdPer1M) ? roundPrice(inputPriceUsdPer1M) : null,
    outputPriceUsdPer1M: isNumber(outputPriceUsdPer1M) ? roundPrice(outputPriceUsdPer1M) : null,
    cacheWritePriceUsdPer1M: isNumber(cacheWritePriceUsdPer1M) ? roundPrice(cacheWritePriceUsdPer1M) : null,
    cacheReadPriceUsdPer1M: isNumber(cacheReadPriceUsdPer1M) ? roundPrice(cacheReadPriceUsdPer1M) : null,
    contextWindow: Number.isFinite(model.contextWindow) ? model.contextWindow : null,
    maxOutputTokens: Number.isFinite(model.maxOutputTokens) ? model.maxOutputTokens : null,
    capabilities: Array.isArray(model.capabilities) ? model.capabilities : [],
    recommendedFor: Array.isArray(model.recommendedFor) ? model.recommendedFor : [],
    status: model.status || "stable",
    sourceUrl: model.sourceUrl || source.url || "",
    sourceLabel: model.sourceLabel || source.label || DEFAULT_SOURCE_LABEL,
    detailPath: model.detailPath || "",
    pricingNotes: model.pricingNotes || "由 JSON 数据驱动，自适应官方币种价格展示。",
    updatedAt: timestamp,
    sourceType: model.sourceType || "fallback"
  };
}

function normalizeProviderModel(providerModel, baseModel, sourceIndex, targetDate) {
  const timestamp = providerModel.updatedAt || providerModel.updated_at || buildTimestamp(targetDate);
  const isDomestic = ["字节豆包", "阿里通义", "月之暗面", "腾讯混元"].includes(providerModel.provider);

  const hasRawPrices = providerModel.inputPricePer1M !== undefined;
  const currency = providerModel.currency || (isDomestic ? "CNY" : "USD");

  const inputPrice = hasRawPrices
    ? providerModel.inputPricePer1M
    : (isDomestic && providerModel.input_price_usd_per_1m !== undefined ? providerModel.input_price_usd_per_1m * 7.25 : providerModel.input_price_usd_per_1m);

  const outputPrice = hasRawPrices
    ? providerModel.outputPricePer1M
    : (isDomestic && providerModel.output_price_usd_per_1m !== undefined ? providerModel.output_price_usd_per_1m * 7.25 : providerModel.output_price_usd_per_1m);

  const inputPriceUsd = hasRawPrices
    ? providerModel.inputPriceUsdPer1M
    : providerModel.input_price_usd_per_1m;

  const outputPriceUsd = hasRawPrices
    ? providerModel.outputPriceUsdPer1M
    : providerModel.output_price_usd_per_1m;

  const cacheReadPriceUsd = hasRawPrices
    ? providerModel.cacheReadPriceUsdPer1M
    : (providerModel.cache_read_price_usd_per_1m ?? (baseModel?.cacheReadPriceUsdPer1M ?? null));

  const cacheReadPrice = hasRawPrices
    ? providerModel.cacheReadPricePer1M
    : (isDomestic && cacheReadPriceUsd !== null ? cacheReadPriceUsd * 7.25 : cacheReadPriceUsd);

  const cacheWritePriceUsd = hasRawPrices
    ? providerModel.cacheWritePriceUsdPer1M
    : (providerModel.cache_write_price_usd_per_1m ?? (baseModel?.cacheWritePriceUsdPer1M ?? null));

  const cacheWritePrice = hasRawPrices
    ? providerModel.cacheWritePricePer1M
    : (isDomestic && cacheWritePriceUsd !== null ? cacheWritePriceUsd * 7.25 : cacheWritePriceUsd);

  return normalizeModel(
    {
      ...baseModel,
      id: providerModel.id,
      name: providerModel.name,
      provider: providerModel.provider,
      family: baseModel?.family || providerModel.name.split(/\s+/)[0] || providerModel.provider,
      description: baseModel?.description || `抓取自 ${providerModel.provider} 官方定价页。`,
      currency,
      hasOfficialDualCurrency: providerModel.hasOfficialDualCurrency || false,
      inputPricePer1M: inputPrice,
      outputPricePer1M: outputPrice,
      inputPriceUsdPer1M: inputPriceUsd,
      outputPriceUsdPer1M: outputPriceUsd,
      longContextInputPriceUsdPer1M: providerModel.long_context_input_price_usd_per_1m ?? (baseModel?.longContextInputPriceUsdPer1M ?? null),
      longContextOutputPriceUsdPer1M: providerModel.long_context_output_price_usd_per_1m ?? (baseModel?.longContextOutputPriceUsdPer1M ?? null),
      cacheWritePriceUsdPer1M: cacheWritePriceUsd,
      cacheReadPriceUsdPer1M: cacheReadPriceUsd,
      cacheWritePricePer1M: cacheWritePrice,
      cacheReadPricePer1M: cacheReadPrice,
      contextWindow: baseModel?.contextWindow ?? providerModel.contextWindow ?? null,
      maxOutputTokens: baseModel?.maxOutputTokens ?? providerModel.maxOutputTokens ?? null,
      capabilities: baseModel?.capabilities || providerModel.capabilities || ["文本"],
      recommendedFor: baseModel?.recommendedFor || providerModel.recommendedFor || ["待补充"],
      status: baseModel?.status || "live",
      sourceUrl: providerModel.sourceUrl || providerModel.source_url,
      sourceLabel: baseModel?.sourceLabel,
      detailPath: baseModel?.detailPath || `/model/${providerModel.id}`,
      pricingNotes: providerModel.pricingNotes || "由 provider 抓取器从官方定价页解析得到。",
      updatedAt: timestamp,
      sourceType: "provider"
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

      if (nextModel.sourceType === "provider") {
        for (const field of PRICE_FIELDS) {
          nextModel[field] = simulatePrice(nextModel[field], nextModel.id, field, targetDate);
        }
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
      const crawledModelIds = new Set(providerModels.map(pm => pm.id));

      for (const providerModel of providerModels) {
        const baseProviderModel = baseIndex.get(providerModel.id);
        nextModels.push(normalizeProviderModel(providerModel, baseProviderModel, sourceIndex, targetDate));
      }

      // Preserving previous models of the provider as legacy instead of deleting them
      const obsoleteModels = baseModels.filter(bm => bm.provider === model.provider && !crawledModelIds.has(bm.id));
      for (const obsoleteModel of obsoleteModels) {
        const legacyModel = {
          ...obsoleteModel,
          status: "legacy",
          pricingNotes: obsoleteModel.pricingNotes ? `${obsoleteModel.pricingNotes} (已升级/旧版，官方价格页已不再展示，保留作历史参考。)` : "已升级/旧版，官方价格页已不再展示，保留作历史参考。"
        };
        nextModels.push(normalizeModel(legacyModel, sourceIndex, timestamp));
      }

      injectedProviders.add(model.provider);
    }

    if (loadedProviders.has(model.provider)) {
      continue;
    }

    const nextModel = normalizeModel(model, sourceIndex, timestamp);

    if (shouldSimulateFallback && nextModel.sourceType === "provider") {
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
    disclaimer: "部分模型由 provider 抓取器从官方 pricing 页面解析得到，部分模型仍为 fallback 蓝图数据。请通过 sourceType、sourceUrl、pricingNotes 判断数据可信度，商业决策前请务必以厂商官方价格页和官方账单为准。",
    models
  };
}

function getHistorySnapshotPath(targetDate) {
  return path.join(HISTORY_DIR, `${targetDate}.json`);
}

async function writeJson(filePath, value) {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, stableJson(value), "utf8");
}

async function updateSitemap(dataset) {
  const entries = await writeSitemapForDataset({
    dataset,
    sitemapPath: SITEMAP_PATH
  });
  console.log(
    `[update] wrote sitemap ${path.relative(ROOT_DIR, SITEMAP_PATH) || path.basename(SITEMAP_PATH)} with ${entries.length} entries`
  );
}

function sortModels(models) {
  return [...models].sort((left, right) => {
    const providerWeights = {
      "OpenAI": 100,
      "Anthropic": 90,
      "Google": 80,
      "DeepSeek": 70,
      "月之暗面": 60,
      "阿里通义": 50,
      "字节豆包": 40,
      "腾讯混元": 30
    };
    const weightL = providerWeights[left.provider] || 0;
    const weightR = providerWeights[right.provider] || 0;
    
    if (weightL !== weightR) {
      return weightR - weightL; // Priority provider first
    }
    
    const checkLegacy = (model) => {
      const status = String(model.status || '').toLowerCase();
      if (status === 'legacy' || status === 'deprecated' || status === 'inactive') {
        return true;
      }
      const desc = String(model.description || '').toLowerCase();
      const name = String(model.name || '').toLowerCase();
      const id = String(model.id || '').toLowerCase();
      return desc.includes('废弃') || desc.includes('旧版') || desc.includes('legacy') || desc.includes('deprecated') || desc.includes('inactive') || desc.includes('停用') ||
             name.includes('废弃') || name.includes('旧版') || name.includes('legacy') || name.includes('deprecated') || name.includes('inactive') || name.includes('停用') ||
             id.includes('legacy') || id.includes('deprecated') || id.includes('inactive');
    };
    
    const isLegacyL = checkLegacy(left);
    const isLegacyR = checkLegacy(right);
    
    if (isLegacyL !== isLegacyR) {
      return isLegacyL ? 1 : -1; // Inactive/Legacy models to the bottom
    }
    
    function getModelRank(model) {
      const id = model.id.toLowerCase();
      const name = model.name.toLowerCase();
      
      // 1. Check custom overrides first for absolute flagship prioritization
      const overrides = {
        // OpenAI overrides
        "openai-gpt-5-5-pro": 1000,
        "openai-gpt-5-5": 990,
        "openai-gpt-5-4-pro": 980,
        "openai-gpt-5-4": 970,
        "openai-gpt-5-4-mini": 960,
        "openai-gpt-5-4-nano": 950,
        "openai-gpt-5-3-codex": 900,
        // Anthropic overrides
        "anthropic-claude-3-opus": 850,
        "anthropic-claude-3-7-sonnet": 840,
        "anthropic-claude-3-5-haiku": 830,
      };
      
      if (overrides[id] !== undefined) {
        return overrides[id];
      }
      
      // 2. Parse generation version (e.g. 3.5, 3.1, 2.5, 2.0)
      let version = 0;
      const versionMatch = id.match(/(\d+)[-\.](\d+)/) || name.match(/(\d+)\.(\d+)/);
      if (versionMatch) {
        version = Number(`${versionMatch[1]}.${versionMatch[2]}`);
      } else {
        const singleMatch = id.match(/-(\d+)(?:-|$)/) || name.match(/(\d+)/);
        if (singleMatch) {
          version = Number(singleMatch[1]);
        }
      }
      
      // 3. Determine tier weight
      let tierWeight = 0.5; // default standard tier
      if (id.includes('pro') || id.includes('opus') || id.includes('max') || id.includes('ultra') || id.includes('turbo') || id.includes('preview')) {
        tierWeight = 0.9;
      } else if (id.includes('haiku') || id.includes('mini') || id.includes('lite') || id.includes('nano') || id.includes('small') || id.includes('codex') || id.includes('fast')) {
        tierWeight = 0.1;
      }
      
      return (version * 100) + (tierWeight * 10);
    }
    
    const rankL = getModelRank(left);
    const rankR = getModelRank(right);
    
    if (rankL !== rankR) {
      return rankR - rankL; // Higher rank first
    }
    
    return left.name.localeCompare(right.name, "zh-CN");
  });
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
  
  // Sort models elegantly based on priority, version, and legacy status
  const sortedModels = sortModels(nextModels);
  const nextDataset = buildDataset(sortedModels, targetDate);
  
  // Synchronize sources.json's models list with newly parsed and current models dynamically
  for (const source of sourceList) {
    const providerModelIds = sortedModels
      .filter((model) => model.provider === source.provider)
      .map((model) => model.id);
    source.models = providerModelIds;
  }
  
  const historySnapshotPath = getHistorySnapshotPath(targetDate);

  await Promise.all([
    writeJson(MODELS_PATH, nextDataset),
    writeJson(historySnapshotPath, nextDataset),
    writeJson(SOURCES_PATH, sourceList)
  ]);
  
  console.log(
    `[update] wrote history snapshot ${
      path.relative(ROOT_DIR, historySnapshotPath) || path.basename(historySnapshotPath)
    }`
  );
  console.log(`[update] dynamically synchronized ${sourceList.length} sources inside sources.json`);
  await updateSitemap(nextDataset);
  console.log(`Updated ${nextModels.length} models for ${targetDate}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
