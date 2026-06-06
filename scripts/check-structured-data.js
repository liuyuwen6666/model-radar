/**
 * @file check-structured-data.js
 * 
 * @description
 * 【结构化数据与 SEO 校验脚本】
 * 本脚本用于校验项目中核心 HTML 模板文件（如 index.html 等）中嵌入的 JSON-LD 结构化数据是否合规。
 * 它可以防止不合规的 Schema 属性（例如在 AI 价格页面上误用零售商品的 Product 属性）导致 Google Search Console 报警或被搜索引擎惩罚。
 * 
 * @usage
 * 1. 本地手动校验：
 *    在修改 HTML 模版或更新 SEO 结构化数据后，在终端执行以下命令进行自检：
 *    $ npm run schema:check  (或直接执行: node scripts/check-structured-data.js)
 * 2. CI/CD 门禁（后续可扩展）：
 *    在 GitHub Action 或 Git 提交钩子（Husky）中集成该脚本，如果校验失败（进程退出码为 1），则阻止代码合并或部署。
 * 
 * @rules 校验规则：
 * 1. 语法正确性：提取所有 application/ld+json 脚本块并解析，确保符合标准 JSON 格式。
 * 2. 避免误判规则：禁止包含 Product 类型以及 offers, review, aggregateRating 等零售电商专用属性。
 * 3. 数据集规范：对于包含 Dataset 类型的条目，其 description（描述）字数必须在 50~5000 字符内，且不能包含 hasPart 属性。
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const HTML_FILES = [
  "index.html",
  "about.html",
  "history.html",
  "model.html",
  "compare.html",
  "rankings.html",
  "provider.html",
  "calculator.html",
  "data-schema.html",
  "api.html",
  "en.html"
];
const DATASET_DESCRIPTION_MIN_LENGTH = 50;
const DATASET_DESCRIPTION_MAX_LENGTH = 5000;
const FORBIDDEN_SOURCE_PATTERNS = [
  {
    pattern: /['"]@type['"]\s*:\s*['"]Product['"]/,
    message: "must not emit Product JSON-LD for model pricing pages"
  },
  {
    pattern: /\boffers\b\s*:/,
    message: "must not emit offers for AI model pricing data"
  },
  {
    pattern: /\breview\b\s*:/,
    message: "must not emit review for AI model pricing data"
  },
  {
    pattern: /\baggregateRating\b\s*:/,
    message: "must not emit aggregateRating for AI model pricing data"
  },
  {
    pattern: /\bhasPart\b\s*:/,
    message: "must not emit hasPart in Dataset JSON-LD"
  }
];

function getCharacterLength(value) {
  return Array.from(String(value || "")).length;
}

function collectJsonLdItems(value) {
  if (Array.isArray(value)) {
    return value.flatMap(collectJsonLdItems);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const graphItems = Array.isArray(value["@graph"]) ? value["@graph"] : [];
  return [value, ...graphItems.flatMap(collectJsonLdItems)];
}

function hasDatasetType(item) {
  const type = item?.["@type"];
  return Array.isArray(type) ? type.includes("Dataset") : type === "Dataset";
}

async function checkHtmlFile(fileName) {
  const filePath = path.join(ROOT_DIR, fileName);
  const html = await fs.readFile(filePath, "utf8");
  const errors = [];
  const scriptPattern = /<script\b([^>]*)type=["']application\/ld\+json["']([^>]*)>([\s\S]*?)<\/script>/gi;
  const idPattern = /\bid=["']([^"']+)["']/i;
  let match;
  let index = 0;

  for (const { pattern, message } of FORBIDDEN_SOURCE_PATTERNS) {
    if (pattern.test(html)) {
      errors.push(`${fileName}: ${message}`);
    }
  }

  while ((match = scriptPattern.exec(html))) {
    index += 1;
    const attributes = `${match[1] || ""} ${match[2] || ""}`;
    const scriptId = attributes.match(idPattern)?.[1] || `script #${index}`;
    const rawJson = match[3].trim();
    let parsed;

    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      errors.push(`${fileName} ${scriptId}: invalid JSON-LD (${error.message})`);
      return;
    }

    const datasets = collectJsonLdItems(parsed).filter(hasDatasetType);

    for (const dataset of datasets) {
      const length = getCharacterLength(dataset.description);

      if (
        length < DATASET_DESCRIPTION_MIN_LENGTH ||
        length > DATASET_DESCRIPTION_MAX_LENGTH
      ) {
        errors.push(
          `${fileName} ${scriptId}: Dataset.description length is ${length}, expected ${DATASET_DESCRIPTION_MIN_LENGTH}-${DATASET_DESCRIPTION_MAX_LENGTH}`
        );
      }

      if (Object.prototype.hasOwnProperty.call(dataset, "hasPart")) {
        errors.push(`${fileName} ${scriptId}: Dataset must not include hasPart`);
      }
    }
  }

  return errors;
}

async function main() {
  const errors = (await Promise.all(HTML_FILES.map(checkHtmlFile))).flat();

  if (errors.length) {
    for (const error of errors) {
      console.error(`[schema] ${error}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log("[schema] JSON-LD checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
