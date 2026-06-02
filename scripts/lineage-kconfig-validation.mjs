import path from "node:path";

const defaultMaxFiles = Number(process.env.LINEAGE_KCONFIG_MAX_FILES || "3000");
const defaultConcurrency = Number(process.env.LINEAGE_KCONFIG_CONCURRENCY || "8");

function stripSourceValue(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function sourceArch(architecture) {
  const value = String(architecture || "").toLowerCase();
  if (value.startsWith("arm64")) return "arm64";
  if (value.startsWith("arm")) return "arm";
  return value || "arm64";
}

function expandSourcePath(value, architecture) {
  const arch = sourceArch(architecture);
  let expanded = stripSourceValue(value)
    .replace(/^\$\(srctree\)\//, "")
    .replace(/^\$\{srctree\}\//, "")
    .replace(/^\$srctree\//, "");

  expanded = expanded
    .replace(/\$\(SRCARCH\)|\$\{SRCARCH\}|\$SRCARCH/g, arch)
    .replace(/\$\(ARCH\)|\$\{ARCH\}|\$ARCH/g, arch);

  if (!expanded || /[$`]/.test(expanded)) {
    return { path: "", reason: `unsupported dynamic Kconfig source path: ${value}` };
  }
  if (/[*?[\]]/.test(expanded)) {
    return { path: "", reason: `unsupported glob Kconfig source path: ${value}` };
  }
  return {
    path: path.posix.normalize(expanded.replace(/^\/+/, "")),
    reason: "",
  };
}

function extractSourceDirectives(text) {
  const directives = [];
  let inHelp = false;
  let helpIndent = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const indent = rawLine.match(/^\s*/)[0].replace(/\t/g, "        ").length;

    if (inHelp) {
      if (!trimmed) continue;
      if (helpIndent === null) {
        helpIndent = indent;
        continue;
      }
      if (indent >= helpIndent) continue;
      inHelp = false;
      helpIndent = null;
    }

    if (trimmed === "help" || trimmed === "---help---") {
      inHelp = true;
      helpIndent = null;
      continue;
    }

    const line = rawLine.replace(/\s+#.*$/, "");
    const match = line.match(/^\s*(source|rsource|osource|orsource)\s+(.+?)\s*$/);
    if (!match) continue;
    const keyword = match[1];
    directives.push({
      keyword,
      source: match[2],
      optional: keyword === "osource" || keyword === "orsource",
      relative: keyword === "rsource" || keyword === "orsource",
    });
  }
  return directives;
}

function missingReason(missing) {
  return `Kernel Kconfig mandatory source is missing: ${missing.path} (referenced by ${missing.referenced_by}).`;
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

export function isRelevantKconfigPath(filePath, architecture) {
  const base = path.posix.basename(filePath);
  if (!base.startsWith("Kconfig")) return false;

  const archMatch = filePath.match(/^arch\/([^/]+)\//);
  if (archMatch && archMatch[1] !== sourceArch(architecture)) return false;
  return true;
}

function referencedPath(currentPath, directive, architecture) {
  const expanded = expandSourcePath(directive.source, architecture);
  if (!expanded.path) return { path: "", reason: expanded.reason };
  const nextPath = directive.relative
    ? path.posix.normalize(path.posix.join(path.posix.dirname(currentPath), expanded.path))
    : expanded.path;
  if (nextPath.startsWith("../")) {
    return { path: "", reason: "relative Kconfig source escapes repository root" };
  }
  return { path: nextPath, reason: "" };
}

function isMissingTextError(error) {
  const message = String(error?.message || "");
  return error?.code === "ENOENT" || /^404\b/.test(message);
}

function sortValidation(validation) {
  validation.missing_sources.sort((a, b) => `${a.path}:${a.referenced_by}`.localeCompare(`${b.path}:${b.referenced_by}`));
  validation.skipped_sources.sort((a, b) =>
    `${a.source}:${a.referenced_by}`.localeCompare(`${b.source}:${b.referenced_by}`),
  );
  return validation;
}

async function validateFromTree({ ownerRepo, ref, architecture, repoText, repoTree, maxFiles, concurrency }) {
  const tree = await repoTree(ownerRepo, ref);
  const paths = new Set(tree.filter((entry) => entry.type === "blob").map((entry) => entry.path).filter(Boolean));
  const validation = {
    checked: false,
    root: "Kconfig",
    architecture: sourceArch(architecture),
    visited_files: 0,
    missing_sources: [],
    skipped_sources: [],
    capped: false,
  };

  const queue = [{ path: "Kconfig", referenced_by: "", keyword: "root" }];
  const queued = new Set(queue.map((item) => item.path));
  const visited = new Set();

  while (queue.length > 0) {
    if (visited.size >= maxFiles) {
      validation.capped = true;
      break;
    }

    const slots = Math.max(1, maxFiles - visited.size);
    const batch = queue.splice(0, Math.max(1, Math.min(concurrency, slots)));
    await mapLimit(batch, concurrency, async (current) => {
      if (visited.has(current.path)) return;
      if (!paths.has(current.path)) {
        validation.missing_sources.push({
          path: current.path,
          referenced_by: current.referenced_by || "<root>",
          keyword: current.keyword,
        });
        return;
      }

      let text = "";
      try {
        text = await repoText(ownerRepo, ref, current.path);
      } catch (error) {
        if (isMissingTextError(error)) {
          validation.missing_sources.push({
            path: current.path,
            referenced_by: current.referenced_by || "<root>",
            keyword: current.keyword,
          });
          return;
        }
        throw error;
      }

      visited.add(current.path);
      validation.checked = true;

      for (const directive of extractSourceDirectives(text)) {
        if (directive.optional) continue;
        const next = referencedPath(current.path, directive, architecture);
        if (!next.path) {
          validation.skipped_sources.push({
            source: directive.source,
            referenced_by: current.path,
            keyword: directive.keyword,
            reason: next.reason,
          });
          continue;
        }
        if (!queued.has(next.path)) {
          queued.add(next.path);
          queue.push({
            path: next.path,
            referenced_by: current.path,
            keyword: directive.keyword,
          });
        }
      }
    });
  }

  validation.visited_files = visited.size;
  return sortValidation(validation);
}

export function validateKconfigSourceReferences({ paths, directives, architecture }) {
  const pathSet = new Set(paths);
  const validation = {
    checked: true,
    root: "Kconfig",
    architecture: sourceArch(architecture),
    visited_files: new Set(directives.map((item) => item.referenced_by)).size,
    missing_sources: [],
    skipped_sources: [],
    capped: false,
  };

  for (const directive of directives) {
    if (directive.optional) continue;
    const next = referencedPath(directive.referenced_by, directive, architecture);
    if (!next.path) {
      validation.skipped_sources.push({
        source: directive.source,
        referenced_by: directive.referenced_by,
        keyword: directive.keyword,
        reason: next.reason,
      });
      continue;
    }
    if (!pathSet.has(next.path)) {
      validation.missing_sources.push({
        path: next.path,
        referenced_by: directive.referenced_by,
        keyword: directive.keyword,
      });
    }
  }

  return sortValidation(validation);
}

export function kconfigMissingReasons(validation, limit = 4) {
  const missing = validation?.missing_sources || [];
  const reasons = missing.slice(0, limit).map(missingReason);
  if (missing.length > limit) {
    reasons.push(`Kernel Kconfig has ${missing.length - limit} more missing mandatory source references.`);
  }
  return reasons;
}

export async function validateKernelKconfigSources({
  ownerRepo,
  ref,
  architecture,
  repoText,
  repoTree = null,
  maxFiles = defaultMaxFiles,
  concurrency = defaultConcurrency,
}) {
  if (repoTree) {
    return validateFromTree({ ownerRepo, ref, architecture, repoText, repoTree, maxFiles, concurrency });
  }

  const validation = {
    checked: false,
    root: "Kconfig",
    architecture: sourceArch(architecture),
    visited_files: 0,
    missing_sources: [],
    skipped_sources: [],
    capped: false,
  };

  if (!ownerRepo || !ref) return validation;

  const queue = [{ path: "Kconfig", referenced_by: "", keyword: "root" }];
  const visited = new Set();

  while (queue.length > 0) {
    if (visited.size >= maxFiles) {
      validation.capped = true;
      break;
    }

    const current = queue.shift();
    if (visited.has(current.path)) continue;
    visited.add(current.path);

    let text = "";
    try {
      text = await repoText(ownerRepo, ref, current.path);
    } catch (error) {
      if (isMissingTextError(error)) {
        validation.missing_sources.push({
          path: current.path,
          referenced_by: current.referenced_by || "<root>",
          keyword: current.keyword,
        });
        continue;
      }
      throw error;
    }

    validation.checked = true;
    for (const directive of extractSourceDirectives(text)) {
      if (directive.optional) continue;

      const next = referencedPath(current.path, directive, architecture);
      if (!next.path) {
        validation.skipped_sources.push({
          source: directive.source,
          referenced_by: current.path,
          keyword: directive.keyword,
          reason: next.reason,
        });
        continue;
      }

      if (!visited.has(next.path)) {
        queue.push({
          path: next.path,
          referenced_by: current.path,
          keyword: directive.keyword,
        });
      }
    }
  }

  validation.visited_files = visited.size;
  return sortValidation(validation);
}
