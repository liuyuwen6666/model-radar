# 阿里通义（Qwen）模型 ID 数据订正 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 全局纠正阿里通义 Qwen 3 错误的点号 ID，并对 models.json 及历史快照进行去重合并以保证数据一致性。

**架构：**
1. 编写精确的迁移脚本 `scripts/migrate-qwen.js`，该脚本将遍历 models.json、sources.json、sitemap.xml 和所有历史快照 JSON。
2. 脚本对所有的 Qwen 3 模型 ID 进行精准映射规整，在映射后，如果存在 ID 相同的模型对象，则优先保留 `status: 'live'` 的活跃对象，以自动剔除多余的遗留归档记录。
3. 执行并清理脚本，做 grep 检索和 scraper 合并测试。

**技术栈：** Node.js, Git

---

### 任务 1：编写并执行 Qwen 数据订正迁移脚本

**文件：**
- 新增：[scripts/migrate-qwen.js](file:///d:/model-radar/scripts/migrate-qwen.js)
- 修改数据：data 下所有相关文件、sitemap.xml

- [ ] **步骤 1：创建迁移脚本 `scripts/migrate-qwen.js`**
  核心迁移逻辑：
  1. 读取 `MODELS_FILE`、`SOURCES_FILE`、`SITEMAP_FILE` 和 `data/history/*.json` 下的所有快照。
  2. 根据映射表，转换通义千问模型 ID（包括 `id`、`family`、`detailPath` 字段）：
     * `qwen3.235b-a22b` ➔ `qwen3-235b-a22b`
     * `qwen3.32b` ➔ `qwen3-32b`
     * `qwen3.30b-a3b` ➔ `qwen3-30b-a3b`
     * `qwen3.14b` ➔ `qwen3-14b`
     * `qwen3.8b` ➔ `qwen3-8b`
     * `qwen3.4b` ➔ `qwen3-4b`
     * `qwen3.1-7b` ➔ `qwen3-1.7b`
     * `qwen3.0-6b` ➔ `qwen3-0.6b`
  3. **合并去重**：更新完 ID 后，在 `models` 数组中查找重复 of 的 ID。只要同一个 ID 对应的多个记录中有一个是 `live` 状态，就保留 `live` 版本并移除 `legacy` 版本。
  4. 覆盖写入所有 JSON 文件与 sitemap.xml 文件。

- [ ] **步骤 2：执行迁移脚本**
  在控制台运行：
  `node scripts/migrate-qwen.js`

- [ ] **步骤 3：验证数据并删除迁移脚本**
  校验去重和 ID 替换的正确性，然后物理删除临时脚本。

---

### 任务 2：数据有效性与完整性校验

- [ ] **步骤 1：校验 ID 是否有残留**
  在控制台运行 grep 全局查询旧版 ID：
  确认只在文档中出现，在 JSON/XML/JS 代码中均无残留。

- [ ] **步骤 2：运行 Qwen 抓取测试并撤销脏数据**
  运行：
  `$env:MODEL_RADAR_DATE="2026-06-11"; node scripts/update.js`
  确认通义千问模型顺序和状态正确。
  测试完后，运行 `git restore` 恢复现场，不留测试脏数据。

- [ ] **步骤 3：提交和推送**
  `git commit -am "fix(qwen): refactor Qwen3 dotted model IDs to keep consistent naming and remove duplicates"`
  `git push`
