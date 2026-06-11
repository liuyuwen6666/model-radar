# 历史价格与模型变更（Changelog）全量重建设计规约

本文档说明如何修正 `scripts/diff.js` 中浮点数精度带来的比对噪音，并通过回溯所有的历史 snapshot 全量重建 `data/changelog.json`。

## 变更背景
1. 数据站当前 `changelog.json` 里的历史变更大量遗失，仅存近期的 3 条模型新增记录。
2. 之前的 `diff.js` 在进行价格对比时未做高精度规整，易受美元折算浮点数微小变动或历史数据精度补全等噪声干扰，产生不准确的价格波动日志。

## 设计目标
1. 修改 `scripts/diff.js` 的 `describeChange` 函数，使参与比对的数值都先经过 `roundValue`（6位高精度四舍五入）规整，过滤无实际意义的浮点精度变动。
2. 编写重建脚本 `scripts/reconstruct-changelog.js`，按时间升序对比 `data/history/*.json` 下所有 28 个历史快照，重新计算并完整找回历史上所有的模型变动及价格变动记录，写回 `changelog.json`。
3. 验证数据站的变更历史纯净且无遗漏。

## 修改范围

### 1. 代码改动
* **[scripts/diff.js](file:///d:/model-radar/scripts/diff.js)**:
  * 引入 `pVal` 和 `cVal` 并在对比前执行 `roundValue`。
  * 将 `makeEntry` 里的 previousValue 和 currentValue 替换为规整后的值。

### 2. 数据与记录重建
由回溯重建脚本处理：
* 遍历所有的历史快照文件进行 pairwise 比较，提取每日发生的 changes。
* 重新构造 `data/changelog.json`：
  - `latest`：填入 2026-06-11 当天的变化。
  - `summary`：重新计算 2026-06-11 变动的统计信息。
  - `history`：按时间从新到老的顺序汇总历史上所有的变化记录。

## 验证计划
1. 运行重建脚本，观察终端输出的重建变动总数。
2. 查看 `data/changelog.json` 内容，确保时间线完整无缺失（如包含 `claude-fable-5` 等模型新增事件）。
3. 检查 git diff，确认没有引入任何不相关的测试脏数据。
