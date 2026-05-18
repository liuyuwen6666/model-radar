const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const HTML_FILES = [
  "index.html",
  "history.html",
  "model.html",
  "rankings.html",
  "compare.html"
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
