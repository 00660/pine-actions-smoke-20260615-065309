#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  kconfigMissingReasons,
  validateKernelKconfigSources,
} from "./lineage-kconfig-validation.mjs";

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
const validateAll = process.env.LINEAGE_VALIDATE_ALL === "1";

const githubApi = "https://api.github.com";
const textCache = new Map();
const treeCache = new Map();
const validationCache = new Map();
const useGitKconfig = process.env.LINEAGE_KCONFIG_USE_GIT === "1";

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
    `https://raw.githubusercontent.com/${ownerRepo}/${encodeURIComponent(ref)}/${encodedPath}`,
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

function safeCacheName(value) {
  return String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function ensureGitMetadataClone(ownerRepo, ref) {
  const cacheRoot = process.env.LINEAGE_KCONFIG_CLONE_CACHE || path.join(os.tmpdir(), "lineage-kconfig-kernels");
  const cloneDir = path.join(cacheRoot, safeCacheName(`${ownerRepo}_${ref}`));
  const completeMarker = path.join(cloneDir, ".kconfig-git-ok");
  try {
    await fs.access(completeMarker);
    return cloneDir;
  } catch {
    await fs.rm(cloneDir, { recursive: true, force: true });
  }

  await fs.mkdir(cacheRoot, { recursive: true });
  const repoUrl = `https://github.com/${ownerRepo}.git`;
  execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--branch", ref, "--no-checkout", repoUrl, cloneDir], {
    stdio: "pipe",
  });
  await fs.writeFile(completeMarker, "ok\n", "utf8");
  return cloneDir;
}

async function validateWithGit(ownerRepo, ref, architecture) {
  const kernelDir = await ensureGitMetadataClone(ownerRepo, ref);
  return validateKernelKconfigSources({
    ownerRepo: "local/kernel",
    ref: "local",
    architecture,
    repoText: async (_ownerRepo, _ref, subpath) => {
      try {
        return execFileSync("git", ["-C", kernelDir, "show", `HEAD:${subpath}`], {
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch (error) {
        throw new Error(`404 Not Found: ${subpath}`);
      }
    },
  });
}

function ownerRepoFromGitUrl(url) {
  const match = String(url || "").match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
  return match ? match[1].replace(/\.git$/, "") : "";
}

function recipeKey(recipe) {
  return `${recipe.build?.vendor_short || ""}/${recipe.build?.device || ""}`;
}

function kernelIdentity(recipe) {
  const ownerRepo = ownerRepoFromGitUrl(recipe.build?.kernel_repo);
  const ref = recipe.build?.kernel_ref || "";
  const arch = recipe.build?.arch || "";
  if (!ownerRepo || !ref || !arch) return null;
  return {
    ownerRepo,
    ref,
    arch,
    key: `${ownerRepo}:${ref}:${arch}`,
  };
}

function recipePath(recipe) {
  return path.join(recipeDir, recipe.build.vendor_short, `${recipe.build.device}.json`);
}

function isSupportedRecipe(recipe) {
  return supportedArchitectures.has(recipe.build?.arch || "");
}

function matchesRequested(recipe) {
  return requested.has(recipe.build?.device) || requested.has(recipeKey(recipe));
}

function shouldValidate(recipe) {
  if (!isSupportedRecipe(recipe)) return false;
  if (requested.size > 0) return matchesRequested(recipe);
  if (!validateAll) return false;
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
const selectedRecipes = recipes.filter(shouldValidate);
const validatedKernelKeys = new Set();

if (selectedRecipes.length === 0) {
  console.log("validated=0");
  console.log("validated_kernel_groups=0");
  console.log("newly_blocked=0");
  process.exit(0);
}

for (const recipe of selectedRecipes) {
  const identity = kernelIdentity(recipe);
  if (!identity || validatedKernelKeys.has(identity.key)) continue;
  validatedKernelKeys.add(identity.key);

  const validationKey = identity.key;
  let validation = validationCache.get(validationKey);
  if (!validation) {
    validation = useGitKconfig
      ? await validateWithGit(identity.ownerRepo, identity.ref, identity.arch)
      : await validateKernelKconfigSources({
          ownerRepo: identity.ownerRepo,
          ref: identity.ref,
          architecture: identity.arch,
          repoText,
          repoTree,
        });
    validationCache.set(validationKey, validation);
  }

  const kernelGroup = recipes.filter((candidate) => {
    if (!isSupportedRecipe(candidate)) return false;
    if (candidate.status !== "build_ready" && candidate.status !== "blocked" && !matchesRequested(candidate)) return false;
    const candidateIdentity = kernelIdentity(candidate);
    return candidateIdentity?.key === identity.key;
  });

  if ((validation.missing_sources || []).length > 0) {
    for (const target of kernelGroup) {
      if (!blockRecipe(target, validation)) continue;
      changedKeys.add(recipeKey(target));
      const filePath = recipePath(target);
      try {
        const fileRecipe = await readJson(filePath);
        blockRecipe(fileRecipe, validation);
        await writeJson(filePath, fileRecipe);
      } catch (error) {
        if (!/^ENOENT\b/.test(String(error?.code || ""))) throw error;
      }
    }
  }

  console.log(
    `${recipeKey(recipe)} kernel_group=${kernelGroup.length} checked=${validation.checked} visited=${validation.visited_files} missing=${validation.missing_sources.length}`,
  );
}

if (changedKeys.size === 0) {
  console.log(`validated=${selectedRecipes.length}`);
  console.log(`validated_kernel_groups=${validatedKernelKeys.size}`);
  console.log("newly_blocked=0");
  process.exit(0);
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
blockedItems.sort((a, b) => `${a.vendor_short || ""}/${a.device}`.localeCompare(`${b.vendor_short || ""}/${b.device}`));
blockedCatalog.blocked = blockedItems;
await writeJson(blockedCatalogPath, blockedCatalog);

console.log(`validated=${selectedRecipes.length}`);
console.log(`validated_kernel_groups=${validatedKernelKeys.size}`);
console.log(`newly_blocked=${changedKeys.size}`);
if (changedKeys.size) console.log(Array.from(changedKeys).sort().join("\n"));
