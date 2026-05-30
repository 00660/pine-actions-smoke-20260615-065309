#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] || ".vendor-artifacts";
const outputDir = process.env.LINEAGE_OUTPUT_DIR || "catalog";
const outputPrefix = process.env.LINEAGE_OUTPUT_PREFIX || "lineage-vendors";

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(fullPath)));
    } else {
      out.push(fullPath);
    }
  }
  return out;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function catalogMetadata(vendorCount) {
  return {
    generated_at: new Date().toISOString(),
    source_policy:
      "Only official LineageOS device metadata, official LineageOS GitHub repos, and official LineageOS download API are used.",
    lineage_devices_url: "https://wiki.lineageos.org/devices/",
    lineage_github_url: "https://github.com/LineageOS",
    supported_architectures: ["arm64"],
    vendor_filters: ["*"],
    recipe_layout: "vendor",
    vendor_count: vendorCount,
  };
}

const files = await walk(inputDir);
const devices = [];
const recipes = [];
const blocked = [];
const vendors = new Set();

for (const file of files) {
  const name = path.basename(file);
  if (!name.startsWith("lineage-vendor-")) continue;
  if (name.endsWith("-devices.json")) {
    const data = await readJson(file);
    devices.push(...(data.devices || []));
  } else if (name.endsWith("-recipes.json")) {
    const data = await readJson(file);
    recipes.push(...(data.recipes || []));
  } else if (name.endsWith("-blocked.json")) {
    const data = await readJson(file);
    blocked.push(...(data.blocked || []));
  }
}

for (const recipe of recipes) {
  if (recipe.build?.vendor_short) vendors.add(recipe.build.vendor_short);
}

devices.sort((a, b) => `${a.vendor_short || ""}/${a.codename}`.localeCompare(`${b.vendor_short || ""}/${b.codename}`));
recipes.sort((a, b) =>
  `${a.build?.vendor_short || ""}/${a.build?.device || ""}`.localeCompare(
    `${b.build?.vendor_short || ""}/${b.build?.device || ""}`,
  ),
);
blocked.sort((a, b) => `${a.vendor_short || ""}/${a.device}`.localeCompare(`${b.vendor_short || ""}/${b.device}`));

const metadata = catalogMetadata(vendors.size);
await writeJson(path.join(outputDir, `${outputPrefix}-devices.json`), { metadata, devices });
await writeJson(path.join(outputDir, `${outputPrefix}-recipes.json`), { metadata, recipes });
await writeJson(path.join(outputDir, `${outputPrefix}-blocked.json`), { metadata, blocked });

console.log(`vendors=${vendors.size}`);
console.log(`devices=${devices.length}`);
console.log(`recipes=${recipes.length}`);
console.log(`build_ready=${recipes.filter((recipe) => recipe.status === "build_ready").length}`);
console.log(`blocked=${blocked.length}`);
