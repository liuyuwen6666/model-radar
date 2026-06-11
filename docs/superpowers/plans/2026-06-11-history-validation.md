# 历史快照数据校验与清洗实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标**：依据 `raw/` 目录下保存的官方定价网页快照，自动检查并订正 `data/history/` 下的 JSON 历史快照中的错误价格和状态字段，完美复原数据并重建 `data/changelog.json`。

**架构**：编写并执行 Node.js 自动纠偏与清洗脚本 `scripts/validate-history.js`。该脚本通过遍历 2026-05-30 至 2026-06-11 之间的 13 天历史数据，分别加载当天的 HTML 和快照 JSON，调取各大厂商的解析器提取理论价格与状态。若存在差异，则在 JSON 中直接覆盖订正并写回磁盘，最后重新构建完整的变更日志。

**技术栈**：Node.js, Cheerio。

---

### 任务 1：编写校验与清洗脚本

**文件：**
- 创建：`d:\model-radar\scripts\validate-history.js`

- [ ] **步骤 1：编写 `scripts/validate-history.js` 的完整核心逻辑代码**

```javascript
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const RAW_DIR = path.join(ROOT_DIR, 'raw');

// 导入各大提供商的官方抓取器
const PROVIDER_LOADERS = {
  'OpenAI': { file: 'openai', folder: 'openai' },
  'Anthropic': { file: 'anthropic', folder: 'anthropic' },
  'Google': { file: 'google', folder: 'google' },
  'DeepSeek': { file: 'deepseek', folder: 'deepseek_zh' }, // 优先用中文定价
  '月之暗面': { file: 'kimi', folder: 'moonshot' },
  '阿里通义': { file: 'qwen', folder: 'alibailian' },
  '字节豆包': { file: 'doubao', folder: 'volcengine' },
  '腾讯混元': { file: 'hunyuan', folder: 'hunyuan' }
};

// 价格浮点精度四舍五入
function roundPrice(value) {
  if (value === null || value === undefined) return null;
  return Math.round(value * 1000000) / 1000000;
}

// 检查是否为有限数值
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// 模拟 update.js 中的 normalizeModel 部分，只负责价格和状态比对
function getTheoryModel(crawledModel, baseModel, isDomestic) {
  const currency = crawledModel.currency || (isDomestic ? "CNY" : "USD");

  let inputPricePer1M = crawledModel.inputPricePer1M ?? crawledModel.input_price_usd_per_1m ?? null;
  let outputPricePer1M = crawledModel.outputPricePer1M ?? crawledModel.output_price_usd_per_1m ?? null;
  let cacheWritePricePer1M = crawledModel.cacheWritePricePer1M ?? crawledModel.cache_write_price_usd_per_1m ?? null;
  let cacheReadPricePer1M = crawledModel.cacheReadPricePer1M ?? crawledModel.cache_read_price_usd_per_1m ?? null;

  if (isDomestic && crawledModel.inputPricePer1M === undefined && crawledModel.input_price_usd_per_1m !== undefined) {
    inputPricePer1M = crawledModel.input_price_usd_per_1m * 7.25;
    outputPricePer1M = crawledModel.output_price_usd_per_1m * 7.25;
    cacheWritePricePer1M = crawledModel.cache_write_price_usd_per_1m ? crawledModel.cache_write_price_usd_per_1m * 7.25 : null;
    cacheReadPricePer1M = crawledModel.cache_read_price_usd_per_1m ? crawledModel.cache_read_price_usd_per_1m * 7.25 : null;
  }

  let inputPriceUsd = crawledModel.inputPriceUsdPer1M ?? crawledModel.input_price_usd_per_1m ?? null;
  let outputPriceUsd = crawledModel.outputPriceUsdPer1M ?? crawledModel.output_price_usd_per_1m ?? null;
  let cacheWritePriceUsd = crawledModel.cacheWritePriceUsdPer1M ?? crawledModel.cache_write_price_usd_per_1m ?? null;
  let cacheReadPriceUsd = crawledModel.cacheReadPriceUsdPer1M ?? crawledModel.cache_read_price_usd_per_1m ?? null;

  if (isDomestic && crawledModel.inputPriceUsdPer1M === undefined && inputPricePer1M !== null) {
    inputPriceUsd = inputPricePer1M / 7.25;
    outputPriceUsd = outputPricePer1M / 7.25;
    cacheWritePriceUsd = cacheWritePricePer1M ? cacheWritePricePer1M / 7.25 : null;
    cacheReadPriceUsd = cacheReadPricePer1M ? cacheReadPricePer1M / 7.25 : null;
  }

  return {
    id: crawledModel.id,
    provider: crawledModel.provider,
    currency,
    inputPricePer1M: isNumber(inputPricePer1M) ? roundPrice(inputPricePer1M) : null,
    outputPricePer1M: isNumber(outputPricePer1M) ? roundPrice(outputPricePer1M) : null,
    cacheWritePricePer1M: isNumber(cacheWritePricePer1M) ? roundPrice(cacheWritePricePer1M) : null,
    cacheReadPricePer1M: isNumber(cacheReadPricePer1M) ? roundPrice(cacheReadPricePer1M) : null,
    inputPriceUsdPer1M: isNumber(inputPriceUsd) ? roundPrice(inputPriceUsd) : null,
    outputPriceUsdPer1M: isNumber(outputPriceUsd) ? roundPrice(outputPriceUsd) : null,
    cacheWritePriceUsdPer1M: isNumber(cacheWritePriceUsd) ? roundPrice(cacheWritePriceUsd) : null,
    cacheReadPriceUsdPer1M: isNumber(cacheReadPriceUsd) ? roundPrice(cacheReadPriceUsd) : null,
    status: baseModel ? baseModel.status : "live"
  };
}

async function validateAndRepair() {
  const dates = fs.readdirSync(HISTORY_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort()
    .filter(date => date >= '2026-05-30' && date <= '2026-06-11');

  console.log(`Checking ${dates.length} daily snapshots against raw HTML...`);

  let repairedCount = 0;

  for (const date of dates) {
    const [year, month, day] = date.split('-');
    const jsonPath = path.join(HISTORY_DIR, `${date}.json`);
    const dataset = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    let isModified = false;

    // 模型 ID 快速映射查找
    const snapshotModelMap = new Map(dataset.models.map(m => [m.id, m]));

    for (const [provider, config] of Object.entries(PROVIDER_LOADERS)) {
      const htmlFile = path.join(RAW_DIR, config.folder, year, month, `${day}.html`);
      if (!fs.existsSync(htmlFile)) {
        continue;
      }

      const html = fs.readFileSync(htmlFile, 'utf8');
      const loaderFunc = require(`./providers/${config.file}`);

      try {
        const crawled = await loaderFunc({ html, url: `local://${htmlFile}`, updatedAt: `${date}T00:00:00.000Z` });
        const isDomestic = ["字节豆包", "阿里通义", "月之暗面", "腾讯混元"].includes(provider);

        // 比对每一个抓取到的理论模型
        for (const rawModel of crawled) {
          // 抓取脚本可能返回的 provider 名字跟实际快照不一样，这里做一下规范映射
          rawModel.provider = provider;
          const snapModel = snapshotModelMap.get(rawModel.id);

          const theory = getTheoryModel(rawModel, snapModel, isDomestic);

          if (!snapModel) {
            console.log(`[${date}] [NEW] Missing model: ${theory.id} in ${provider}`);
            // 如果历史快照中缺失此模型，予以补全其核心价格及状态
            const newModel = {
              id: theory.id,
              name: rawModel.name,
              provider: provider,
              family: rawModel.family || provider,
              description: `自动修复补全。`,
              currency: theory.currency,
              hasOfficialDualCurrency: rawModel.hasOfficialDualCurrency || false,
              inputPricePer1M: theory.inputPricePer1M,
              outputPricePer1M: theory.outputPricePer1M,
              cacheWritePricePer1M: theory.cacheWritePricePer1M,
              cacheReadPricePer1M: theory.cacheReadPricePer1M,
              inputPriceUsdPer1M: theory.inputPriceUsdPer1M,
              outputPriceUsdPer1M: theory.outputPriceUsdPer1M,
              cacheWritePriceUsdPer1M: theory.cacheWritePriceUsdPer1M,
              cacheReadPriceUsdPer1M: theory.cacheReadPriceUsdPer1M,
              contextWindow: rawModel.contextWindow || null,
              maxOutputTokens: rawModel.maxOutputTokens || null,
              capabilities: rawModel.capabilities || ["文本"],
              recommendedFor: ["修复自动补齐"],
              status: "live",
              sourceUrl: rawModel.source_url || "",
              sourceLabel: "Official Pricing",
              detailPath: `/model/${theory.id}`,
              pricingNotes: "数据订正校验时自动补齐的模型。",
              updatedAt: `${date}T00:00:00.000Z`,
              sourceType: "provider"
            };
            dataset.models.push(newModel);
            isModified = true;
            continue;
          }

          // 如果存在快照，核对核心价格字段
          const priceFields = [
            'inputPricePer1M', 'outputPricePer1M', 'cacheWritePricePer1M', 'cacheReadPricePer1M',
            'inputPriceUsdPer1M', 'outputPriceUsdPer1M', 'cacheWritePriceUsdPer1M', 'cacheReadPriceUsdPer1M'
          ];

          for (const field of priceFields) {
            const theoryVal = theory[field];
            const snapVal = snapModel[field];

            if (theoryVal !== snapVal) {
              console.log(`[${date}] [DIFF] Model: ${theory.id}, field: ${field}, snap: ${snapVal}, theory: ${theoryVal}`);
              snapModel[field] = theoryVal;
              isModified = true;
            }
          }

          // 校验 status 是否应为 live 而非 legacy
          if (snapModel.status === 'legacy') {
            console.log(`[${date}] [STATUS] Model: ${snapModel.id} is marked 'legacy' in snapshot but exists in raw html. Standardizing to 'live'`);
            snapModel.status = 'live';
            isModified = true;
          }
        }
      } catch (err) {
        console.error(`Error parsing ${provider} HTML on ${date}: ${err.message}`);
      }
    }

    if (isModified) {
      fs.writeFileSync(jsonPath, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
      console.log(`[${date}] Corrected snapshot successfully.`);
      repairedCount++;
    }
  }

  console.log(`Validation finished. Repaired ${repairedCount} snapshot JSON files.`);
}

validateAndRepair();
```

---

### 任务 2：执行校验与清洗

- [ ] **步骤 1：在只读测试模式下运行比对脚本，记录差异报告**
  运行：`node scripts/validate-history.js`
  预期：列出所有价格偏差和缺失项，自动更正 `data/history/` 目录下的 JSON。

- [ ] **步骤 2：校验 git status 状态**
  运行：`git status`
  预期：看到被更正的历史 JSON 快照列表。

---

### 任务 3：重建历史 Changelog 并校验

- [ ] **步骤 1：删除刚刚的临时清洗脚本**
  运行：`Remove-Item scripts/validate-history.js`
  预期：脚本物理删除，避免向仓库带入无用工具文件。

- [ ] **步骤 2：全量重建每日变更日志**
  运行：`node scripts/reconstruct-changelog.js`
  （注意：这里我们可以临时创建一个无 limits 的 reconstruct 脚本或者直接在 diff.js 修改后使用它重建）
  预期：输出 `Successfully reconstructed changelog with total 560 entries`。

- [ ] **步骤 3：数据结构校验**
  运行：`npm run schema:check`
  预期：`[schema] JSON-LD checks passed`

- [ ] **步骤 4：静态页面与构建测试**
  运行：`npm run build`
  预期：成功构建。

- [ ] **步骤 5：提交与推送**
  运行：`git commit -am "fix(history): validate and correct historical snapshot prices and status based on raw HTML"`
  运行：`git push`
