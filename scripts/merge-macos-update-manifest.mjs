#!/usr/bin/env node
/**
 * 把两个 macOS 架构各自的 electron-builder manifest（`latest-mac.yml`）合并成一份。
 *
 * 为什么需要：electron-builder 每次只为一个架构产出 manifest，里面只列该架构的 dmg/zip。
 * GitHub Release 只能有一份同名资产，后上传的会覆盖先上传的，另一个架构的客户端就会拿到
 * 不匹配的下载地址。electron-updater 会按文件名里的架构后缀挑文件（arm64 找含 `arm64` 的
 * 那一条，x64 回落到第一条），所以合并成一份同时列出两侧文件即可两边都命中。
 *
 * 用法：node scripts/merge-macos-update-manifest.mjs <输入目录> <输出文件>
 * 输入目录里放 `latest-mac-arm64.yml` / `latest-mac-x64.yml`（只有一份也能工作）。
 *
 * 这里刻意不依赖任何 npm 包：release job 检出的是本元仓库，没有 node_modules。
 * manifest 的形状由 electron-builder 固定（version / files / path / sha512 / releaseDate），
 * 因此按行解析这一份已知结构，比引入 YAML 依赖更可控。
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [inputDirArg, outputFileArg] = process.argv.slice(2);
if (!inputDirArg || !outputFileArg) {
  console.error("usage: merge-macos-update-manifest.mjs <inputDir> <outputFile>");
  process.exit(1);
}
const inputDir = resolve(inputDirArg);
const outputFile = resolve(outputFileArg);

/** 去掉 YAML 标量两侧的引号。 */
function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** 只用单引号包住需要转义的值（含空格、冒号、井号等）。 */
function quoteIfNeeded(value) {
  const text = String(value ?? "");
  return /^[A-Za-z0-9._@/+=-]+$/.test(text) ? text : `'${text.replace(/'/g, "''")}'`;
}

function parseManifest(source, label) {
  const manifest = { version: "", files: [] };
  let currentFile = null;
  let inFiles = false;
  for (const rawLine of source.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const line = rawLine.replace(/\s+$/, "");
    if (/^files:/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles && /^\s*-\s+/.test(line)) {
      currentFile = {};
      manifest.files.push(currentFile);
      const inline = line.replace(/^\s*-\s+/, "");
      const [key, ...rest] = inline.split(":");
      currentFile[key.trim()] = unquote(rest.join(":"));
      continue;
    }
    if (inFiles && /^\s+\S/.test(line) && currentFile) {
      const [key, ...rest] = line.trim().split(":");
      currentFile[key.trim()] = unquote(rest.join(":"));
      continue;
    }
    inFiles = false;
    currentFile = null;
    const [key, ...rest] = line.split(":");
    if (rest.length === 0) continue;
    manifest[key.trim()] = unquote(rest.join(":"));
  }
  if (!manifest.version) {
    console.error(`[merge-macos-update-manifest] missing version in ${label}`);
    process.exit(1);
  }
  return manifest;
}

const names = (await readdir(inputDir)).filter((name) => name.endsWith(".yml")).sort();
if (names.length === 0) {
  console.error(`[merge-macos-update-manifest] no manifest found in ${inputDir}`);
  process.exit(1);
}
const manifests = [];
for (const name of names) {
  manifests.push(parseManifest(await readFile(join(inputDir, name), "utf8"), name));
}

// 两个架构由同一次流水线触发，版本正常一致；取最高的一份作为版本与 path 基准。
const compareVersions = (left, right) => {
  const leftParts = String(left ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};
const newest = manifests.reduce((current, candidate) =>
  compareVersions(candidate.version, current.version) > 0 ? candidate : current,
);

const files = [];
const seen = new Set();
for (const manifest of manifests) {
  for (const file of manifest.files) {
    if (!file?.url || seen.has(file.url)) continue;
    seen.add(file.url);
    files.push(file);
  }
}
if (files.length === 0) {
  console.error("[merge-macos-update-manifest] no files found in input manifests");
  process.exit(1);
}

const lines = [`version: ${quoteIfNeeded(newest.version)}`, "files:"];
for (const file of files) {
  lines.push(`  - url: ${quoteIfNeeded(file.url)}`);
  if (file.sha512) lines.push(`    sha512: ${quoteIfNeeded(file.sha512)}`);
  if (file.size !== undefined) lines.push(`    size: ${file.size}`);
}
lines.push(`path: ${quoteIfNeeded(newest.path ?? files[0].url)}`);
if (newest.sha512) lines.push(`sha512: ${quoteIfNeeded(newest.sha512)}`);
if (newest.releaseDate) lines.push(`releaseDate: ${quoteIfNeeded(newest.releaseDate)}`);
if (newest.minimumSystemVersion) {
  lines.push(`minimumSystemVersion: ${quoteIfNeeded(newest.minimumSystemVersion)}`);
}
if (newest.stagingPercentage !== undefined) {
  lines.push(`stagingPercentage: ${newest.stagingPercentage}`);
}

await writeFile(outputFile, `${lines.join("\n")}\n`, "utf8");
console.log(
  `[merge-macos-update-manifest] version=${newest.version} files=${files.length} -> ${outputFile}`,
);
for (const file of files) console.log(`  - ${file.url}`);
