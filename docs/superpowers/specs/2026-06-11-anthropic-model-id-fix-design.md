# Anthropic 模型 ID 规范修正设计规约

## 1. 目标描述
为了使大模型价格雷达（ModelRadar）中的 Anthropic 模型 ID 更加完整且符合官方 API 调用规范，并彻底保障历史数据的 100% 准确性，需要对此前的抓取及数据迁移逻辑进行重构。

新规约的主要目标包括：
1. **抓取完整性**：废除硬编码的限制，能够动态抓取官网价格页上的所有 Anthropic 模型（如 Fable 5, Opus 4.8, Sonnet 4.6, Haiku 4.5, 以及所有历史列出的如 Opus 4.7, Sonnet 4 等）。
2. **规范化 ID**：将抓取到的模型 ID 转换为配置 API key 后能直接使用的官方标识符，格式如 `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` 等。
3. **数据与变更历史一致性**：
   - 修正已有的静态数据库 `models.json`、数据源配置 `sources.json`。
   - 对 `data/history/*.json` 下所有历史快照数据进行修正，特别是针对已保存了 raw HTML 快照的日期（如 5月30日至今），通过对应的 HTML 文件重做高精确度的解析，补齐遗漏模型；未保存 raw HTML 的日期，则物理映射其 ID 字段。
   - 检查并补全 `data/changelog.json`。由于 `Fable 5` 在 2026-06-10 的 raw HTML 中首次出现，因此在 `changelog.json` 中必须补齐一条在 `2026-06-10` 日新增该模型的历史变更记录；同时，将 changelog 中以往留存的旧 ID（如带有厂商前缀的 ID）统一纠正。

## 2. 映射规则定义

### 2.1 动态 ID 生成规则
对抓取到的每个模型标题（如 `Fable 5`, `Opus 4.8`, `Haiku 4.5` 等）：
1. 提取模型家族（`Family`，如 `fable`, `opus`, `sonnet`, `haiku` 等）以及版本号（`Version`，如 `5`, `4.8`, `4.6`, `4.5` 等）。
2. 常规生成公式：`claude-${family}-${version}`，其中 `version` 中的点号（`.`）替换为短横线（`-`），字母转换为全小写。
3. 特殊例外映射：
   - 如果生成的常规 ID 为 `claude-haiku-4-5`，则需加上特定日期后缀，转换为 `claude-haiku-4-5-20251001`。

### 2.2 具体模型映射示例
- `Fable 5` ➔ `claude-fable-5`
- `Opus 4.8` ➔ `claude-opus-4-8`
- `Sonnet 4.6` ➔ `claude-sonnet-4-6`
- `Haiku 4.5` ➔ `claude-haiku-4-5-20251001`
- `Opus 4.7` ➔ `claude-opus-4-7`
- `Sonnet 4.5` ➔ `claude-sonnet-4-5`
- `Opus 4` ➔ `claude-opus-4`

## 3. 改造范围与实现

### 3.1 Scraper 脚本改造 (`scripts/providers/anthropic.js`)
- 废弃 `MODEL_ID_MAP`。
- 修改 `resolveModelIdentity` 逻辑，使用正则匹配 `\b(fable|opus|sonnet|haiku)\b` 并解析提取版本号，按 **2.1** 中的动态规则拼装出官方 ID。

### 3.2 蓝图数据改造 (`scripts/update.js`)
- 将 `MODEL_BLUEPRINTS` 中的三个 Anthropic 蓝图项的 `id` 和 `detailPath` 更新为：
  - 旧 `claude-3-opus-20240229` (名称 "Claude Opus 4.7") ➔ 新 `claude-opus-4-8` (名称更新为 "Claude Opus 4.8")，`detailPath` ➔ `/model/claude-opus-4-8`
  - 旧 `claude-3-7-sonnet-20250219` (名称 "Claude Sonnet 4.6") ➔ 新 `claude-sonnet-4-6`，`detailPath` ➔ `/model/claude-sonnet-4-6`
  - 旧 `claude-3-5-haiku-20241022` (名称 "Claude Haiku 4.5") ➔ 新 `claude-haiku-4-5-20251001`，`detailPath` ➔ `/model/claude-haiku-4-5-20251001`

### 3.3 数据迁移与补齐脚本 (`scripts/migrate-anthropic.js`)
- 编写一键迁移与数据修复脚本：
  1. **修正/补齐历史快照**：
     - 遍历所有 `data/history/YYYY-MM-DD.json` 文件。
     - 若该日期有对应的 `raw/anthropic/YYYY/MM/DD.html` 文件，则利用新的 `anthropic.js` 逻辑从 HTML 重新解析出完整的 10-11 个模型数据，继承原有的元数据（详情页路径、描述等），然后覆盖更新当天的模型数组。
     - 若该日期没有对应的 raw HTML 文件（主要是 2026-05-30 之前），则将其原有的 Anthropic 模型 ID 和 detailPath 按照旧 ID 到新 ID 的映射进行常规字符替换（如 `claude-3-opus-20240229` ➔ `claude-opus-4-7`，因为当时在 5月中旬它的名称是 "Claude Opus 4.7"）。
  2. **同步更新 models.json**：
     - 使用同样逻辑将最新的 Anthropic 11 个模型数据更新至 `data/models.json`。
  3. **同步更新 sources.json**：
     - 更新 `Anthropic` 条目下的模型 ID 列表为最新的 11 个模型。
  4. **补全与修改 changelog.json**：
     - 物理增加 `2026-06-10` 新增 `claude-fable-5` 模型（名称 "Claude Fable 5"）的变更记录，其 `type` 为 `new_model`。
     - 扫描整个 `changelog.json` 中的历史条目，将里面的旧 ID（包括其他厂商的如带有 `google-` 前缀的 `google-gemini-3-5-live-translate-preview` ➔ `gemini-3-5-live-translate-preview`，旧 Anthropic 关联 ID ➔ 新 ID）全部更新一致。

## 4. 验证计划
1. 运行迁移脚本 `node scripts/migrate-anthropic.js` 并打印日志。
2. 运行 `git diff` 验证数据修正的准确性，确保历史数据补齐且只更改了必要的字段。
3. 运行本地抓取流程 `$env:MODEL_RADAR_DATE="2026-06-11"; node scripts/update.js`，观察是否能正常并发抓取所有 11 个 Anthropic 模型且合并写入无报错。
4. 验证完成后，撤销测试生成的当天历史数据快照和修改，删除迁移脚本。
