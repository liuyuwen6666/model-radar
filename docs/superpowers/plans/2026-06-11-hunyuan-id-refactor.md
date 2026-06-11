# 腾讯混元与月之暗面模型数据精细化订正 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将腾讯混元 2.0 模型 ID 从连字符的形式替换为带有小数点的 API 官方原版形式，并对 models.json、2026-06-11.json 和 sitemap.xml 应用干净 Kimi 排序纠正。

**架构：** 
1. 编写精确的迁移 Node.js 脚本 `scripts/migrate-hunyuan.js` 自动对 models.json、sitemap.xml、2026-06-11.json 进行 Kimi 排序纠偏；同时全局替换 models.json、sources.json、sitemap.xml 和所有包含混元 2.0 模型的 history 日期文件中的 ID 与路径。
2. 更改混元 Scraper 逻辑及 update.js 中的元数据字段。
3. 运行并物理删除脚本，测试并推送。

**技术栈：** Node.js, Git

---

### 任务 1：修改腾讯混元 Scraper 逻辑

**文件：**
- 修改：[scripts/providers/hunyuan.js](file:///d:/model-radar/scripts/providers/hunyuan.js)

- [ ] **步骤 1：修改 `resolveModelId` 里的正则逻辑**
  在 `scripts/providers/hunyuan.js` 文件的 `resolveModelId` 函数中，将正则替换规则 `.replace(/[^a-z0-9]+/g, "-")` 修改为 `.replace(/[^a-z0-9.]+/g, "-")`。

- [ ] **步骤 2：更新 `FALLBACK_HUNYUAN_MODELS` 的模型 ID**
  将数组里所有 4 个混元 2.0 模型的 ID 进行更新：
  `hunyuan-2-0-think-32k` ➔ `hunyuan-2.0-think-32k`
  `hunyuan-2-0-think-128k` ➔ `hunyuan-2.0-think-128k`
  `hunyuan-2-0-instruct-32k` ➔ `hunyuan-2.0-instruct-32k`
  `hunyuan-2-0-instruct-128k` ➔ `hunyuan-2.0-instruct-128k`

---

### 任务 2：修改主更新脚本中的静态配置

**文件：**
- 修改：[scripts/update.js](file:///d:/model-radar/scripts/update.js)

- [ ] **步骤 1：修改 `staticModels` 配置中混元的模型 ID 与详情路径**
  * `hunyuan-2-0-think-32k` ➔ `hunyuan-2.0-think-32k` 且 `detailPath` 为 `/model/hunyuan-2.0-think-32k`
  * `hunyuan-2-0-think-128k` ➔ `hunyuan-2.0-think-128k` 且 `detailPath` 为 `/model/hunyuan-2.0-think-128k`
  * `hunyuan-2-0-instruct-32k` ➔ `hunyuan-2.0-instruct-32k` 且 `detailPath` 为 `/model/hunyuan-2.0-instruct-32k`
  * `hunyuan-2-0-instruct-128k` ➔ `hunyuan-2.0-instruct-128k` 且 `detailPath` 为 `/model/hunyuan-2.0-instruct-128k`

---

### 任务 3：编写并执行数据订正迁移脚本

**文件：**
- 新增：[scripts/migrate-hunyuan.js](file:///d:/model-radar/scripts/migrate-hunyuan.js)
- 修改数据：所有 data 下的文件以及 sitemap.xml

- [ ] **步骤 1：创建迁移脚本 `scripts/migrate-hunyuan.js`**
  其核心逻辑包含：
  1. 获取 `data/history/*.json` 下所有文件及 `data/models.json`。
  2. 订正 `data/models.json` 和 `data/history/2026-06-11.json` 中的 Kimi 模型顺序（`kimi-k2.6` 放在 `kimi-k2.5` 之前，并将月之暗面模型按标准顺序放置）。
  3. 对于 `models.json`、`sources.json` 以及所有 history 快照，查找 `hunyuan-2-0-think-32k`、`hunyuan-2-0-think-128k` 、`hunyuan-2-0-instruct-32k`、`hunyuan-2-0-instruct-128k` 并替换其 ID、family、detailPath 以及 sources.json 下的引用。
  4. 修改 `sitemap.xml`：更正 Kimi 的顺序，同时将混元模型的 loc 替换为 `-2.0-` 形式。
  5. 覆盖写回原文件。

- [ ] **步骤 2：执行迁移脚本**
  在终端中运行：
  `node scripts/migrate-hunyuan.js`

- [ ] **步骤 3：验证数据并删除迁移脚本**
  使用验证脚本检查数据，确认无误后通过物理删除临时脚本。

---

### 任务 4：数据有效性与完整性校验

- [ ] **步骤 1：运行 Kimi/混元抓取测试**
  运行：
  `node scripts/update.js` （临时生成），检查终端输出的合并是否完全对应。
  检查完后，务必运行：
  `git restore data/models.json data/history/2026-06-11.json sitemap.xml`
  撤销测试带来的冗余脏变化。

- [ ] **步骤 2：检查 ID 替换是否完整**
  在控制台运行 grep 查询，确认没有残留的 `hunyuan-2-0-` 形式 ID：
  `git diff` 验证被修改文件的内容完全纯净。

- [ ] **步骤 3：提交和推送**
  `git commit -am "fix(hunyuan,kimi): update Hunyuan model IDs to keep decimal version and clean Kimi ordering"`
  `git push`
