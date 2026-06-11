const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = process.env.MODEL_RADAR_DATA_DIR
  ? path.resolve(ROOT_DIR, process.env.MODEL_RADAR_DATA_DIR)
  : path.join(ROOT_DIR, "data");
const CACHE_DIR = process.env.MODEL_RADAR_CACHE_DIR
  ? path.resolve(ROOT_DIR, process.env.MODEL_RADAR_CACHE_DIR)
  : path.join(ROOT_DIR, ".cache");

const MODELS_PATH = path.join(DATA_DIR, "models.json");
const CHANGELOG_PATH = path.join(DATA_DIR, "changelog.json");
const PREVIOUS_MODELS_PATH = path.join(CACHE_DIR, "models.previous.json");

const FIELD_LABELS = {
  inputPricePer1M: "输入价 / 1M tokens",
  outputPricePer1M: "输出价 / 1M tokens",
  cacheWritePricePer1M: "缓存写价 / 1M tokens",
  cacheReadPricePer1M: "缓存读价 / 1M tokens",
  inputPriceUsdPer1M: "输入价 / 1M tokens",
  outputPriceUsdPer1M: "输出价 / 1M tokens",
  cacheWritePriceUsdPer1M: "缓存写价 / 1M tokens",
  cacheReadPriceUsdPer1M: "缓存读价 / 1M tokens"
};

const CNY_PRICE_FIELDS = [
  "inputPricePer1M",
  "outputPricePer1M",
  "cacheWritePricePer1M",
  "cacheReadPricePer1M"
];

const USD_PRICE_FIELDS = [
  "inputPriceUsdPer1M",
  "outputPriceUsdPer1M",
  "cacheWritePriceUsdPer1M",
  "cacheReadPriceUsdPer1M"
];

function getFieldCurrency(field) {
  return field.includes("Usd") ? "USD" : "CNY";
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function roundValue(value) {
  return Math.round(value * 1000000) / 1000000;
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function formatPrice(value, currency) {
  if (!isNumber(value)) {
    return "N/A";
  }

  let formatted;
  if (value < 1) {
    formatted = value.toFixed(6).replace(/\.?0+$/, "");
  } else {
    formatted = value.toFixed(2);
  }

  const symbol = currency === "CNY" ? "¥" : "$";
  return `${symbol}${formatted}`;
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

function indexById(dataset) {
  const models = Array.isArray(dataset?.models) ? dataset.models : [];
  return new Map(models.map((model) => [model.id, model]));
}

function buildSummary(entries) {
  return {
    totalChanges: entries.length,
    priceIncreaseCount: entries.filter((entry) => entry.type === "price_increase").length,
    priceDecreaseCount: entries.filter((entry) => entry.type === "price_decrease").length,
    pricingAddedCount: entries.filter((entry) => entry.type === "pricing_added").length,
    pricingRemovedCount: entries.filter((entry) => entry.type === "pricing_removed").length,
    newModelCount: entries.filter((entry) => entry.type === "new_model").length,
    removedModelCount: entries.filter((entry) => entry.type === "removed_model").length
  };
}

function makeEntry({
  date,
  model,
  field,
  type,
  previousValue,
  currentValue,
  summary,
  currency
}) {
  let delta = null;
  let deltaPercent = null;

  if (isNumber(previousValue) && isNumber(currentValue)) {
    delta = roundValue(currentValue - previousValue);

    if (previousValue !== 0) {
      deltaPercent = roundPercent(((currentValue - previousValue) / previousValue) * 100);
    }
  }

  return {
    id: `${date}:${model.id}:${field}:${type}`,
    date,
    modelId: model.id,
    modelName: model.name,
    provider: model.provider,
    field,
    fieldLabel: FIELD_LABELS[field] || field,
    type,
    previousValue,
    currentValue,
    delta,
    deltaPercent,
    summary,
    currency,
    sourceUrl: model.sourceUrl || "",
    sourceType: model.sourceType || "fallback"
  };
}

function describeChange(model, field, previousValue, currentValue) {
  const label = FIELD_LABELS[field] || field;
  const currency = getFieldCurrency(field);

  const pVal = isNumber(previousValue) ? roundValue(previousValue) : previousValue;
  const cVal = isNumber(currentValue) ? roundValue(currentValue) : currentValue;

  if (!isNumber(pVal) && isNumber(cVal)) {
    return makeEntry({
      date: model.updatedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      model,
      field,
      type: "pricing_added",
      previousValue: pVal,
      currentValue: cVal,
      summary: `${model.name} 新增 ${label} 字段。`,
      currency
    });
  }

  if (isNumber(pVal) && !isNumber(cVal)) {
    return makeEntry({
      date: model.updatedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      model,
      field,
      type: "pricing_removed",
      previousValue: pVal,
      currentValue: cVal,
      summary: `${model.name} 移除了 ${label} 字段。`,
      currency
    });
  }

  if (!isNumber(pVal) || !isNumber(cVal) || pVal === cVal) {
    return null;
  }

  const type = cVal > pVal ? "price_increase" : "price_decrease";
  const verb = type === "price_increase" ? "上调" : "下调";

  return makeEntry({
    date: model.updatedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    model,
    field,
    type,
    previousValue: pVal,
    currentValue: cVal,
    summary: `${model.name} ${label} ${verb}至 ${formatPrice(cVal, currency)}。`,
    currency
  });
}

function collectChanges(previousDataset, currentDataset) {
  const previousMap = indexById(previousDataset);
  const currentMap = indexById(currentDataset);
  const currentDate = currentDataset?.effectiveDate || new Date().toISOString().slice(0, 10);
  const entries = [];

  for (const model of currentMap.values()) {
    if (!previousMap.has(model.id)) {
      const modelCurrency = model.currency || "USD";
      entries.push(
        makeEntry({
          date: currentDate,
          model,
          field: "model",
          type: "new_model",
          previousValue: null,
          currentValue: model.name,
          summary: `新增模型 ${model.name}。`,
          currency: modelCurrency
        })
      );
      continue;
    }

    const previousModel = previousMap.get(model.id);

    const fieldsToCompare = [];
    const isCny = model.currency === "CNY";
    const isUsd = model.currency === "USD" || !model.currency;
    const hasDual = model.hasOfficialDualCurrency === true;

    if (isCny) {
      fieldsToCompare.push(...CNY_PRICE_FIELDS);
    }
    if (isUsd || hasDual) {
      fieldsToCompare.push(...USD_PRICE_FIELDS);
    }

    for (const field of fieldsToCompare) {
      const change = describeChange(
        { ...model, updatedAt: buildTimestamp(currentDate) },
        field,
        previousModel[field],
        model[field]
      );

      if (change) {
        entries.push(change);
      }
    }
  }

  for (const previousModel of previousMap.values()) {
    if (currentMap.has(previousModel.id)) {
      continue;
    }

    const modelCurrency = previousModel.currency || "USD";
    entries.push(
      makeEntry({
        date: currentDate,
        model: previousModel,
        field: "model",
        type: "removed_model",
        previousValue: previousModel.name,
        currentValue: null,
        summary: `模型 ${previousModel.name} 已从追踪列表移除。`,
        currency: modelCurrency
      })
    );
  }

  return entries.sort((left, right) => left.modelName.localeCompare(right.modelName, "zh-CN"));
}

function buildTimestamp(dateStamp) {
  return `${dateStamp}T00:00:00.000Z`;
}

function mergeHistory(existingHistory, latestEntries) {
  const map = new Map();

  for (const entry of [...latestEntries, ...(Array.isArray(existingHistory) ? existingHistory : [])]) {
    if (!map.has(entry.id)) {
      map.set(entry.id, entry);
    }
  }

  return Array.from(map.values());
}

async function writeJson(filePath, value) {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, stableJson(value), "utf8");
}

async function main() {
  const currentDataset = await readJson(MODELS_PATH, null);
  const previousDataset = await readJson(PREVIOUS_MODELS_PATH, { models: [] });
  const existingChangelog = await readJson(CHANGELOG_PATH, null);

  if (!currentDataset || !Array.isArray(currentDataset.models)) {
    throw new Error("data/models.json is missing or invalid.");
  }

  const latestEntries = collectChanges(previousDataset, currentDataset);

  if (
    latestEntries.length === 0 &&
    existingChangelog &&
    existingChangelog.effectiveDate === currentDataset.effectiveDate
  ) {
    console.log(`No new changelog entries for ${currentDataset.effectiveDate}`);
    return;
  }

  const nextChangelog = {
    schemaVersion: 1,
    generatedAt: currentDataset.generatedAt || buildTimestamp(currentDataset.effectiveDate),
    effectiveDate: currentDataset.effectiveDate,
    summary: buildSummary(latestEntries),
    latest: latestEntries,
    history: mergeHistory(existingChangelog?.history, latestEntries)
  };

  const nextContent = stableJson(nextChangelog);
  const previousContent = existingChangelog ? stableJson(existingChangelog) : null;

  if (nextContent === previousContent) {
    console.log(`changelog.json already up to date for ${currentDataset.effectiveDate}`);
    return;
  }

  await writeJson(CHANGELOG_PATH, nextChangelog);
  console.log(`Generated ${latestEntries.length} changelog entries`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
