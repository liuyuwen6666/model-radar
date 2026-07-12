/**
 * @file check-structured-data.js
 * 
 * @description
 * 【结构化数据与 SEO 校验脚本】
 * 本脚本用于校验根目录静态 HTML 模版及 public/ 打包产物中的 JSON-LD 结构化数据。
 * 它会在构建阶段强制校验模型页面的 SoftwareApplication、BreadcrumbList 等关键 Schema 字段，
 * 若不满足，则会 Fail Build 阻断构建。
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
    message: "must not emit Product JSON-LD for non-model pages"
  },
  {
    pattern: /\boffers\b\s*:/,
    message: "must not emit offers for non-model pages"
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

async function findHtmlFilesRecursively(dir) {
  let results = [];
  try {
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const file of list) {
      const res = path.resolve(dir, file.name);
      if (file.isDirectory()) {
        results = results.concat(await findHtmlFilesRecursively(res));
      } else if (file.isFile() && file.name.endsWith(".html")) {
        results.push(res);
      }
    }
  } catch (e) {
    // If public/ is not built yet, skip gracefully
  }
  return results;
}

async function checkHtmlFile(filePath) {
  const relativePath = path.relative(ROOT_DIR, filePath);
  const html = await fs.readFile(filePath, "utf8");
  const errors = [];
  const scriptPattern = /<script\b([^>]*)type=["']application\/ld\+json["']([^>]*)>([\s\S]*?)<\/script>/gi;
  const idPattern = /\bid=["']([^"']+)["']/i;
  let match;
  let index = 0;

  const parts = relativePath.split(path.sep);
  const isModelDetail = parts.length === 4 && parts[0] === 'public' && parts[1] === 'model' && parts[3] === 'index.html';
  let hasSoftwareApplicationOrProduct = false;
  let hasBreadcrumb = false;

  // 1. 对于非模型详情页，执行黑名单规则匹配
  if (!isModelDetail) {
    for (const { pattern, message } of FORBIDDEN_SOURCE_PATTERNS) {
      if (pattern.test(html)) {
        errors.push(`${relativePath}: ${message}`);
      }
    }
  }

  // 2. 提取并解析 application/ld+json 脚本块
  while ((match = scriptPattern.exec(html))) {
    index += 1;
    const attributes = `${match[1] || ""} ${match[2] || ""}`;
    const scriptId = attributes.match(idPattern)?.[1] || `script #${index}`;
    const rawJson = match[3].trim();
    let parsed;

    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      errors.push(`${relativePath} ${scriptId}: invalid JSON-LD (${error.message})`);
      continue;
    }

    const items = collectJsonLdItems(parsed);

    // 校验 Dataset（适用于 Dataset 页面）
    const datasets = items.filter(hasDatasetType);
    for (const dataset of datasets) {
      const length = getCharacterLength(dataset.description);
      if (length < DATASET_DESCRIPTION_MIN_LENGTH || length > DATASET_DESCRIPTION_MAX_LENGTH) {
        errors.push(
          `${relativePath} ${scriptId}: Dataset.description length is ${length}, expected ${DATASET_DESCRIPTION_MIN_LENGTH}-${DATASET_DESCRIPTION_MAX_LENGTH}`
        );
      }
      if (Object.prototype.hasOwnProperty.call(dataset, "hasPart")) {
        errors.push(`${relativePath} ${scriptId}: Dataset must not include hasPart`);
      }
    }

    // 3. 大模型详情页专用 Schema 强校验
    if (isModelDetail) {
      const softwareApps = items.filter(
        item => item?.["@type"] === "SoftwareApplication" || item?.["@type"] === "Product"
      );
      const breadcrumbs = items.filter(item => item?.["@type"] === "BreadcrumbList");

      if (softwareApps.length > 0) {
        hasSoftwareApplicationOrProduct = true;
        for (const app of softwareApps) {
          if (!app.name || !app.name.trim()) {
            errors.push(`${relativePath} ${scriptId}: SoftwareApplication/Product name is missing or empty`);
          }
          if (!app.description || !app.description.trim()) {
            errors.push(`${relativePath} ${scriptId}: SoftwareApplication/Product description is missing or empty`);
          }
          if (!app.provider || typeof app.provider !== "object" || !app.provider.name) {
            errors.push(`${relativePath} ${scriptId}: SoftwareApplication/Product provider or provider.name is missing`);
          }
          if (!app.offers || typeof app.offers !== "object" || !app.offers.price || !app.offers.priceCurrency) {
            errors.push(`${relativePath} ${scriptId}: SoftwareApplication/Product offers or offers.price/priceCurrency is missing`);
          }
        }
      }

      if (breadcrumbs.length > 0) {
        hasBreadcrumb = true;
        for (const bc of breadcrumbs) {
          const list = bc.itemListElement;
          if (!Array.isArray(list) || list.length < 3) {
            errors.push(`${relativePath} ${scriptId}: BreadcrumbList itemListElement must be an array with at least 3 items`);
          } else {
            list.forEach((elem, idx) => {
              if (!elem.position || !elem.name || !elem.item) {
                errors.push(`${relativePath} ${scriptId}: Breadcrumb item at position ${idx + 1} is missing key attributes (position, name, item)`);
              }
            });
          }
        }
      }
    }
  }

  // 4. 强约束报错
  if (isModelDetail) {
    if (!hasSoftwareApplicationOrProduct) {
      errors.push(`${relativePath}: missing SoftwareApplication or Product JSON-LD schema`);
    }
    if (!hasBreadcrumb) {
      errors.push(`${relativePath}: missing BreadcrumbList JSON-LD schema`);
    }
  }

  return errors;
}

async function main() {
  const rootFiles = HTML_FILES.map(name => path.join(ROOT_DIR, name));
  const publicDir = path.join(ROOT_DIR, "public");
  const publicFiles = await findHtmlFilesRecursively(publicDir);
  const allFiles = [...rootFiles, ...publicFiles];

  const uniqueFiles = Array.from(new Set(allFiles));
  const errors = (await Promise.all(uniqueFiles.map(checkHtmlFile))).flat();

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
