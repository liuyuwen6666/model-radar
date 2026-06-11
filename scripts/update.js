/**
 * @file update.js
 * 
 * @description
 * 【大模型价格雷达数据更新与抓取主控制脚本】
 * 本脚本是 AI 模型价格雷达（ModelRadar）的核心后台服务脚本。它负责自动抓取各大主流 AI 厂商（OpenAI, Anthropic, Google, DeepSeek, Kimi 等）的最新 API 价格，
 * 对抓取到的价格进行标准化处理（汇率换算、元数据合并），最后将结果持久化输出到静态 JSON 数据库文件（models.json）及每日历史快照归档中。
 * 
 * 核心执行流程：
 * 1. 初始化路径与环境变量：支持通过 `MODEL_RADAR_DATE` 指定目标日期（主要用于补录历史数据或测试）。
 * 2. 备份旧数据：将当前的 `models.json` 写入缓存 `models.previous.json` 作为回滚和差分对照基准。
 * 3. 执行网页并发抓取：并行触发 `providers/` 文件夹下各厂商官网定价爬虫脚本。
 * 4. 合并与降级（Merge & Fallback）：
 *    - 如果某厂商网页抓取成功：使用最新价格。同时在官网已消失的历史模型会被标记为 `legacy`（旧版遗留模型）并保留，以便作历史参考，不直接物理删除。
 *    - 如果抓取失败/未编写抓取器：降级使用本地基准模型数据，并可选在测试模式下模拟价格微调。
 * 5. 数据标准化：统一将人民币（CNY）与美元（USD）以固定汇率 7.25 双向换算，并补全缺少的能力标签、详情页路径等。
 * 6. 排序与输出：按厂商预设权重排序（如 OpenAI 靠前，国内厂商靠后），并把 `legacy`（废弃旧版）模型放到底部。随后写入 models.json、sources.json 以及每日历史快照文件，最后触发站点地图 sitemap.xml 的更新。
 * 
 * @usage
 * 在项目根目录下执行：
 * $ npm run update             # 默认以当天日期执行抓取与更新
 * $ MODEL_RADAR_DATE=2026-06-06 npm run update  # 指定特定日期更新（Linux/macOS）
 * $ $env:MODEL_RADAR_DATE="2026-06-06"; npm run update # 指定特定日期更新（Windows PowerShell）
 */

const fs = require("node:fs/promises");
const path = require("node:path");

// 引入各大厂商的官方定价网页抓取模块 (Scrapers)
const fetchAnthropicModels = require("./providers/anthropic");
const fetchGoogleModels = require("./providers/google");
const fetchOpenAIModels = require("./providers/openai");
const fetchDeepSeekModels = require("./providers/deepseek");
const fetchKimiModels = require("./providers/kimi");
const fetchQwenModels = require("./providers/qwen");
const fetchDoubaoModels = require("./providers/doubao");
const fetchHunyuanModels = require("./providers/hunyuan");

// 引入自动生成站点地图（Sitemap）的辅助库
const { writeSitemapForDataset } = require("./lib/sitemap");

// 定义各种资源路径
const ROOT_DIR = path.resolve(__dirname, "..");
// 数据目录：可通过环境变量 MODEL_RADAR_DATA_DIR 动态指定，默认是根目录下的 data 目录
const DATA_DIR = process.env.MODEL_RADAR_DATA_DIR
  ? path.resolve(ROOT_DIR, process.env.MODEL_RADAR_DATA_DIR)
  : path.join(ROOT_DIR, "data");
// 缓存目录：用于存放上一次的数据备份，默认是根目录下的 .cache 目录
const CACHE_DIR = process.env.MODEL_RADAR_CACHE_DIR
  ? path.resolve(ROOT_DIR, process.env.MODEL_RADAR_CACHE_DIR)
  : path.join(ROOT_DIR, ".cache");
// Sitemap.xml 地图文件的保存位置
const SITEMAP_PATH = process.env.MODEL_RADAR_SITEMAP_PATH
  ? path.resolve(ROOT_DIR, process.env.MODEL_RADAR_SITEMAP_PATH)
  : path.join(ROOT_DIR, "sitemap.xml");

// 最终汇总的模型 JSON 数据文件路径
const MODELS_PATH = path.join(DATA_DIR, "models.json");
// 厂商数据源配置（包含来源 URL）的文件路径
const SOURCES_PATH = path.join(DATA_DIR, "sources.json");
// 上一次的模型数据备份路径，用作回滚或 diff
const PREVIOUS_MODELS_PATH = path.join(CACHE_DIR, "models.previous.json");
// 每日历史快照的存档目录
const HISTORY_DIR = path.join(DATA_DIR, "history");

// 当抓取源配置里没填来源名称时使用的默认名称
const DEFAULT_SOURCE_LABEL = "Official Pricing";

// 厂商名称与相应爬虫函数的键值对映射表
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

// 需要进行校验和价格处理的价格字段列表
const PRICE_FIELDS = [
  "inputPriceUsdPer1M",      // 每百万 Token 输入价格 (USD)
  "outputPriceUsdPer1M",     // 每百万 Token 输出价格 (USD)
  "cacheWritePriceUsdPer1M", // 每百万 Token 缓存写入价格 (USD)
  "cacheReadPriceUsdPer1M"   // 每百万 Token 缓存读取价格 (USD)
];

// 本地基准模型数据蓝图：在网络请求失败或作为抓取冷启动时的兜底基础数据
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
    id: "doubao-seed-2.0-pro-32k",
    name: "豆包 Seed 2.0 Pro (32K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "最新一代豆包旗舰多模态大模型，32K 上下文规格，在通用问答和复杂推理中表现优秀。",
    inputPriceUsdPer1M: 3.20 / 7.25,
    outputPriceUsdPer1M: 16.00 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 0.64 / 7.25,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "多模态", "推理", "旗舰模型"],
    recommendedFor: ["高级 Agent", "复杂逻辑推理", "企业智能助手"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-pro-32k",
    sourceType: "provider"
  },
  {
    id: "doubao-seed-2.0-pro-128k",
    name: "豆包 Seed 2.0 Pro (128K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "最新一代豆包旗舰多模态大模型，128K 长文本规格，适合长文本摘要与长程对话。",
    inputPriceUsdPer1M: 4.80 / 7.25,
    outputPriceUsdPer1M: 24.00 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 0.96 / 7.25,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "多模态", "长文本", "旗舰模型"],
    recommendedFor: ["长文档审计", "长程对话交互", "中长篇内容创作"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-pro-128k",
    sourceType: "provider"
  },
  {
    id: "doubao-seed-2.0-pro-256k",
    name: "豆包 Seed 2.0 Pro (256K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "最新一代豆包旗舰多模态大模型，256K 超长上下文，用于处理大型文档库或全代码工程。",
    inputPriceUsdPer1M: 9.60 / 7.25,
    outputPriceUsdPer1M: 48.00 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 1.92 / 7.25,
    contextWindow: 256000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "多模态", "超长文本", "旗舰模型"],
    recommendedFor: ["超长专业书稿处理", "多工程文件阅读", "超长上下文分析"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-pro-256k",
    sourceType: "provider"
  },
  {
    id: "doubao-seed-2.0-lite-32k",
    name: "豆包 Seed 2.0 Lite (32K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "极致高性价比的主力模型，32K 规格，响应快速且价格超值。",
    inputPriceUsdPer1M: 0.60 / 7.25,
    outputPriceUsdPer1M: 3.60 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 0.12 / 7.25,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "多模态", "高性价比"],
    recommendedFor: ["大批量分类任务", "高频普通客服", "基础文本提取"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-lite-32k",
    sourceType: "provider"
  },
  {
    id: "doubao-seed-2.0-lite-128k",
    name: "豆包 Seed 2.0 Lite (128K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "极致高性价比的主力模型，128K 规格，支持长文本批量提取与分类。",
    inputPriceUsdPer1M: 0.90 / 7.25,
    outputPriceUsdPer1M: 5.40 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 0.18 / 7.25,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "多模态", "长文本", "高性价比"],
    recommendedFor: ["批量合同对比", "大体量摘要提取", "长文本基础分类"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-lite-128k",
    sourceType: "provider"
  },
  {
    id: "doubao-seed-2.0-lite-256k",
    name: "豆包 Seed 2.0 Lite (256K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "极致高性价比的主力模型，256K 规格，用于平价处理超长文本或多篇关联文档。",
    inputPriceUsdPer1M: 1.80 / 7.25,
    outputPriceUsdPer1M: 10.80 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 0.36 / 7.25,
    contextWindow: 256000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "多模态", "超长文本", "高性价比"],
    recommendedFor: ["批量财报归档分析", "超长历史文献检索", "多篇论文联合精读"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-lite-256k",
    sourceType: "provider"
  },
  {
    id: "doubao-seed-2.0-mini-32k",
    name: "豆包 Seed 2.0 Mini (32K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "超低延迟、极低价格的轻量大模型，最适合快速高频的简单对话与单步任务。",
    inputPriceUsdPer1M: 0.20 / 7.25,
    outputPriceUsdPer1M: 2.00 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 0.04 / 7.25,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "极低成本", "低延迟"],
    recommendedFor: ["高并发即时问答", "简单指令解析", "智能单步交互"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-mini-32k",
    sourceType: "provider"
  },
  {
    id: "doubao-seed-2.0-mini-128k",
    name: "豆包 Seed 2.0 Mini (128K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "超低延迟、极低价格的轻量大模型，128K 规格支持长对话历史的流畅读取。",
    inputPriceUsdPer1M: 0.40 / 7.25,
    outputPriceUsdPer1M: 4.00 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 0.08 / 7.25,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "长文本", "极低成本", "低延迟"],
    recommendedFor: ["智能多轮长闲聊", "低成本批量摘要", "基础翻译工作"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-mini-128k",
    sourceType: "provider"
  },
  {
    id: "doubao-seed-2.0-mini-256k",
    name: "豆包 Seed 2.0 Mini (256K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "超低延迟、极低价格的轻量大模型，支持 256K 超长窗口的平价智能索引。",
    inputPriceUsdPer1M: 0.80 / 7.25,
    outputPriceUsdPer1M: 8.00 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 0.16 / 7.25,
    contextWindow: 256000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "超长文本", "极低成本", "低延迟"],
    recommendedFor: ["超长日志批量分析", "低成本客服知识库检索", "长对话归档提取"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-mini-256k",
    sourceType: "provider"
  },
  {
    id: "doubao-seed-2.0-code-32k",
    name: "豆包 Seed 2.0 Code (32K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "面向专业编程和代码生成的特化推理模型，擅长中短算法编写与代码审查。",
    inputPriceUsdPer1M: 3.20 / 7.25,
    outputPriceUsdPer1M: 16.00 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 0.64 / 7.25,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["代码", "推理", "专业模型"],
    recommendedFor: ["算法实现", "代码生成", "简单 Bug 修复"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-code-32k",
    sourceType: "provider"
  },
  {
    id: "doubao-seed-2.0-code-128k",
    name: "豆包 Seed 2.0 Code (128K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "面向专业编程和代码生成的特化推理模型，128K 规格支持长段复杂架构与依赖解读。",
    inputPriceUsdPer1M: 4.80 / 7.25,
    outputPriceUsdPer1M: 24.00 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 0.96 / 7.25,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ["代码", "推理", "长文本", "专业模型"],
    recommendedFor: ["代码重构设计", "多文件代码审计", "接口说明文档生成"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-code-128k",
    sourceType: "provider"
  },
  {
    id: "doubao-seed-2.0-code-256k",
    name: "豆包 Seed 2.0 Code (256K)",
    provider: "字节豆包",
    family: "Doubao",
    description: "面向专业编程和代码生成的特化推理模型，256K 超长窗口可整体阅读中型项目工程文件。",
    inputPriceUsdPer1M: 9.60 / 7.25,
    outputPriceUsdPer1M: 48.00 / 7.25,
    cacheWritePriceUsdPer1M: 0.017 / 7.25,
    cacheReadPriceUsdPer1M: 1.92 / 7.25,
    contextWindow: 256000,
    maxOutputTokens: 8192,
    capabilities: ["代码", "推理", "超长文本", "专业模型"],
    recommendedFor: ["项目工程级代码分析", "整站 Bug 溯源与定位", "多语言全栈逻辑串联"],
    status: "stable",
    detailPath: "/model/doubao-seed-2.0-code-256k",
    sourceType: "provider"
  },
  {
    id: "doubao-1.5-pro-32k",
    name: "豆包 1.5 Pro 32K",
    provider: "字节豆包",
    family: "Doubao",
    description: "偏中文企业应用的主力模型。",
    inputPriceUsdPer1M: 0.80 / 7.25,  // 人民币换算为美元价格：¥0.80 -> $0.1103
    outputPriceUsdPer1M: 2.00 / 7.25, // 人民币换算为美元价格：¥2.00 -> $0.2759
    cacheWritePriceUsdPer1M: 0.20 / 7.25, // ¥0.20 -> $0.0276
    cacheReadPriceUsdPer1M: 0.08 / 7.25,  // ¥0.08 -> $0.0110
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "多模态", "企业"],
    recommendedFor: ["企业 Copilot", "中文内容", "客服助手"],
    status: "stable",
    detailPath: "/model/doubao-1.5-pro-32k",
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
    id: "hunyuan-2-0-think-32k",
    name: "混元 2.0 Think (32K)",
    provider: "腾讯混元",
    family: "Hunyuan",
    description: "腾讯混元最新一代深度思考推理大模型，32K 上下文规格，在复杂数理逻辑与推理方面性能拔尖。",
    inputPriceUsdPer1M: 3.975 / 7.25,
    outputPriceUsdPer1M: 15.90 / 7.25,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "推理", "思考模式"],
    recommendedFor: ["高难度编程", "科学计算", "复杂策略分析"],
    status: "stable",
    detailPath: "/model/hunyuan-2-0-think-32k",
    sourceType: "provider"
  },
  {
    id: "hunyuan-2-0-think-128k",
    name: "混元 2.0 Think (128K)",
    provider: "腾讯混元",
    family: "Hunyuan",
    description: "腾讯混元最新一代深度思考推理大模型，128K 规格，支持长程上下文的深度长思考推理。",
    inputPriceUsdPer1M: 5.30 / 7.25,
    outputPriceUsdPer1M: 21.20 / 7.25,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "推理", "长文本", "思考模式"],
    recommendedFor: ["长文档深度推理", "学术文献分析", "复杂跨文件排错"],
    status: "stable",
    detailPath: "/model/hunyuan-2-0-think-128k",
    sourceType: "provider"
  },
  {
    id: "hunyuan-2-0-instruct-32k",
    name: "混元 2.0 Instruct (32K)",
    provider: "腾讯混元",
    family: "Hunyuan",
    description: "腾讯混元新一代常规推理指令大模型，32K 规格，响应快速，指令遵循能力极强。",
    inputPriceUsdPer1M: 3.18 / 7.25,
    outputPriceUsdPer1M: 7.95 / 7.25,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "指令遵循", "常规模型"],
    recommendedFor: ["高并发 API 服务", "日常办公助理", "精准指令执行"],
    status: "stable",
    detailPath: "/model/hunyuan-2-0-instruct-32k",
    sourceType: "provider"
  },
  {
    id: "hunyuan-2-0-instruct-128k",
    name: "混元 2.0 Instruct (128K)",
    provider: "腾讯混元",
    family: "Hunyuan",
    description: "腾讯混元新一代常规推理指令大模型，128K 规格，适合长历史对话和长文本理解与创作。",
    inputPriceUsdPer1M: 4.505 / 7.25,
    outputPriceUsdPer1M: 11.13 / 7.25,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "长文本", "指令遵循", "常规模型"],
    recommendedFor: ["企业长文档分析", "中长篇报告撰写", "长历史多轮客服"],
    status: "stable",
    detailPath: "/model/hunyuan-2-0-instruct-128k",
    sourceType: "provider"
  },
  {
    id: "hunyuan-t1",
    name: "混元 T1",
    provider: "腾讯混元",
    family: "Hunyuan",
    description: "腾讯最新一代低延迟常规轻量大模型，具有极高性价比。",
    inputPriceUsdPer1M: 1.00 / 7.25,
    outputPriceUsdPer1M: 4.00 / 7.25,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "低延迟", "极速"],
    recommendedFor: ["即时客服对话", "批量轻量级分类", "高并发日常助手"],
    status: "stable",
    detailPath: "/model/hunyuan-t1",
    sourceType: "provider"
  },
  {
    id: "hunyuan-a13b",
    name: "混元 a13b",
    provider: "腾讯混元",
    family: "Hunyuan",
    description: "腾讯高性价比精巧推理模型，适合在中等算力消耗下提供稳定的中文与代码性能。",
    inputPriceUsdPer1M: 0.50 / 7.25,
    outputPriceUsdPer1M: 2.00 / 7.25,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "低成本", "文本"],
    recommendedFor: ["高频次基础查询", "多语言简单文本翻译", "常见分类处理"],
    status: "stable",
    detailPath: "/model/hunyuan-a13b",
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
    id: "qwen3-7-max",
    name: "Qwen 3.7 Max",
    provider: "阿里通义",
    family: "Qwen",
    description: "最新一代推理与长上下文旗舰大模型，支持思考和非思考双模式。",
    inputPriceUsdPer1M: 12.00 / 7.25,
    outputPriceUsdPer1M: 36.00 / 7.25,
    cacheWritePriceUsdPer1M: 15.00 / 7.25,
    cacheReadPriceUsdPer1M: 1.20 / 7.25,
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "推理", "长上下文", "旗舰模型"],
    recommendedFor: ["复杂推理", "智能 Agent", "长文档分析", "高难度编程"],
    status: "stable",
    detailPath: "/model/qwen3-7-max",
    sourceType: "provider"
  },
  {
    id: "qwen3-7-max-preview",
    name: "Qwen 3.7 Max Preview",
    provider: "阿里通义",
    family: "Qwen",
    description: "新一代深度长思考旗舰预览版，仅支持思考模式，擅长复杂数理与代码逻辑。",
    inputPriceUsdPer1M: 12.00 / 7.25,
    outputPriceUsdPer1M: 36.00 / 7.25,
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "推理", "代码", "思考模式"],
    recommendedFor: ["深度数学推导", "复杂算法设计", "科研推理"],
    status: "stable",
    detailPath: "/model/qwen3-7-max-preview",
    sourceType: "provider"
  },
  {
    id: "qwen3-6-max-preview",
    name: "Qwen 3.6 Max Preview",
    provider: "阿里通义",
    family: "Qwen",
    description: "上一代深度思考旗舰预览版，价格实惠且推理性能优异。",
    inputPriceUsdPer1M: 9.00 / 7.25,
    outputPriceUsdPer1M: 54.00 / 7.25,
    cacheWritePriceUsdPer1M: 11.25 / 7.25,
    cacheReadPriceUsdPer1M: 0.90 / 7.25,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "推理", "思考模式"],
    recommendedFor: ["通用推理", "代码辅助", "逻辑分析"],
    status: "stable",
    detailPath: "/model/qwen3-6-max-preview",
    sourceType: "provider"
  },
  {
    id: "qwen3-max",
    name: "Qwen 3 Max",
    provider: "阿里通义",
    family: "Qwen",
    description: "高性价比旗舰推理模型，在标准算力下提供卓越的中文和逻辑性能。",
    inputPriceUsdPer1M: 2.50 / 7.25,
    outputPriceUsdPer1M: 10.00 / 7.25,
    cacheWritePriceUsdPer1M: 3.125 / 7.25,
    cacheReadPriceUsdPer1M: 0.25 / 7.25,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "推理", "低成本"],
    recommendedFor: ["企业日常应用", "高频智能助手", "常见业务分类"],
    status: "stable",
    detailPath: "/model/qwen3-max",
    sourceType: "provider"
  },
  {
    id: "qwen3-max-preview",
    name: "Qwen 3 Max Preview",
    provider: "阿里通义",
    family: "Qwen",
    description: "精巧推理模型预览版，在特定长对话和多轮问答中平衡速度与智能。",
    inputPriceUsdPer1M: 6.00 / 7.25,
    outputPriceUsdPer1M: 24.00 / 7.25,
    cacheWritePriceUsdPer1M: 7.50 / 7.25,
    cacheReadPriceUsdPer1M: 0.60 / 7.25,
    contextWindow: 32000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "推理", "文本"],
    recommendedFor: ["中等复杂度对话", "日常客服", "文本摘要"],
    status: "stable",
    detailPath: "/model/qwen3-max-preview",
    sourceType: "provider"
  },
  {
    id: "qwen3-7-plus",
    name: "Qwen 3.7 Plus",
    provider: "阿里通义",
    family: "Qwen",
    description: "最新一代极速推理与长文本主力模型，响应迅捷且推理扎实。",
    inputPriceUsdPer1M: 2.00 / 7.25,
    outputPriceUsdPer1M: 8.00 / 7.25,
    cacheWritePriceUsdPer1M: 2.50 / 7.25,
    cacheReadPriceUsdPer1M: 0.20 / 7.25,
    contextWindow: 256000,
    maxOutputTokens: 8192,
    capabilities: ["中文", "长文本", "极速"],
    recommendedFor: ["实时智能客服", "大批量长文本处理", "日常代码推荐"],
    status: "stable",
    detailPath: "/model/qwen3-7-plus",
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

/**
 * 获取本次数据更新的目标日期（格式：YYYY-MM-DD）
 * @description 优先读取环境变量 `MODEL_RADAR_DATE`。若未设置，则默认返回当前本地日期的 ISO 字符串前 10 位（即今天）。
 * @returns {string} 目标日期，格式如 "2026-06-06"
 * @throws {Error} 如果环境变量中的日期格式不是 YYYY-MM-DD，将抛出异常以防止脏数据注入
 */
function getTargetDate() {
  const rawDate = process.env.MODEL_RADAR_DATE;

  if (!rawDate) {
    return new Date().toISOString().slice(0, 10);
  }

  // 验证是否为 YYYY-MM-DD 格式
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    throw new Error("MODEL_RADAR_DATE must use YYYY-MM-DD format.");
  }

  return rawDate;
}

/**
 * 根据日期字符串构建标准 UTC 零点的时间戳字符串
 * @param {string} dateStamp - YYYY-MM-DD 格式的日期字符串
 * @returns {string} ISO 8601 标准时间戳，如 "2026-06-06T00:00:00.000Z"
 */
function buildTimestamp(dateStamp) {
  return `${dateStamp}T00:00:00.000Z`;
}

/**
 * 经典的 DJB2 字符串哈希算法实现
 * @description 用于为特定的日期、模型 ID 和字段生成唯一的正整数哈希值，主要服务于价格波动模拟函数 `simulatePrice`，确保模拟结果确定（幂等性）。
 * @param {string} input - 输入的源字符串
 * @returns {number} 32位无符号整数哈希值
 */
function hashString(input) {
  let hash = 0;

  for (const char of input) {
    // 经典的哈希混合运算：hash = hash * 31 + charCode
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash;
}

/**
 * 将浮点数价格保留 6 位有效小数（四舍五入）
 * @description 避免因浮点数乘除计算引起的 JS 精度误差问题（如 0.1 + 0.2 === 0.30000000000000004），保留更多位小数以支持高精度缓存优惠价。
 * @param {number} value - 输入的浮点数值
 * @returns {number} 保留六位小数后的数值
 */
function roundPrice(value) {
  return Math.round(value * 1000000) / 1000000;
}

/**
 * 校验输入值是否为合法的有限数值
 * @param {*} value - 待检测的变量
 * @returns {boolean} 如果是有限数字返回 true，否则返回 false（过滤 NaN, Infinity 以及非数字）
 */
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 将 JavaScript 对象格式化为带有两格缩进且末尾带换行符的 JSON 字符串
 * @description 使得输出的 JSON 数据结构稳定，便于 Git 进行版本差异对比（Diff）以及开发者可读。
 * @param {*} value - 要序列化的对象
 * @returns {string} 序列化后的 JSON 字符串
 */
function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * 异步确保指定目录存在，如果不存在则自动递归创建
 * @param {string} dirPath - 目标目录路径
 * @returns {Promise<void>}
 */
async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * 异步读取并解析指定路径的 JSON 文件
 * @description 若文件不存在（ENOENT 错误），则返回提供的 fallback 默认值，而不是向外抛出异常中断执行。
 * @param {string} filePath - JSON 文件路径
 * @param {*} fallback - 文件不存在时的降级返回值，默认为 null
 * @returns {Promise<*>} 解析后的 JavaScript 对象或降级值
 */
async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    // 捕获“文件不存在”异常并返回降级默认值，其它异常（如 JSON 格式损坏）继续抛出
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

/**
 * 严格校验输入的对象是否符合系统定义的 Dataset 数据集格式
 * @description 一个合法的 Dataset 必须是包含 `models` 数组及 `effectiveDate` 字符串的有效对象。
 * @param {*} dataset - 待检测的对象
 * @returns {boolean} 校验结果
 */
function isDataset(dataset) {
  return Boolean(
    dataset &&
    typeof dataset === "object" &&
    Array.isArray(dataset.models) &&
    typeof dataset.effectiveDate === "string"
  );
}

/**
 * 根据源数据列表构建以供应商（provider）为键的索引映射 Map
 * @description 用于快速查找特定厂商官方定价页的 URL 链接与标识，避免在遍历模型列表时重复进行数组查找。
 * @param {Array<Object>} sourceList - 厂商来源配置数组（来自 sources.json）
 * @returns {Map<string, Object>} 厂商名称 -> 厂商源配置对象的 Map 映射
 */
function buildSourceIndex(sourceList) {
  return new Map(
    (Array.isArray(sourceList) ? sourceList : []).map((source) => [source.provider, source])
  );
}

/**
 * 根据已有的模型数组构建以模型唯一标识（id）为键的索引映射 Map
 * @description 用于在抓取到最新定价时，快速根据模型 ID 寻找基准蓝图或历史配置以继承部分字段（如名称、描述、推荐场景等）。
 * @param {Array<Object>} models - 模型对象数组
 * @returns {Map<string, Object>} 模型 ID -> 模型对象的 Map 映射
 */
function buildBaseIndex(models) {
  const index = new Map();

  for (const model of Array.isArray(models) ? models : []) {
    index.set(model.id, model);
  }

  return index;
}

/**
 * 模型数据标准化函数
 * @description 对传入的裸模型数据进行全面修复与规范化：
 * 1. 自动识别国内外厂商并补全币种（国内厂商如阿里、字节、月之暗面默认为 CNY 人民币，国外为 USD 美元）；
 * 2. 按照 7.25 汇率计算并在 `*PricePer1M`（官方本币）和 `*PriceUsdPer1M`（美元折算价）之间进行双向高精度补齐；
 * 3. 补全默认字段（如 capabilities, recommendedFor, updatedAt 等），确保输出数据结构一致。
 * @param {Object} model - 待标准化的模型原始数据
 * @param {Map<string, Object>} sourceIndex - 厂商数据源索引映射
 * @param {string} timestamp - 更新时间戳
 * @returns {Object} 标准化后的模型对象
 */
function normalizeModel(model, sourceIndex, timestamp) {
  const source = sourceIndex.get(model.provider) || {};
  // 根据厂商名，判定是否为国内厂商（国内厂商支持 CNY）
  const isDomestic = model.currency === "CNY" || ["字节豆包", "阿里通义", "月之暗面", "腾讯混元"].includes(model.provider);
  const currency = model.currency || (isDomestic ? "CNY" : "USD");

  // 获取高精度官方本币价格
  let inputPricePer1M = model.inputPricePer1M;
  let outputPricePer1M = model.outputPricePer1M;
  let cacheWritePricePer1M = model.cacheWritePricePer1M;
  let cacheReadPricePer1M = model.cacheReadPricePer1M;

  // 如果本币价格为空，尝试用美元价格乘以 7.25 换算出来（仅限国内厂商）；如果是国外厂商，则直接等于美元价
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

  // 获取美元折算价
  let inputPriceUsdPer1M = model.inputPriceUsdPer1M;
  let outputPriceUsdPer1M = model.outputPriceUsdPer1M;
  let cacheWritePriceUsdPer1M = model.cacheWritePriceUsdPer1M;
  let cacheReadPriceUsdPer1M = model.cacheReadPriceUsdPer1M;

  // 如果美元价格为空，尝试用本币价格除以 7.25 换算出来（仅限国内厂商）；如果是国外厂商，则直接等于本币价
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

  // 返回格式统一的完整模型对象，并填充默认降级值
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

/**
 * 标准化最新抓取到的厂商模型数据
 * @description 将抓取器（crawler/provider loader）获取到的最新浮动数据与本地现有的静态基准模型（baseModel）进行合并：
 * 1. 继承 baseModel 中无法动态抓取的静态元数据（如详细描述、能力标签、推荐应用场景、详情页路径等）；
 * 2. 以最新抓取到的字段为准覆盖价格、上下文窗口和最大输出 Token 等易变属性；
 * 3. 通过 normalizeModel 函数进行最终的标准双语价格折算与补全。
 * @param {Object} providerModel - 抓取器返回的最新模型数据
 * @param {Object|undefined} baseModel - 已有的本地基准模型对象
 * @param {Map<string, Object>} sourceIndex - 厂商数据源索引映射
 * @param {string} targetDate - 目标日期 YYYY-MM-DD
 * @returns {Object} 标准化并合并后的模型对象
 */
function normalizeProviderModel(providerModel, baseModel, sourceIndex, targetDate) {
  // 取得最新抓取的时间戳，如无则使用当前目标日期的 UTC 零点时间戳
  const timestamp = providerModel.updatedAt || providerModel.updated_at || buildTimestamp(targetDate);
  const isDomestic = providerModel.currency === "CNY" || ["字节豆包", "阿里通义", "月之暗面", "腾讯混元"].includes(providerModel.provider);

  const hasRawPrices = providerModel.inputPricePer1M !== undefined;
  const currency = providerModel.currency || (isDomestic ? "CNY" : "USD");

  // 对抓取来的输入价格和输出价格进行处理与转换
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

  // 对缓存读取价格进行兜底合并
  const cacheReadPriceUsd = hasRawPrices
    ? providerModel.cacheReadPriceUsdPer1M
    : (providerModel.cache_read_price_usd_per_1m ?? (baseModel?.cacheReadPriceUsdPer1M ?? null));

  const cacheReadPrice = hasRawPrices
    ? providerModel.cacheReadPricePer1M
    : (isDomestic && cacheReadPriceUsd !== null ? cacheReadPriceUsd * 7.25 : cacheReadPriceUsd);

  // 对缓存写入价格进行兜底合并
  const cacheWritePriceUsd = hasRawPrices
    ? providerModel.cacheWritePriceUsdPer1M
    : (providerModel.cache_write_price_usd_per_1m ?? (baseModel?.cacheWritePriceUsdPer1M ?? null));

  const cacheWritePrice = hasRawPrices
    ? providerModel.cacheWritePricePer1M
    : (isDomestic && cacheWritePriceUsd !== null ? cacheWritePriceUsd * 7.25 : cacheWritePriceUsd);

  // 将整合好的数据传递给标准格式化函数
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
      capabilities: providerModel.capabilities || baseModel?.capabilities || ["文本"],
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

/**
 * 价格模拟变化函数（核心算法基于哈希决定）
 * @description 仅用于在非生产测试、缺失抓取器数据或需要模拟演练时，提供确定性的、跟日期绑定的微幅价格波动模拟：
 * 1. 利用 `hashString` 将日期、模型 ID 和当前校验价格字段混淆为一个哈希正整数；
 * 2. 计算余数，有较大数率保持原价（variant <= 2），也有一定概率进行 2%, 4%, 6% 级别的微调；
 * 3. 保证在同一个日期执行本脚本多次，生成的模拟价格完全一致（幂等性）。
 * @param {number|null} baseValue - 基准价格
 * @param {string} modelId - 模型唯一 ID
 * @param {string} field - 价格字段名（如 inputPriceUsdPer1M）
 * @param {string} targetDate - 目标日期
 * @returns {number|null} 模拟后的价格，或 null
 */
function simulatePrice(baseValue, modelId, field, targetDate) {
  if (!isNumber(baseValue)) {
    return null;
  }

  // 生成唯一哈希，使得模拟值在当前日期内绝对固定
  const hash = hashString(`${targetDate}:${modelId}:${field}`);
  const variant = hash % 7;

  // 0, 1, 2 时保持原价不动 (大概有 43% 的概率不变)
  if (variant <= 2) {
    return roundPrice(baseValue);
  }

  // 其他数值时进行 2%, 4% 或 6% 的微幅波动
  const delta = [0.02, 0.04, 0.06][hash % 3];
  const direction = variant % 2 === 0 ? 1 : -1;
  const nextValue = Math.max(baseValue * (1 + direction * delta), 0.01);

  return roundPrice(nextValue);
}

/**
 * 批量模拟生成下一天的模型数据列表
 * @description 多用于没有网络抓取或回滚补录场景，根据基准数据，自动运行哈希价格波动模拟，并按拼音对厂商和模型名称进行排序。
 * @param {Array<Object>} baseModels - 基准模型数组
 * @param {Map<string, Object>} sourceIndex - 来源索引映射 Map
 * @param {string} targetDate - 目标日期
 * @returns {Array<Object>} 模拟排序后的下一代模型列表
 */
function simulateNextModels(baseModels, sourceIndex, targetDate) {
  const timestamp = buildTimestamp(targetDate);

  return baseModels
    .map((model) => {
      const nextModel = normalizeModel(model, sourceIndex, timestamp);

      // 仅对 sourceType 为 provider（代表是由爬虫支撑的模型）的价格运行模拟波动
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

/**
 * 核心抓取控制：并发加载并执行所有已注册的厂商抓取器
 * @description 遍历 `sources.json` 中配置的数据源，若在 `PROVIDER_LOADERS` 中存在对应的抓取执行器：
 * 1. 异步触发抓取器加载（如访问 OpenAI/Google 的官方 API 或解析国内网页 HTML）；
 * 2. 收集成功返回的模型定价数据；
 * 3. 捕获任何网络或脚本报错，保证某个厂商抓取失败时不影响其他厂商的更新。
 * @param {Array<Object>} sourceList - 数据源配置列表
 * @param {string} targetDate - 目标日期
 * @returns {Promise<Map<string, Array<Object>>>>} 抓取成功的供应商快照映射 Map (provider -> models[])
 */
async function loadProviderSnapshots(sourceList, targetDate) {
  const snapshots = new Map();

  for (const source of Array.isArray(sourceList) ? sourceList : []) {
    const loader = PROVIDER_LOADERS[source.provider];

    if (!loader) {
      continue;
    }

    console.log(`[update] loading provider ${source.provider} from ${source.url}`);

    try {
      // 触发异步爬虫抓取
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
      // 捕获异常，打印错误警告，但不中断整个程序的执行（弹性容错）
      console.warn(`[update] provider ${source.provider} failed: ${error.message}`);
    }
  }

  return snapshots;
}

/**
 * 核心业务组装：合并本地基准模型与云端最新抓取的模型
 * @description 组装逻辑：
 * 1. 遍历当前本地的所有已知模型；
 * 2. 如果当前厂商的抓取任务成功了：
 *    - 将该厂商抓取到的最新模型（合并基准元数据后）加入列表；
 *    - 寻找并标记该厂商下已废弃的历史遗留老模型（即在 baseModels 中有，但抓取到的新列表里已经消失的模型），将其状态 status 设为 "legacy" 并追加过期定价提示，保留作为历史参考，不予删除；
 * 3. 如果当前厂商没有被抓取（如没有写抓取器，或者抓取器运行出错降级）：
 *    - 沿用现有的基准模型；
 *    - 如果开启了 `shouldSimulateFallback`，则在 fallback 数据上应用模拟的价格微调，以便在测试环境下演示价格波动。
 * @param {Array<Object>} baseModels - 本地原有的模型列表
 * @param {Map<string, Array<Object>>} providerSnapshots - 抓取成功的最新模型快照 Map
 * @param {Map<string, Object>} sourceIndex - 来源索引 Map
 * @param {string} targetDate - 目标日期
 * @param {boolean} shouldSimulateFallback - 是否对 fallback 数据应用模拟波动
 * @returns {Array<Object>} 合并更新完成后的全新模型数组
 */
function buildNextModels(baseModels, providerSnapshots, sourceIndex, targetDate, shouldSimulateFallback) {
  const timestamp = buildTimestamp(targetDate);
  const baseIndex = buildBaseIndex(baseModels);
  const loadedProviders = new Set(providerSnapshots.keys());
  const injectedProviders = new Set();
  const nextModels = [];

  for (const model of baseModels) {
    // 场景 A：抓取器运行成功了，我们需要优先把抓取到的该供应商的所有最新模型注入列表
    if (loadedProviders.has(model.provider) && !injectedProviders.has(model.provider)) {
      const providerModels = providerSnapshots.get(model.provider) || [];
      const crawledModelIds = new Set(providerModels.map(pm => pm.id));

      // 1. 注入全新抓取到的模型列表
      for (const providerModel of providerModels) {
        const baseProviderModel = baseIndex.get(providerModel.id);
        nextModels.push(normalizeProviderModel(providerModel, baseProviderModel, sourceIndex, targetDate));
      }

      // 2. 找到官网不再展示的老模型，转换成 status: "legacy" 进行软废弃保留，避免物理删除导致历史失效
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

    // 已经处理完抓取结果的厂商直接跳过
    if (loadedProviders.has(model.provider)) {
      continue;
    }

    // 场景 B：该厂商抓取失败或根本没有配置抓取器，则降级使用之前的静态数据
    const nextModel = normalizeModel(model, sourceIndex, timestamp);

    // 如果开启了模拟数据选项，且是爬虫驱动类型的模型，允许微调价格以观察变化
    if (shouldSimulateFallback && nextModel.sourceType === "provider") {
      for (const field of PRICE_FIELDS) {
        nextModel[field] = simulatePrice(nextModel[field], nextModel.id, field, targetDate);
      }
    }

    nextModels.push(nextModel);
  }

  // 兜底处理：如果抓取到了一个完全全新的厂商，且本地库里完全没有任何属于该厂商的历史模型记录，在这里补充写入
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

/**
 * 组装并生成最终的静态数据库 Schema
 * @description 添加版本号、生成时间、免责声明等外层包覆元数据。
 * @param {Array<Object>} models - 标准化并排序后的模型数组
 * @param {string} targetDate - 目标日期
 * @returns {Object} 符合 Schema 规范的 Dataset 数据集对象
 */
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

/**
 * 获取每日历史快照 JSON 文件的存放路径
 * @param {string} targetDate - 目标日期，如 "2026-06-06"
 * @returns {string} 历史文件绝对路径，形如 "/data/history/2026-06-06.json"
 */
function getHistorySnapshotPath(targetDate) {
  return path.join(HISTORY_DIR, `${targetDate}.json`);
}

/**
 * 异步写入 JSON 数据到指定文件
 * @description 会自动确保父级文件夹目录存在，并采用 stableJson 确保格式稳定性。
 * @param {string} filePath - 文件路径
 * @param {*} value - 要写入的 JS 对象
 * @returns {Promise<void>}
 */
async function writeJson(filePath, value) {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, stableJson(value), "utf8");
}

/**
 * 联动更新网站的 sitemap.xml 地图索引文件
 * @description 根据最新的数据集，调用 sitemap 库重新计算并覆盖写入根目录下的 sitemap.xml 文件，确保 SEO 爬虫能及时抓取新模型页面。
 * @param {Object} dataset - 数据集对象
 * @returns {Promise<void>}
 */
async function updateSitemap(dataset) {
  const entries = await writeSitemapForDataset({
    dataset,
    sitemapPath: SITEMAP_PATH
  });
  console.log(
    `[update] wrote sitemap ${path.relative(ROOT_DIR, SITEMAP_PATH) || path.basename(SITEMAP_PATH)} with ${entries.length} entries`
  );
}

/**
 * 模型列表的多级排序算法
 * @description 排序权重逻辑如下：
 * 1. 【厂商重要程度权重】：优先展示热门大厂（OpenAI权重 100 > Anthropic权重 90 > ... > 腾讯混元权重 30 > fallback 0）；
 * 2. 【生命周期状态过滤】：在同一厂商内，活跃模型（status !== 'legacy'）始终排在最前面，已废弃或历史旧版模型（status === 'legacy'）被挪至该厂商列表的最底部；
 * 3. 【稳定性保障】：在同一厂商且活跃状态相同的情况下，严格维持原有的蓝图或抓取器返回的排序序号，防止列表顺序在每次构建时发生抖动。
 * @param {Array<Object>} models - 待排序的模型列表
 * @returns {Array<Object>} 排序好的新模型列表拷贝
 */
function sortModels(models) {
  const originalIndexes = new Map(models.map((model, idx) => [model.id, idx]));

  return [...models].sort((left, right) => {
    // 厂商推荐权重映射表
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

    // 权重高（大厂）的排在前面
    if (weightL !== weightR) {
      return weightR - weightL;
    }

    // 检查模型是否属于“旧版”、“废弃”状态的辅助判断函数
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

    // 活跃模型在前，老旧废弃模型排在厂商内部的底部
    if (isLegacyL !== isLegacyR) {
      return isLegacyL ? 1 : -1;
    }

    // 如果厂商和状态都一致，则维持它们在原始列表中的相对位置，确保排序稳定性（稳定性排序）
    const idxL = originalIndexes.get(left.id);
    const idxR = originalIndexes.get(right.id);
    return idxL - idxR;
  });
}

/**
 * 整个更新流水线的入口主函数
 * @description 串联所有前置配置读取、旧数据备份、网页并发抓取、数据整合标准化、排序同步、地毯式写入以及 SEO Sitemap 更新等任务，处理完毕后优雅退出。
 */
async function main() {
  const targetDate = getTargetDate();
  const currentDataset = await readJson(MODELS_PATH, null);
  const sourceList = await readJson(SOURCES_PATH, []);
  const sourceIndex = buildSourceIndex(sourceList);

  await ensureDirectory(CACHE_DIR);

  // 1. 备份数据：将现有的 models.json 内容写到 models.previous.json
  if (currentDataset) {
    await writeJson(PREVIOUS_MODELS_PATH, currentDataset);
  } else {
    // 首次冷启动时，使用本地的模型数据蓝图作为默认备份
    await writeJson(
      PREVIOUS_MODELS_PATH,
      buildDataset(
        MODEL_BLUEPRINTS.map((model) => normalizeModel(model, sourceIndex, buildTimestamp(targetDate))),
        targetDate
      )
    );
  }

  // 取得用来合并或修改的基准模型数组
  const baseModels = isDataset(currentDataset) ? currentDataset.models : MODEL_BLUEPRINTS;
  
  // 判断是否需要在 fallback 时模拟波动价格（当数据有效日期与目标日期不同，或者没有之前的数据集时开启）
  const shouldSimulateFallback =
    !isDataset(currentDataset) || currentDataset.effectiveDate !== targetDate;
  
  // 2. 爬虫抓取：触发并收集所有云端厂商定价页的最新模型数据
  const providerSnapshots = await loadProviderSnapshots(sourceList, targetDate);
  
  // 3. 数据融合：合并基准模型与抓取结果，获得更新后的模型数组
  const nextModels = buildNextModels(
    baseModels,
    providerSnapshots,
    sourceIndex,
    targetDate,
    shouldSimulateFallback
  );

  // 4. 数据重排：按照大厂优先和旧版置底规则进行多级稳定排序
  const sortedModels = sortModels(nextModels);
  const nextDataset = buildDataset(sortedModels, targetDate);

  // 5. 动态联动：实时同步更新 sources.json 里面的 models ID 列表，使各厂商拥有的模型关系保持最新
  for (const source of sourceList) {
    const providerModelIds = sortedModels
      .filter((model) => model.provider === source.provider)
      .map((model) => model.id);
    source.models = providerModelIds;
  }

  const historySnapshotPath = getHistorySnapshotPath(targetDate);

  // 6. 三合一异步写入：并行保存 models.json、sources.json 和当日历史归档
  await Promise.all([
    writeJson(MODELS_PATH, nextDataset),
    writeJson(historySnapshotPath, nextDataset),
    writeJson(SOURCES_PATH, sourceList)
  ]);

  console.log(
    `[update] wrote history snapshot ${path.relative(ROOT_DIR, historySnapshotPath) || path.basename(historySnapshotPath)}`
  );
  console.log(`[update] dynamically synchronized ${sourceList.length} sources inside sources.json`);
  
  // 7. 更新 SEO Sitemap
  await updateSitemap(nextDataset);
  console.log(`Updated ${nextModels.length} models for ${targetDate}`);
}

// 启动执行主程序
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
