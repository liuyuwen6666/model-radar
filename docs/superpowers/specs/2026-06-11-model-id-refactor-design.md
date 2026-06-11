# 官方大模型 ID 规范重构设计规约

## 1. 目标描述
为了使大模型价格雷达（ModelRadar）中的模型 ID 与各大主流 AI 厂商官方 API 传入的调用参数完全保持一致，本设计规约定义了模型 ID 重构规范。配置好各家厂商的 API Key 后，雷达系统中的 `id` 字段值能直接用于 API 请求参数。

此重构涵盖抓取脚本、主控制脚本、静态数据库、数据源配置以及全部历史快照文件。

## 2. 映射规范定义

### 2.1 OpenAI
- 规则：物理去除 `openai-` 前缀。
- 旧 ID 示例 ➔ 官方 ID 示例：
  - `openai-gpt-4o` ➔ `gpt-4o`
  - `openai-gpt-4o-mini` ➔ `gpt-4o-mini`
  - `openai-o3-mini` ➔ `o3-mini`
  - `openai-gpt-5.5` ➔ `gpt-5.5`

### 2.2 Google
- 规则：物理去除 `google-` 前缀。
- 旧 ID 示例 ➔ 官方 ID 示例：
  - `google-gemini-2.5-flash` ➔ `gemini-2.5-flash`
  - `google-gemini-2.5-pro` ➔ `gemini-2.5-pro`
  - `google-gemma-4` ➔ `gemma-4`

### 2.3 Anthropic
- 规则：去除 `anthropic-` 前缀，并映射到官方具体的 API 版本。
- 映射对应表：
  - `anthropic-claude-3-opus` ➔ `claude-3-opus-20240229`
  - `anthropic-claude-3-7-sonnet` ➔ `claude-3-7-sonnet-20250219`
  - `anthropic-claude-3-5-haiku` ➔ `claude-3-5-haiku-20241022`

### 2.4 DeepSeek
- 规则：保持 `deepseek-v4-flash` 和 `deepseek-v4-pro`，无需进行变更。


### 2.5 阿里通义 (Qwen)
- 规则：保留点号（`.`），不再将其转换为短横线（`-`），保持与官方灵积平台（DashScope）API 的请求字符串 100% 一致。
- 映射对应表：
  - `qwen2-5-72b-instruct` ➔ `qwen2.5-72b-instruct`
  - `qwen3-7-max` ➔ `qwen3.7-max`
  - `qwen3-7-max-preview` ➔ `qwen3.7-max-preview`
  - `qwen3-6-max-preview` ➔ `qwen3.6-max-preview`
  - `qwen3-7-plus` ➔ `qwen3.7-plus`
  - `qwen3-6-plus` ➔ `qwen3.6-plus`
  - `qwen3-5-plus` ➔ `qwen3.5-plus`
  - `qwen3-6-flash` ➔ `qwen3.6-flash`
  - `qwen3-5-flash` ➔ `qwen3.5-flash`
  - `qwen3-5-omni-plus` ➔ `qwen3.5-omni-plus`
  - `qwen3-5-omni-flash` ➔ `qwen3.5-omni-flash`
  - 其余带有 `qwen2-5-` 前缀的模型全部转回 `qwen2.5-`。

### 2.6 月之暗面 (Kimi)
- 规则：统一去除多加的前缀，将旧映射修正为真正的 `moonshot-` 官方接口 ID。官方原本就以 `kimi-` 开头的保留。
- 映射对应表：
  - `kimi-moonshot-v1-8k` ➔ `moonshot-v1-8k`
  - `kimi-moonshot-v1-32k` ➔ `moonshot-v1-32k`
  - `kimi-moonshot-v1-8k-vision-preview` ➔ `moonshot-v1-8k-vision-preview`
  - `kimi-moonshot-v1-32k-vision-preview` ➔ `moonshot-v1-32k-vision-preview`
  - `kimi-moonshot-v1-128k-vision-preview` ➔ `moonshot-v1-128k-vision-preview`
  - `kimi-latest-128k` ➔ `moonshot-v1-128k`
  - `kimi-k2.5` ➔ `kimi-k2.5` (官方 API 称呼本身为 `kimi-k2.5`，不做规整)
  - `kimi-k2.6` ➔ `kimi-k2.6` (官方 API 称呼本身为 `kimi-k2.6` ,不做规整)

### 2.7 腾讯混元 与 字节豆包
- 腾讯混元：`hunyuan-2-0-think-32k`、`hunyuan-t1` 等可以直接用于腾讯云 API 接口，保持现状。
- 字节豆包：应用户明确要求，保持现状。

---

## 3. 实现细节

### 3.1 爬虫模块重构
1. **`scripts/providers/openai.js`**
   - 移除拼装中的 `openai-` 前缀。
2. **`scripts/providers/google.js`**
   - 移除拼装中的 `google-` 前缀。
3. **`scripts/providers/anthropic.js`**
   - 修改 `MODEL_ID_MAP` 使其映射值对应 `claude-3-opus-20240229`、`claude-3-7-sonnet-20250219`、`claude-3-5-haiku-20241022`。
4. **`scripts/providers/deepseek.js`**
   - 保持现状，无需修改。

5. **`scripts/providers/qwen.js`**
   - 移除 `resolveModelId` 中点号转连字符的逻辑，并在 `FALLBACK_QWEN_MODELS` 中将点号换回。
6. **`scripts/providers/kimi.js`**
   - 修改 `resolveModelId` 将 `kimi-latest-128k` 解析为 `moonshot-v1-128k`；且不为 `moonshot-` 字符加 `kimi-` 前缀。修改 `FALLBACK_KIMI_MODELS`。

### 3.2 控制脚本重构
- **`scripts/update.js`**
  - 修改 `MODEL_BLUEPRINTS` 默认蓝图数组中的所有模型 ID。

### 3.3 一键迁移脚本
- 编写一键迁移脚本 `scripts/migrate-ids.js`，批量处理 `data/models.json`、`data/sources.json` 和 `data/history/*.json` 内的 ID，更新 `detailPath` 及 `sources.json` 内部的模型关联。

## 4. 验证计划
1. 运行 `scripts/migrate-ids.js` 一键迁移数据并查看输出日志是否正确。
2. 运行 `git diff` 验证数据迁移是否符合映射表。
3. 运行抓取更新测试（如通过命令 `$env:MODEL_RADAR_DATE="2026-06-11"; node scripts/update.js`），验证数据合并逻辑正常、排序正确且无报错，最后撤销生成的临时测试数据。
