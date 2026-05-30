#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const options = {
  outputDir: process.env.LINEAGE_OUTPUT_DIR || path.join(rootDir, "catalog"),
  recipeDir: process.env.LINEAGE_RECIPE_DIR || path.join(rootDir, "recipes", "lineage"),
  outputPrefix: process.env.LINEAGE_OUTPUT_PREFIX || "lineage-xiaomi",
  recipeLayout: process.env.LINEAGE_RECIPE_LAYOUT || "flat",
  maxDevices: Number(process.env.LINEAGE_MAX_DEVICES || "0"),
  device: process.env.LINEAGE_DEVICE || "",
  listVendors: process.env.LINEAGE_LIST_VENDORS === "1",
  includeUnofficial: process.env.LINEAGE_INCLUDE_UNOFFICIAL === "1",
};
const supportedArchitectures = new Set(
  (process.env.LINEAGE_SUPPORTED_ARCHES || "arm64")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const vendorFilters = new Set(
  (process.env.LINEAGE_VENDOR_SHORTS || "xiaomi")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);
const includeAllVendors = vendorFilters.has("*") || vendorFilters.has("all");

const githubApi = "https://api.github.com";
const lineageWikiRepo = "LineageOS/lineage_wiki";
const contentsCache = new Map();
const textCache = new Map();
const branchCache = new Map();
const downloadCache = new Map();

function githubHeaders(raw = false) {
  const headers = {
    Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "User-Agent": "android-docker-boot-builder-lineage-catalog",
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

async function fetchText(url, raw = false) {
  return (await fetchWithRetry(url, raw)).text();
}

async function fetchJson(url) {
  return (await fetchWithRetry(url, false)).json();
}

function stripQuote(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function parseScalar(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed === "true" || trimmed === "True") return true;
  if (trimmed === "false" || trimmed === "False") return false;
  if (/^\[.*\]$/.test(trimmed)) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((part) => stripQuote(part));
  }
  if (/^\{.*\}$/.test(trimmed)) {
    const inner = trimmed.slice(1, -1).trim();
    const out = {};
    for (const part of inner.split(",")) {
      const index = part.indexOf(":");
      if (index < 0) continue;
      const key = stripQuote(part.slice(0, index));
      out[key] = parseScalar(part.slice(index + 1));
    }
    return out;
  }
  return stripQuote(trimmed);
}

function parseDeviceYaml(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s/.test(line) || !line.includes(":")) continue;
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    out[match[1]] = parseScalar(match[2]);
  }
  return out;
}

function versionNumber(value) {
  const text = String(value || "0");
  const [major, minor = "0"] = text.split(".");
  return Number(major) * 100 + Number(minor);
}

function branchCandidates(currentBranch, versions = []) {
  const values = [currentBranch, ...versions]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort((a, b) => versionNumber(b) - versionNumber(a));
  const out = [];
  for (const value of values) {
    const base = `lineage-${value}`;
    out.push(base);
    if (/\.0$/.test(value)) out.push(`lineage-${value.replace(/\.0$/, "")}`);
    if (/^\d+$/.test(value)) out.push(`lineage-${value}.0`);
  }
  return Array.from(new Set(out));
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  return [String(value)];
}

function architectureKey(value) {
  if (!value) return "unknown";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const cpu = String(value.cpu || "unknown");
    const userspace = String(value.userspace || cpu);
    return userspace === cpu ? cpu : `${cpu}-${userspace}`;
  }
  return String(value);
}

function groupDevices(devices) {
  const groups = new Map();
  for (const device of devices) {
    if (!device.codename) continue;
    const current = groups.get(device.codename) || {
      codename: device.codename,
      names: [],
      yaml_files: [],
      versions: [],
      models: [],
    };
    current.names.push(device.name);
    current.yaml_files.push(device.yaml_file);
    current.versions.push(...normalizeList(device.versions));
    current.models.push(...normalizeList(device.models));
    for (const key of [
      "architecture",
      "current_branch",
      "kernel",
      "name",
      "recovery_partition_name",
      "tree",
      "type",
      "vendor",
      "vendor_short",
    ]) {
      if (device[key] && !current[key]) current[key] = device[key];
    }
    groups.set(device.codename, current);
  }

  return Array.from(groups.values()).map((device) => ({
    ...device,
    names: Array.from(new Set(device.names.filter(Boolean))),
    yaml_files: Array.from(new Set(device.yaml_files.filter(Boolean))),
    versions: Array.from(new Set(device.versions.filter(Boolean))).sort(
      (a, b) => versionNumber(b) - versionNumber(a),
    ),
    models: Array.from(new Set(device.models.filter(Boolean))),
  }));
}

async function listLineageWikiDeviceFiles() {
  const url = `${githubApi}/repos/${lineageWikiRepo}/contents/_data/devices?ref=main`;
  const entries = await fetchJson(url);
  return entries.filter((entry) => entry.name.endsWith(".yml"));
}

async function readWikiDevice(entry) {
  const devicePath = entry.path || `_data/devices/${entry.name}`;
  const url = `${githubApi}/repos/${lineageWikiRepo}/contents/${devicePath}?ref=main`;
  const text = await fetchText(url, true);
  return { ...parseDeviceYaml(text), yaml_file: entry.name };
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

async function repoContents(ownerRepo, ref, subpath = "") {
  const cacheKey = `${ownerRepo}:${ref}:${subpath}`;
  if (contentsCache.has(cacheKey)) return contentsCache.get(cacheKey);
  const encodedPath = subpath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const pathPart = encodedPath ? `/contents/${encodedPath}` : "/contents";
  const value = await fetchJson(`${githubApi}/repos/${ownerRepo}${pathPart}?ref=${encodeURIComponent(ref)}`);
  contentsCache.set(cacheKey, value);
  return value;
}

async function repoText(ownerRepo, ref, subpath) {
  const cacheKey = `${ownerRepo}:${ref}:${subpath}`;
  if (textCache.has(cacheKey)) return textCache.get(cacheKey);
  const encodedPath = subpath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const value = await fetchText(
    `${githubApi}/repos/${ownerRepo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    true,
  );
  textCache.set(cacheKey, value);
  return value;
}

async function branchExists(ownerRepo, ref) {
  const cacheKey = `${ownerRepo}:${ref}`;
  if (branchCache.has(cacheKey)) return branchCache.get(cacheKey);
  try {
    await repoContents(ownerRepo, ref);
    branchCache.set(cacheKey, true);
    return true;
  } catch {
    branchCache.set(cacheKey, false);
    return false;
  }
}

async function resolveSharedBranch(deviceRepo, kernelRepo, candidates) {
  for (const branch of candidates) {
    const [deviceOk, kernelOk] = await Promise.all([
      branchExists(deviceRepo, branch),
      branchExists(kernelRepo, branch),
    ]);
    if (deviceOk && kernelOk) return branch;
  }
  return "";
}

function classifyKernelContents(contents) {
  const names = new Map(contents.map((entry) => [entry.name, entry.type]));
  const hasFile = (name) => names.get(name) === "file";
  const hasDir = (name) => names.get(name) === "dir";
  const fullSource =
    hasFile("Makefile") &&
    hasDir("arch") &&
    hasDir("scripts") &&
    (hasDir("drivers") || hasDir("kernel")) &&
    (hasDir("fs") || hasDir("mm"));
  const prebuiltOnly =
    !fullSource &&
    (hasFile("kernel") || hasFile("Image") || hasFile("Image.gz") || hasFile("dtb.img") || hasFile("dtbo.img")) &&
    (hasDir("modules") || hasDir("headers") || hasFile("dtb.img") || hasFile("dtbo.img"));
  return fullSource ? "full_source" : prebuiltOnly ? "prebuilt_only" : "unknown_tree";
}

function joinMakeContinuations(text) {
  const logical = [];
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    if (line.endsWith("\\")) {
      current += `${line.slice(0, -1)} `;
    } else {
      logical.push(`${current}${line}`.trim());
      current = "";
    }
  }
  if (current.trim()) logical.push(current.trim());
  return logical.join("\n");
}

function extractMakeAssignments(text, variable) {
  const joined = joinMakeContinuations(text);
  const values = [];
  const re = new RegExp(`^${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?::=|\\+=)\\s*(.*)$`, "gm");
  let match;
  while ((match = re.exec(joined))) {
    values.push(
      ...match[1]
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean),
    );
  }
  return values;
}

function extractMakeScalar(text, variable) {
  const values = extractMakeAssignments(text, variable);
  return values[values.length - 1] || "";
}

function extractIncludes(text) {
  const includes = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:-)?include\s+device\/([^/\s]+)\/([^/\s]+)\/([A-Za-z0-9_.-]+\.mk)\s*$/);
    if (!match) continue;
    includes.push({
      repo: `LineageOS/android_device_${match[1]}_${match[2]}`,
      file: match[3],
    });
  }
  return includes;
}

async function collectBoardConfigs(ownerRepo, ref, file = "BoardConfig.mk", seen = new Set()) {
  const key = `${ownerRepo}:${ref}:${file}`;
  if (seen.has(key)) return [];
  seen.add(key);

  let text = "";
  try {
    text = await repoText(ownerRepo, ref, file);
  } catch {
    return [];
  }

  const included = [];
  for (const include of extractIncludes(text)) {
    included.push(...(await collectBoardConfigs(include.repo, ref, include.file, seen)));
  }
  return [...included, { repo: ownerRepo, ref, file, text }];
}

function boardConfigFacts(configs) {
  const allText = configs.map((item) => item.text).join("\n");
  return {
    files: configs.map((item) => ({
      repo: `https://github.com/${item.repo}`,
      ref: item.ref,
      file: item.file,
    })),
    kernel_configs: Array.from(new Set(extractMakeAssignments(allText, "TARGET_KERNEL_CONFIG"))),
    kernel_source_path: extractMakeScalar(allText, "TARGET_KERNEL_SOURCE"),
    kernel_image_name: extractMakeScalar(allText, "BOARD_KERNEL_IMAGE_NAME") || "Image.gz-dtb",
  };
}

async function latestLineageBuild(codename) {
  if (downloadCache.has(codename)) return downloadCache.get(codename);
  const url = `https://download.lineageos.org/api/v2/devices/${encodeURIComponent(codename)}/builds`;
  const builds = await fetchJson(url);
  if (!Array.isArray(builds) || builds.length === 0) {
    const empty = { api_url: url, latest: null };
    downloadCache.set(codename, empty);
    return empty;
  }
  const files = builds.flatMap((build) => build.files || []);
  files.sort((a, b) => Number(b.datetime || 0) - Number(a.datetime || 0));
  const value = { api_url: url, latest: files[0] || null };
  downloadCache.set(codename, value);
  return value;
}

async function inspectDevice(device) {
  const vendorShort = vendorShortOf(device);
  const treeRepoName = device.tree || `android_device_${vendorShort}_${device.codename}`;
  const kernelRepoName = device.kernel?.repo || "";
  const deviceRepo = `LineageOS/${treeRepoName}`;
  const kernelRepo = kernelRepoName ? `LineageOS/${kernelRepoName}` : "";
  const candidates = branchCandidates(device.current_branch, device.versions);
  const lineageBranch = kernelRepo ? await resolveSharedBranch(deviceRepo, kernelRepo, candidates) : "";
  const architecture = architectureKey(device.architecture);
  const blocked = [];

  if (!supportedArchitectures.has(architecture)) {
    blocked.push(
      `Device architecture is ${architecture}; only ${Array.from(supportedArchitectures).join(", ")} devices are built.`,
    );
  }
  if (!kernelRepoName) blocked.push("Lineage wiki device entry has no kernel.repo.");
  if (!device.tree) blocked.push("Lineage wiki device entry has no tree.");
  if (!lineageBranch) blocked.push("No shared LineageOS branch found for device tree and kernel repo.");

  let kernelValidation = "not_checked";
  let boardFacts = { files: [], kernel_configs: [], kernel_source_path: "", kernel_image_name: "Image.gz-dtb" };
  if (lineageBranch && kernelRepo) {
    const kernelContents = await repoContents(kernelRepo, lineageBranch).catch(() => []);
    kernelValidation = Array.isArray(kernelContents) ? classifyKernelContents(kernelContents) : "api_error";
    if (kernelValidation !== "full_source") blocked.push(`Kernel repo validation is ${kernelValidation}.`);
    boardFacts = boardConfigFacts(await collectBoardConfigs(deviceRepo, lineageBranch));
    if (boardFacts.kernel_configs.length === 0) blocked.push("No TARGET_KERNEL_CONFIG found in LineageOS BoardConfig.");
  }

  const download = await latestLineageBuild(device.codename).catch((error) => ({
    api_url: `https://download.lineageos.org/api/v2/devices/${device.codename}/builds`,
    latest: null,
    error: error.message,
  }));
  if (!download.latest?.url) blocked.push("No official LineageOS build found in download API.");

  const buildReady = blocked.length === 0;
  const recipe = {
    schema: 1,
    rom: "LineageOS",
    status: buildReady ? "build_ready" : "blocked_until_source_complete",
    blocked_reasons: blocked,
    source_facts: {
      lineage_devices_url: "https://wiki.lineageos.org/devices/",
      lineage_wiki_url: `https://wiki.lineageos.org/devices/${device.codename}/`,
      lineage_wiki_files: device.yaml_files.map(
        (file) => `https://github.com/LineageOS/lineage_wiki/blob/main/_data/devices/${file}`,
      ),
      download_api_url: download.api_url,
      latest_official_build: download.latest,
      names: device.names,
      models: device.models,
      vendor: device.vendor || "",
      vendor_short: vendorShort,
      architecture: device.architecture,
      current_branch: device.current_branch,
      versions: device.versions,
      recovery_partition_name: device.recovery_partition_name,
      device_tree: {
        repo: `https://github.com/${deviceRepo}`,
        ref: lineageBranch,
        validation: lineageBranch ? "found" : "missing",
      },
      kernel_source: {
        repo: kernelRepo ? `https://github.com/${kernelRepo}` : "",
        ref: lineageBranch,
        validation: kernelValidation,
        version: device.kernel?.version || "",
      },
      board_config: boardFacts,
    },
    build: {
      device: device.codename,
      vendor: device.vendor || "",
      vendor_short: vendorShort,
      lineage_branch: lineageBranch,
      boot_source_url: download.latest?.url || "",
      boot_source_sha256: download.latest?.sha256 || "",
      kernel_repo: kernelRepo ? `https://github.com/${kernelRepo}.git` : "",
      kernel_ref: lineageBranch,
      arch: architecture,
      kernel_configs: boardFacts.kernel_configs,
      image_target: boardFacts.kernel_image_name,
      fragment_path: "config/docker-required.fragment",
    },
  };

  return recipe;
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function vendorShortOf(device) {
  return String(device.vendor_short || device.vendor || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function recipePathFor(device) {
  if (options.recipeLayout === "vendor") {
    return path.join(options.recipeDir, vendorShortOf(device), `${device.codename}.json`);
  }
  return path.join(options.recipeDir, `${device.codename}.json`);
}

function catalogMetadata() {
  return {
    generated_at: new Date().toISOString(),
    source_policy:
      "Only official LineageOS device metadata, official LineageOS GitHub repos, and official LineageOS download API are used.",
    lineage_devices_url: "https://wiki.lineageos.org/devices/",
    lineage_github_url: "https://github.com/LineageOS",
    supported_architectures: Array.from(supportedArchitectures),
    vendor_filters: includeAllVendors ? ["*"] : Array.from(vendorFilters),
    recipe_layout: options.recipeLayout,
  };
}

async function main() {
  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.mkdir(options.recipeDir, { recursive: true });

  const entries = options.device
    ? [
        { name: `${options.device}.yml` },
        ...Array.from({ length: 20 }, (_, index) => ({
          name: `${options.device}_variant${index + 1}.yml`,
        })),
      ]
    : await listLineageWikiDeviceFiles();
  const allDevices = (
    await mapLimit(entries, 8, async (entry) => {
      try {
        return await readWikiDevice(entry);
      } catch (error) {
        if (options.device && /404/.test(error.message)) return null;
        throw error;
      }
    })
  ).filter(Boolean);
  if (options.device && allDevices.length === 0) {
    throw new Error(`No LineageOS wiki device YAML found for ${options.device}`);
  }
  const parsed = allDevices.filter((device) => {
    if (includeAllVendors) return true;
    const short = vendorShortOf(device);
    const rawShort = String(device.vendor_short || "").toLowerCase();
    const vendor = String(device.vendor || "").toLowerCase();
    return vendorFilters.has(short) || vendorFilters.has(rawShort) || vendorFilters.has(vendor);
  });

  if (options.listVendors) {
    const byVendor = new Map();
    for (const device of parsed) {
      const vendorShort = vendorShortOf(device);
      const current = byVendor.get(vendorShort) || {
        vendor_short: vendorShort,
        vendor: device.vendor || "",
        device_count: 0,
      };
      current.device_count += 1;
      if (!current.vendor && device.vendor) current.vendor = device.vendor;
      byVendor.set(vendorShort, current);
    }
    const vendors = Array.from(byVendor.values()).sort((a, b) => a.vendor_short.localeCompare(b.vendor_short));
    await writeJson(path.join(options.outputDir, `${options.outputPrefix}-vendors.json`), {
      metadata: catalogMetadata(),
      vendors,
    });
    console.log(`vendors=${vendors.length}`);
    console.log(vendors.map((item) => `${item.vendor_short} ${item.device_count}`).join("\n"));
    return;
  }

  let devices = groupDevices(parsed).sort((a, b) => a.codename.localeCompare(b.codename));
  if (options.device) {
    devices = devices.filter((device) => device.codename === options.device);
  }
  if (options.maxDevices > 0) devices = devices.slice(0, options.maxDevices);

  const recipes = await mapLimit(devices, 4, async (device) => {
    console.log(`LineageOS ${device.vendor_short || device.vendor} device: ${device.codename}`);
    const recipe = await inspectDevice(device);
    await writeJson(recipePathFor(device), recipe);
    return recipe;
  });
  const blocked = recipes
    .filter((recipe) => recipe.status !== "build_ready")
    .map((recipe) => ({
      device: recipe.build.device,
      vendor_short: recipe.build.vendor_short,
      names: recipe.source_facts.names,
      reasons: recipe.blocked_reasons,
    }));

  const metadata = catalogMetadata();

  await writeJson(path.join(options.outputDir, `${options.outputPrefix}-devices.json`), { metadata, devices });
  await writeJson(path.join(options.outputDir, `${options.outputPrefix}-recipes.json`), { metadata, recipes });
  await writeJson(path.join(options.outputDir, `${options.outputPrefix}-blocked.json`), { metadata, blocked });

  console.log(`devices=${devices.length}`);
  console.log(`recipes=${recipes.length}`);
  console.log(`build_ready=${recipes.filter((item) => item.status === "build_ready").length}`);
  console.log(`blocked=${blocked.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
