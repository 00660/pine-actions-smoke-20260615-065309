#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { kconfigMissingReasons, validateKernelKconfigSources } from "./lineage-kconfig-validation.mjs";

const kernelDir = process.argv[2];
const architecture = process.argv[3] || "arm64";

if (!kernelDir) {
  console.error("usage: check-local-kconfig-sources.mjs <kernel-dir> [arch]");
  process.exit(2);
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(fullPath, base)));
    } else if (entry.isFile()) {
      out.push({
        path: path.relative(base, fullPath).replace(/\\/g, "/"),
        type: "blob",
      });
    }
  }
  return out;
}

async function repoTree() {
  return walk(kernelDir);
}

async function repoText(_ownerRepo, _ref, subpath) {
  return fs.readFile(path.join(kernelDir, subpath), "utf8");
}

const validation = await validateKernelKconfigSources({
  ownerRepo: "local/kernel",
  ref: "local",
  architecture,
  repoText,
  repoTree,
});

const reasons = kconfigMissingReasons(validation, 12);
if (reasons.length > 0) {
  console.error("kernel Kconfig mandatory source validation failed:");
  for (const reason of reasons) console.error(`- ${reason}`);
  process.exit(1);
}

console.log(`kernel Kconfig mandatory source validation passed: ${validation.visited_files} files checked`);
