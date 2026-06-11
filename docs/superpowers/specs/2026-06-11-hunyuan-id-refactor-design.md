# 腾讯混元与月之暗面模型数据精细化订正设计规约

本文档说明如何将腾讯混元 2.0 模型 ID 从 `hunyuan-2-0-*` 订正为 `hunyuan-2.0-*`，以及规范化月之暗面（Kimi）模型的排序，同时彻底洗净网络抓取产生的历史脏数据。

## 变更背景
1. 腾讯混元 2.0 模型的官方 API 调用名中间版本号使用小点 `.`（如 `hunyuan-2.0-thinking-20251109`），但本地原解析逻辑将其误转换为连字符 `-`（如 `hunyuan-2-0-think-32k`）。需要统一订正为小点 `.`（如 `hunyuan-2.0-think-32k`）。
2. 月之暗面（Kimi）模型的顺序应为 `kimi-k2.6` -> `kimi-k2.5` -> `moonshot-v1` 序列。此前本地通过抓取测试生成的 `data/models.json` 和 `sitemap.xml` 等文件包含大量由于抓取产生的冗余 `pricingNotes` 脏增量，需要进行干净地还原及局部纠偏。

## 设计目标
1. 修改抓取组件中腾讯混元的 ID 解析正则表达式，使其保留版本号中的小数点，并修正其静态兜底数据。
2. 修复 `scripts/update.js` 中静态元数据配置中的混元 ID 与 detailPath。
3. 还原 `data/models.json`、`data/history/2026-06-11.json`、`sitemap.xml` 上的脏抓取结果。
4. 编写专用的迁移修复脚本 `scripts/migrate-hunyuan.js`，独立对上述被还原的三个文件进行干净的 Kimi 排序纠偏，并对所有历史 snapshot 和最新配置文件的混元 ID 实施精准迁移，保证没有任何其它无关变动被带入仓库。
5. 验证模型在所有快照中的一致性。

## 修改范围

### 1. 代码改动
* **[scripts/providers/hunyuan.js](file:///d:/model-radar/scripts/providers/hunyuan.js)**:
  * 正则替换由 `.replace(/[^a-z0-9]+/g, "-")` 修改为 `.replace(/[^a-z0-9.]+/g, "-")`，允许保留 `.`。
  * `FALLBACK_HUNYUAN_MODELS` 的大模型 ID 换成 `-2.0-` 形式。
* **[scripts/update.js](file:///d:/model-radar/scripts/update.js)**:
  * `staticModels` 中的混元 2.0 模型 ID 和 `detailPath` 换成 `-2.0-` 形式。

### 2. 数据与站点地图订正
由迁移脚本自动处理：
* 混元 2.0 相关模型 ID 的替换范围：
  * `data/models.json`
  * `data/sources.json`
  * `sitemap.xml`
  * `data/history/*.json` （2026-05-24 到 2026-06-11 的所有包含混元 2.0 模型的历史文件）
  涉及字段：`id`、`family`、`detailPath` 链接、以及 sources.json 和 sitemap 中的指向。
* Kimi 模型顺序订正范围：
  * `data/models.json`
  * `data/history/2026-06-11.json`
  * `sitemap.xml`

## 验证计划
1. 使用抓取测试运行验证混元和 Kimi 的最新输出。
2. 运行 `inspect-kimi.js` 检查 Kimi 模型在所有历史快照和 models.json 中的顺序。
3. 检查 git status 和 diff 确保没有任何 `pricingNotes` 重复累加的脏数据。
