# Anthropic 模型 ID 修正与历史数据补齐实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 动态解析 Anthropic 最新模型价格数据，纠正模型 ID 格式为官方 API 可调用格式，并高保真地补齐与修正历史快照及 changelog.json 中的数据与变更记录。

**架构：**
1. 移除 `scripts/providers/anthropic.js` 里的硬编码 `MODEL_ID_MAP`，采用正则抓取 Family 和 Version 并按 `claude-${family}-${version}` 规则拼装 ID。
2. 在 `scripts/update.js` 的 `MODEL_BLUEPRINTS` 蓝图中同步更新这三个模型的 ID、detailPath 和名称。
3. 编写一键数据修复与补齐脚本 `scripts/migrate-anthropic.js`，通过对应的 raw HTML 重新解析并还原 5月30日以来的历史快照数据，补齐遗漏模型，物理修补 changelog.json 记录并更正所有历史不规范 ID。
4. 运行验证，保留迁移结果但撤销测试当天生成的历史增量数据。

**技术栈：** Node.js, Cheerio, Git

---

### 任务 1：重构 `scripts/providers/anthropic.js`

**文件：**
- 修改：`d:\model-radar\scripts\providers\anthropic.js`

- [ ] **步骤 1：编写最少实现代码**
  在 `scripts/providers/anthropic.js` 中重写 `resolveModelIdentity` 函数，取消 `MODEL_ID_MAP` 并替换为动态解析逻辑。

  ```javascript
  // 替换原有 MODEL_ID_MAP 和 resolveModelIdentity
  function resolveModelIdentity(title) {
    const normalized = title.replace(/\s+/g, " ").trim();
    // 提取模型家族 (fable|opus|sonnet|haiku) 以及版本号
    const match = normalized.match(/\b(fable|opus|sonnet|haiku)\b\s*([\d.]+)?/i);
    if (!match) {
      return null;
    }

    const family = match[1].toLowerCase();
    const version = match[2] || "";

    // 拼装 ID
    let id = `claude-${family}`;
    if (version) {
      id += `-${version.replace(/\./g, "-")}`;
    }

    // 特殊情况：Haiku 4.5 需要映射到官方包含日期戳的特定 ID
    if (id === "claude-haiku-4-5") {
      id = "claude-haiku-4-5-20251001";
    }

    const name = /^claude\b/i.test(normalized) ? normalized : `Claude ${normalized}`;
    return {
      family,
      id,
      name
    };
  }
  ```

- [ ] **步骤 2：测试提取的正确性**
  运行命令行，用修改后的模块解析 `11.html`，确认提取出 11 个正确的模型。
  运行：`node -e "const fetch = require('./scripts/providers/anthropic.js'); const fs = require('fs'); const html = fs.readFileSync('./raw/anthropic/2026/06/11.html', 'utf8'); fetch({html}).then(console.log);"`
  预期：输出包含 `claude-fable-5` 到 `claude-opus-4` 等 11 个模型对象的数组。

- [ ] **步骤 3：Commit**
  运行：
  `git add scripts/providers/anthropic.js`
  `git commit -m "refactor(anthropic): support dynamic model ID parsing and complete scraping"`

---

### 任务 2：更新 `scripts/update.js` 中的 `MODEL_BLUEPRINTS`

**文件：**
- 修改：`d:\model-radar\scripts\update.js`

- [ ] **步骤 1：编写修改代码**
  将 `scripts/update.js` 中的 `MODEL_BLUEPRINTS` 里的三个 Anthropic 兜底模型的 ID、名称与详情页路径做如下更新：

  ```javascript
  // 替换 lines 91-144 中的旧数据项为：
    {
      id: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      provider: "Anthropic",
      family: "Claude",
      description: "最智能的多模态旗舰模型，适合高难度推理与复杂代码任务。",
      inputPriceUsdPer1M: 5,
      outputPriceUsdPer1M: 25,
      cacheWritePriceUsdPer1M: 6.25,
      cacheReadPriceUsdPer1M: 0.5,
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      capabilities: ["长文本", "推理", "代码", "多模态"],
      recommendedFor: ["高难度编程", "科学研究", "复杂战略分析"],
      status: "stable",
      detailPath: "/model/claude-opus-4-8",
      sourceType: "provider"
    },
    {
      id: "claude-haiku-4-5-20251001",
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
      detailPath: "/model/claude-haiku-4-5-20251001",
      sourceType: "provider"
    },
    {
      id: "claude-sonnet-4-6",
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
      detailPath: "/model/claude-sonnet-4-6",
      sourceType: "provider"
    },
  ```

- [ ] **步骤 2：运行测试**
  运行：`node -e "require('./scripts/update.js')"`
  预期：无语法错误（只因没有传入参数直接打印退出）。

- [ ] **步骤 3：Commit**
  运行：
  `git add scripts/update.js`
  `git commit -m "refactor(update): update Anthropic blueprints with new ID rules"`

---

### 任务 3：编写迁移与数据修复脚本

**文件：**
- 创建：`d:\model-radar\scripts\migrate-anthropic.js`

- [ ] **步骤 1：编写迁移代码**
  编写包含历史快照重新解析补全、ID 映射及 changelog.json 修正的一键迁移脚本：

  ```javascript
  const fs = require('fs');
  const path = require('path');
  const cheerio = require('cheerio');
  const fetchAnthropicModels = require('./providers/anthropic');

  const DATA_DIR = path.join(__dirname, '../data');
  const HISTORY_DIR = path.join(DATA_DIR, 'history');
  const RAW_DIR = path.join(__dirname, '../raw/anthropic');

  const OLD_TO_NEW_MAP = {
    'claude-3-opus-20240229': 'claude-opus-4-8',
    'claude-3-7-sonnet-20250219': 'claude-sonnet-4-6',
    'claude-3-5-haiku-20241022': 'claude-haiku-4-5-20251001'
  };

  async function runMigration() {
    console.log("Starting Anthropic data migration...");

    // 1. 迁移 data/sources.json
    const sourcesPath = path.join(DATA_DIR, 'sources.json');
    if (fs.existsSync(sourcesPath)) {
      const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
      sources.forEach(source => {
        if (source.provider === 'Anthropic') {
          // 重新抓取 11 个模型后 sources.json 会在 update.js 中重新生成，这里先做一个基础替换
          source.models = source.models.map(id => OLD_TO_NEW_MAP[id] || id);
        }
      });
      fs.writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + '\n', 'utf8');
      console.log("Updated sources.json.");
    }

    // 2. 遍历并修正 history/*.json
    const historyFiles = fs.readdirSync(HISTORY_DIR).filter(file => file.endsWith('.json'));
    for (const file of historyFiles) {
      const filePath = path.join(HISTORY_DIR, file);
      const dataset = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const dateStr = file.replace('.json', ''); // YYYY-MM-DD
      const [year, month, day] = dateStr.split('-');

      const htmlPath = path.join(RAW_DIR, `${year}/${month}/${day}.html`);
      let hasHtml = fs.existsSync(htmlPath);

      if (hasHtml) {
        console.log(`Re-scraping for history: ${file} (found raw HTML)`);
        const html = fs.readFileSync(htmlPath, 'utf8');
        const parsedModels = await fetchAnthropicModels({ html, url: 'https://claude.com/pricing', updatedAt: `${dateStr}T00:00:00.000Z` });
        
        // 过滤非 Anthropic 模型，并继承元数据合并
        const nonAnthropic = dataset.models.filter(m => m.provider !== 'Anthropic');
        const anthropicBase = dataset.models.filter(m => m.provider === 'Anthropic');
        
        // 将抓取来的数据标准化（利用 update.js 中的同等逻辑，这里做个简单填充）
        const normalizedAnthropic = parsedModels.map(pm => {
          const baseModel = anthropicBase.find(bm => bm.id === OLD_TO_NEW_MAP[pm.id] || bm.id === pm.id) || {};
          return {
            id: pm.id,
            name: pm.name,
            provider: "Anthropic",
            family: "Claude",
            description: baseModel.description || `抓取自 Anthropic 官方定价页。`,
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
            contextWindow: pm.id === 'claude-opus-4-8' ? 1000000 : (pm.id === 'claude-sonnet-4-6' || pm.id === 'claude-haiku-4-5-20251001' ? 200000 : null),
            maxOutputTokens: pm.id === 'claude-opus-4-8' ? 128000 : (pm.id === 'claude-sonnet-4-6' ? 16384 : (pm.id === 'claude-haiku-4-5-20251001' ? 8192 : null)),
            capabilities: pm.id.includes('sonnet') || pm.id.includes('opus') ? ["长文本", "推理", "代码"] : ["文本", "分类", "代码"],
            recommendedFor: baseModel.recommendedFor || ["待补充"],
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
        console.log(`Physically mapping IDs for history: ${file} (no raw HTML)`);
        dataset.models = dataset.models.map(m => {
          if (m.provider === 'Anthropic') {
            const newId = OLD_TO_NEW_MAP[m.id] || m.id;
            m.id = newId;
            m.detailPath = `/model/${newId}`;
            // 修正早期文件里名字对应不准确
            if (m.name === 'Claude Opus 4.7' && newId === 'claude-opus-4-8') {
              m.name = 'Claude Opus 4.8';
            }
          }
          return m;
        });
      }
      
      // 写入修正后的历史快照
      fs.writeFileSync(filePath, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
    }

    // 3. 修正 models.json (2026-06-11，是有 raw HTML 11.html 的)
    const modelsPath = path.join(DATA_DIR, 'models.json');
    if (fs.existsSync(modelsPath)) {
      const dataset = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
      const dateStr = dataset.effectiveDate || '2026-06-11';
      const [year, month, day] = dateStr.split('-');
      const htmlPath = path.join(RAW_DIR, `${year}/${month}/${day}.html`);
      
      if (fs.existsSync(htmlPath)) {
        console.log(`Re-scraping for models.json`);
        const html = fs.readFileSync(htmlPath, 'utf8');
        const parsedModels = await fetchAnthropicModels({ html, url: 'https://claude.com/pricing', updatedAt: `${dateStr}T00:00:00.000Z` });
        const nonAnthropic = dataset.models.filter(m => m.provider !== 'Anthropic');
        const anthropicBase = dataset.models.filter(m => m.provider === 'Anthropic');
        
        const normalizedAnthropic = parsedModels.map(pm => {
          const baseModel = anthropicBase.find(bm => bm.id === OLD_TO_NEW_MAP[pm.id] || bm.id === pm.id) || {};
          return {
            id: pm.id,
            name: pm.name,
            provider: "Anthropic",
            family: "Claude",
            description: baseModel.description || `抓取自 Anthropic 官方定价页。`,
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
            contextWindow: pm.id === 'claude-opus-4-8' ? 1000000 : (pm.id === 'claude-sonnet-4-6' || pm.id === 'claude-haiku-4-5-20251001' ? 200000 : null),
            maxOutputTokens: pm.id === 'claude-opus-4-8' ? 128000 : (pm.id === 'claude-sonnet-4-6' ? 16384 : (pm.id === 'claude-haiku-4-5-20251001' ? 8192 : null)),
            capabilities: pm.id.includes('sonnet') || pm.id.includes('opus') ? ["长文本", "推理", "代码"] : ["文本", "分类", "代码"],
            recommendedFor: baseModel.recommendedFor || ["待补充"],
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
      console.log("Updated models.json.");
    }

    // 4. 修复 changelog.json
    const changelogPath = path.join(DATA_DIR, 'changelog.json');
    if (fs.existsSync(changelogPath)) {
      const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
      
      // A. 更新已有条目中的旧 ID 及其关联属性
      changelog.history = changelog.history.map(entry => {
        // 修正 Google 去前缀
        if (entry.modelId === 'google-gemini-3-5-live-translate-preview') {
          entry.modelId = 'gemini-3-5-live-translate-preview';
          entry.id = entry.id.replace('google-gemini-3-5-live-translate-preview', 'gemini-3-5-live-translate-preview');
        }
        // 修正 Anthropic
        if (OLD_TO_NEW_MAP[entry.modelId]) {
          const newId = OLD_TO_NEW_MAP[entry.modelId];
          entry.id = entry.id.replace(entry.modelId, newId);
          entry.modelId = newId;
        }
        return entry;
      });

      // B. 检查 2026-06-10 是否有 Fable 5 的新增纪录，没有就补齐
      const fableExist = changelog.history.some(h => h.date === '2026-06-10' && h.modelId === 'claude-fable-5');
      if (!fableExist) {
        console.log("Injecting Claude Fable 5 new_model changelog entry into 2026-06-10...");
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
        // 插入到 history 开头（按照日期排序）
        changelog.history.unshift(newEntry);
      }
      
      // 重新排序 history 确保按日期递减，在同一天内按模型名字排序
      changelog.history.sort((left, right) => {
        if (left.date !== right.date) {
          return right.date.localeCompare(left.date);
        }
        return left.modelName.localeCompare(right.modelName, "zh-CN");
      });

      fs.writeFileSync(changelogPath, JSON.stringify(changelog, null, 2) + '\n', 'utf8');
      console.log("Updated changelog.json.");
    }

    console.log("Migration complete!");
  }

  runMigration().catch(console.error);
  ```

- [ ] **步骤 2：测试迁移脚本是否存在语法错误**
  运行：`node -c scripts/migrate-anthropic.js`
  预期：无语法报错

- [ ] **步骤 3：Commit**
  运行：
  `git add scripts/migrate-anthropic.js`
  `git commit -m "feat(migration): add migration script for Anthropic models and changelog"`

---

### 任务 4：执行修复并运行抓取验证

**文件：**
- 修改：所有数据 json 文件
- 删除：临时脚本文件

- [ ] **步骤 1：执行迁移脚本**
  运行：`node scripts/migrate-anthropic.js`
  预期：控制台正确输出各个修复的步骤日志，且无 Error 报错退出。

- [ ] **步骤 2：校验数据完整性与 diff 准确性**
  运行：`git diff data/sources.json` 和 `git diff data/changelog.json`
  预期：在 sources.json 中旧的 3 个 id 被修改，在 changelog.json 中新增了 Fable 5 的 new_model 条目，且原本的旧 ID 被纠正。

- [ ] **步骤 3：运行一次完整的本地抓取以验证新 Scraper 模块和数据更新流程**
  运行：
  `$env:MODEL_RADAR_DATE="2026-06-11"; node scripts/update.js`
  预期：
  1. 成功并发抓取各个厂商，控制台打印出抓取成功的模型数量。
  2. sitemap.xml 更新成功。
  3. `data/models.json` 和 `data/history/2026-06-11.json` 正确地按照 `sortModels` 逻辑进行了重排，排在 Anthropic 区域的是 11 个模型，且 ID 为新版规范，`claude-fable-5` 排在最前面，且没有 legacy 状态的模型。

- [ ] **步骤 4：物理撤销测试生成的当天快照与测试文件，并删除迁移脚本**
  在确认整个合并与数据修正完美通过后，我们要彻底清理现场：
  运行：
  `git checkout -- data/history/2026-06-11.json`
  `git checkout -- data/models.json`
  `rm scripts/migrate-anthropic.js`
  `rm scratch_parse.js`
  预期：工作区只保留对 `anthropic.js`、`update.js`、`sources.json`、`changelog.json` 以及历史 json （2026-06-09.json, 2026-06-10.json 等）的修改，保持没有任何临时测试文件，且当天快照文件没有产生脏数据被 commit。
