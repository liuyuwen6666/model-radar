# 历史价格与模型变更（Changelog）全量重建 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修正 `scripts/diff.js` 的比对精度，并通过回溯所有的历史 snapshot 全量重建 `data/changelog.json`。

**架构：**
1. 修正 `scripts/diff.js` 的数值比对逻辑，使用 `roundValue` 对参与判断的价格进行精度规整。
2. 编写 `scripts/reconstruct-changelog.js` 脚本，将历史快照 `data/history/*.json` 从早到晚排序，进行 pairwise 比对计算差分。
3. 聚合所有变更并写回 `changelog.json`，清理临时脚本，校验并提交。

**技术栈：** Node.js, Git

---

### 任务 1：修正 `scripts/diff.js` 中的比对逻辑

**文件：**
- 修改：[scripts/diff.js](file:///d:/model-radar/scripts/diff.js)

- [ ] **步骤 1：修改 `describeChange` 函数预规整数值**
  在 `describeChange` 内进行全等判断前，使用 `roundValue` 对 previousValue 和 currentValue 规整：
  ```javascript
  const pVal = isNumber(previousValue) ? roundValue(previousValue) : previousValue;
  const cVal = isNumber(currentValue) ? roundValue(currentValue) : currentValue;
  ```

- [ ] **步骤 2：对 `makeEntry` 传入规整后的值**
  在调用 `makeEntry` 时，将原本的 `previousValue` 和 `currentValue` 字段传入修改后的 `pVal` 和 `cVal`。

---

### 任务 2：编写并运行 changelog 全量重建脚本

**文件：**
- 新增：[scripts/reconstruct-changelog.js](file:///d:/model-radar/scripts/reconstruct-changelog.js)
- 修改数据：[data/changelog.json](file:///d:/model-radar/data/changelog.json)

- [ ] **步骤 1：创建重建脚本 `scripts/reconstruct-changelog.js`**
  其核心逻辑需：
  1. 获取 `data/history/*.json` 下所有历史文件并按日期升序排序。
  2. 从第 2 个文件开始（`i = 1`），以 `i-1` 的快照作为 `previousDataset`，`i` 的快照作为 `currentDataset`。
  3. 调用 `collectChanges` 计算这一天发生的变更记录，日期取 `currentDataset.effectiveDate`。
  4. 将所有日期的 changes 合并，去重过滤并按日期降序（从新到老）排序。
  5. 重新计算 2026-06-11 当天的 `summary`，并把当天的记录写入 `latest`。
  6. 覆盖写入 `data/changelog.json`。

- [ ] **步骤 2：执行重建脚本**
  在终端中运行：
  `node scripts/reconstruct-changelog.js`

- [ ] **步骤 3：验证数据并物理删除重建脚本**
  确认新版 `changelog.json` 中完整记录了各时间节点的变化（如 6月10日 `claude-fable-5` 新增），确认无误后物理删除临时脚本。

---

### 任务 3：测试校验与数据提交

- [ ] **步骤 1：校验 git diff 状态**
  检查修改文件的 diff 是否仅包含精度规整改动和 changelog 的合理补全，无无关测试数据。

- [ ] **步骤 2：提交和推送**
  `git commit -am "fix(diff): improve diff precision and reconstruct full daily changelog history"`
  `git push`
