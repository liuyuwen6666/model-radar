# 官方大模型 ID 规范重构实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将雷达系统中的 OpenAI, Google, Anthropic, Qwen, Kimi 模型的 ID 重构规整为直接可调用的官方 API 参数 ID，并对历史快照进行一键无损迁移。

**架构：**
1. 依次修改 `scripts/providers/` 中的各爬虫文件的 ID 解析函数及 Fallback 数据。
2. 同步更新 `scripts/update.js` 中的默认蓝图配置。
3. 编写一键迁移脚本，对已有的 `models.json`、`sources.json` 和 `history/*.json` 快照数据进行 ID 及 `detailPath` 字段的批量转换。
4. 运行更新流水线，验证修改无误后清理测试文件与迁移脚本。

**技术栈：** Node.js / vanilla javascript / JSON

---

### 任务 1：修改各厂商抓取脚本 (Scrapers) 中的 ID 生成逻辑

**文件：**
- 修改：[openai.js](file:///d:/model-radar/scripts/providers/openai.js)
- 修改：[google.js](file:///d:/model-radar/scripts/providers/google.js)
- 修改：[anthropic.js](file:///d:/model-radar/scripts/providers/anthropic.js)
- 修改：[qwen.js](file:///d:/model-radar/scripts/providers/qwen.js)
- 修改：[kimi.js](file:///d:/model-radar/scripts/providers/kimi.js)

- [ ] **步骤 1：重构 `openai.js`，去除 `openai-` 前缀**
  修改 `parseTable` 中的 ID 拼装，移除 `openai-` 字符。
  例如将 `const modelId = 'openai-' + slugify(name);` 改为 `const modelId = slugify(name);`，并对其他 6 处含 `openai-` 的 ID 拼接进行同样的处理。

- [ ] **步骤 2：重构 `google.js`，去除 `google-` 前缀**
  修改 `google.js` 第 169 行的 `const modelId = 'google-' + slugify(code);` 为 `const modelId = slugify(code);`。

- [ ] **步骤 3：重构 `anthropic.js` 的 `MODEL_ID_MAP`**
  修改为以下内容：
  ```javascript
  const MODEL_ID_MAP = {
    opus: "claude-3-opus-20240229",
    sonnet: "claude-3-7-sonnet-20250219",
    haiku: "claude-3-5-haiku-20241022"
  };
  ```

- [ ] **步骤 4：重构 `qwen.js` 的 ID 解析与 Fallback 配置**
  1. 移除 `resolveModelId` 函数末尾的 `.replace(/\./g, "-")` 转换，直接保留点号返回：`return cleanId;`。
  2. 修改 `FALLBACK_QWEN_MODELS` 中的所有 ID，例如将 `"qwen3-7-max"` 改为 `"qwen3.7-max"`，含有 `qwen2-5-` 的改为 `qwen2.5-`。

- [ ] **步骤 5：重构 `kimi.js` 的 ID 解析与 Fallback 配置**
  1. 修改 `resolveModelId` 方法：
     ```javascript
     function resolveModelId(name) {
       const norm = name.toLowerCase();
       if (norm.includes("k2.6")) return "kimi-k2.6";
       if (norm.includes("k2.5")) return "kimi-k2.5";
       if (norm.includes("latest") || (norm.includes("v1-128k") && !norm.includes("vision"))) {
         return "moonshot-v1-128k";
       }
       const slug = norm.replace(/\./g, "_dot_").replace(/[^a-z0-9_]+/g, "-").replace(/_dot_/g, ".").replace(/^-+|-+$/g, "");
       if (slug.startsWith("moonshot-")) {
         return slug;
       }
       return `moonshot-${slug}`;
     }
     ```
  2. 修改 `FALLBACK_KIMI_MODELS`：将 `kimi-latest-128k` 替换为 `moonshot-v1-128k`。

---

### 任务 2：修改主更新脚本中的数据蓝图

**文件：**
- 修改：[update.js](file:///d:/model-radar/scripts/update.js)

- [ ] **步骤 1：同步重构 `update.js` 中的 `MODEL_BLUEPRINTS`**
  更新 `MODEL_BLUEPRINTS` 数组内各模型的 ID：
  - OpenAI / Google 模型：去除前缀。
  - Anthropic 模型：修改为具体带日期的 API 模型 ID（同 `anthropic.js`）。
  - Qwen 模型：改回带点号的 ID（如 `qwen3.7-max`）。
  - Kimi 模型：`kimi-k2-6` ➔ `kimi-k2.6`，`kimi-k2-5` ➔ `kimi-k2.5`，`kimi-latest-128k` ➔ `moonshot-v1-128k`。

---

### 任务 3：编写并执行数据迁移脚本

**文件：**
- 创建：`scripts/migrate-ids.js`
- 迁移覆盖：`data/models.json`
- 迁移覆盖：`data/sources.json`
- 迁移覆盖：`data/history/*.json`

- [ ] **步骤 1：编写数据迁移脚本**
  在 `scripts/migrate-ids.js` 中编写全量数据替换逻辑：
  - 定义正则/字符串映射，将旧 ID 转换为新 ID：
    - `openai-` 前缀移除。
    - `google-` 前缀移除。
    - `anthropic-claude-3-opus` ➔ `claude-3-opus-20240229`，`anthropic-claude-3-7-sonnet` ➔ `claude-3-7-sonnet-20250219`，`anthropic-claude-3-5-haiku` ➔ `claude-3-5-haiku-20241022`。
    - Qwen 模型的 ID 连字符还原为点号（如 `qwen2-5-` ➔ `qwen2.5-`，`qwen3-7-` ➔ `qwen3.7-`）。
    - Kimi 模型的 `kimi-moonshot-` ➔ `moonshot-`，`kimi-latest-128k` ➔ `moonshot-v1-128k`，`kimi-k2-6` ➔ `kimi-k2.6`，`kimi-k2-5` ➔ `kimi-k2.5`。
  - 支持对 `model.id` 和 `model.detailPath`（含 `/model/<id>`）的映射转换。
  - 支持对 `sources.json` 中各 provider 关联 models 列表的映射转换。
  - 遍历并重写 `data/history/` 目录下的所有快照文件。

- [ ] **步骤 2：执行迁移脚本并校验**
  运行：`node scripts/migrate-ids.js`
  预期：输出清晰的迁移统计日志，无运行错误。

---

### 任务 4：运行抓取验证与环境清理

- [ ] **步骤 1：运行爬虫拉取测试**
  运行：`$env:MODEL_RADAR_DATE="2026-06-11"; node scripts/update.js`
  预期：爬虫能成功请求并抓取，且写入的数据 ID 均采用规整后的新命名规范。

- [ ] **步骤 2：清理测试快照与临时迁移脚本**
  1. 运行：`rm data/history/2026-06-11.json`，撤销测试生成的快照文件，还原 `data/` 下的数据状态。
  2. 运行：`rm scripts/migrate-ids.js`，清理已运行完毕的临时脚本。
