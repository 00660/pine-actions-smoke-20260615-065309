#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { kconfigMissingReasons, validateKernelKconfigSources } from "./lineage-kconfig-validation.mjs";

const catalogPath = process.env.LINEAGE_RECIPE_CATALOG || process.argv[2] || "catalog/lineage-vendors-recipes.json";
const blockedCatalogPath =
  process.env.LINEAGE_BLOCKED_CATALOG ||
  catalogPath.replace(/-recipes\.json$/, "-blocked.json");
const recipeDir = process.env.LINEAGE_RECIPE_DIR || "recipes/lineage-vendors";
const supportedArchitectures = new Set(
  (process.env.LINEAGE_SUPPORTED_ARCHES || "arm64")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const requested = new Set(
  (process.env.LINEAGE_VALIDATE_DEVICES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

const githubApi = "https://api.github.com";
const textCache = new Map();
const treeCache = new Map();

function githubHeaders(raw = false) {
  const headers = {
    Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "User-Agent": "android-docker-boot-builder-lineage-validator",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function fetchWithRetry(url, raw = false) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: githubHeaders(raw),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
    }
  }
  throw lastError;
}

async function repoText(ownerRepo, ref, subpath) {
  const cacheKey = `${ownerRepo}:${ref}:${subpath}`;
  if (textCache.has(cacheKey)) return textCache.get(cacheKey);
  const encodedPath = subpath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const value = await (await fetchWithRetry(
    `${githubApi}/repos/${ownerRepo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    true,
  )).text();
  textCache.set(cacheKey, value);
  return value;
}

async function repoTree(ownerRepo, ref) {
  const cacheKey = `${ownerRepo}:${ref}`;
  if (treeCache.has(cacheKey)) return treeCache.get(cacheKey);
  const value = await (await fetchWithRetry(
    `${githubApi}/repos/${ownerRepo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    false,
  )).json();
  const tree = value.tree || [];
  treeCache.set(cacheKey, tree);
  return tree;
}

function ownerRepoFromGitUrl(url) {
  const match = String(url || "").match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
  return match ? match[1].replace(/\.git$/, "") : "";
}

function recipeKey(recipe) {
  return `${recipe.build?.vendor_short || ""}/${recipe.build?.device || ""}`;
}

function recipePath(recipe) {
  return path.join(recipeDir, recipe.build.vendor_short, `${recipe.build.device}.json`);
}

function shouldValidate(recipe) {
  if (!supportedArchitectures.has(recipe.build?.arch || "")) return false;
  if (requested.size > 0) return requested.has(recipe.build.device) || requested.has(recipeKey(recipe));
  return recipe.status === "build_ready";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function blockRecipe(recipe, validation) {
  const reasons = kconfigMissingReasons(validation);
  if (reasons.length === 0) return false;
  recipe.status = "blocked";
  recipe.blocked_reasons = reasons;
  recipe.source_facts ??= {};
  recipe.source_facts.kernel_source ??= {};
  recipe.source_facts.kernel_source.kconfig_validation = validation;
  return true;
}

function blockedEntry(recipe) {
  return {
    device: recipe.build.device,
    vendor_short: recipe.build.vendor_short,
    names: recipe.source_facts?.names || [],
    reasons: recipe.blocked_reasons || [],
  };
}

const catalog = await readJson(catalogPath);
const recipes = catalog.recipes || [];
const changedKeys = new Set();

for (const recipe of recipes.filter(shouldValidate)) {
  const ownerRepo = ownerRepoFromGitUrl(recipe.build.kernel_repo);
  if (!ownerRepo || !recipe.build.kernel_ref) continue;

  const validation = await validateKernelKconfigSources({
    ownerRepo,
    ref: recipe.build.kernel_ref,
    architecture: recipe.build.arch,
    repoText,
    repoTree,
  });
  recipe.source_facts ??= {};
  recipe.source_facts.kernel_source ??= {};
  recipe.source_facts.kernel_source.kconfig_validation = validation;

  if (blockRecipe(recipe, validation)) {
    changedKeys.add(recipeKey(recipe));
    const filePath = recipePath(recipe);
    try {
      const fileRecipe = await readJson(filePath);
      blockRecipe(fileRecipe, validation);
      await writeJson(filePath, fileRecipe);
    } catch (error) {
      if (!/^ENOENT\b/.test(String(error?.code || ""))) throw error;
    }
  }

  console.log(
    `${recipeKey(recipe)} checked=${validation.checked} visited=${validation.visited_files} missing=${validation.missing_sources.length}`,
  );
}

await writeJson(catalogPath, catalog);

let blockedCatalog = { metadata: catalog.metadata || {}, blocked: [] };
try {
  blockedCatalog = await readJson(blockedCatalogPath);
} catch (error) {
  if (!/^ENOENT\b/.test(String(error?.code || ""))) throw error;
}

const blockedItems = blockedCatalog.blocked || [];
const blockedIndexByKey = new Map(blockedItems.map((item, index) => [`${item.vendor_short}/${item.device}`, index]));
for (const recipe of recipes) {
  const key = recipeKey(recipe);
  if (!changedKeys.has(key)) continue;

  const entry = blockedEntry(recipe);
  if (blockedIndexByKey.has(key)) {
    blockedItems[blockedIndexByKey.get(key)] = entry;
  } else {
    blockedIndexByKey.set(key, blockedItems.length);
    blockedItems.push(entry);
  }
}
blockedCatalog.blocked = blockedItems;
await writeJson(blockedCatalogPath, blockedCatalog);

console.log(`validated=${recipes.filter(shouldValidate).length}`);
console.log(`newly_blocked=${changedKeys.size}`);
if (changedKeys.size) console.log(Array.from(changedKeys).sort().join("\n"));
