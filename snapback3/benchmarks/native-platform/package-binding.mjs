import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { lstat, mkdir, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { assert } from "./harness-proof.mjs";

const execFile = promisify(execFileCallback);
const sha256 = value => createHash("sha256").update(value).digest("hex");

async function fileSha256(path) {
  return sha256(await readFile(path));
}

async function walkPayload(root) {
  const entries = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(root, path).split(sep).join("/");
      const info = await lstat(path);
      if (info.isDirectory()) await walk(path);
      else if (info.isFile()) entries.push({ path: name, type: "file", bytes: info.size, sha256: await fileSha256(path) });
      else if (info.isSymbolicLink()) entries.push({ path: name, type: "symlink", target: await readlink(path) });
      else throw new Error(`unsupported package payload entry ${path}`);
    }
  }
  await walk(root);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

export function comparePackagePayload(expected, actual, label = "package payload") {
  const expectedByPath = new Map(expected.map(entry => [entry.path, entry]));
  const actualByPath = new Map(actual.map(entry => [entry.path, entry]));
  const paths = [...new Set([...expectedByPath.keys(), ...actualByPath.keys()])].sort();
  const mismatches = paths.flatMap(path => {
    const left = expectedByPath.get(path);
    const right = actualByPath.get(path);
    return JSON.stringify(left) === JSON.stringify(right) ? [] : [{ path, expected: left ?? null, actual: right ?? null }];
  });
  assert(mismatches.length === 0, `${label} differs: ${JSON.stringify(mismatches.slice(0, 8))}`);
  return { files: actual.filter(entry => entry.type === "file").length,
    symlinks: actual.filter(entry => entry.type === "symlink").length,
    manifestSha256: sha256(JSON.stringify(actual)) };
}

async function resolveInstalledPackage(appRoot) {
  const requireFromApp = createRequire(pathToFileURL(join(appRoot, "App.tsx")));
  const candidates = (requireFromApp.resolve.paths("snapback3") ?? [])
    .map(nodeModules => join(nodeModules, "snapback3"));
  const installed = [];
  for (const candidate of candidates) {
    try {
      const packageJson = JSON.parse(await readFile(join(candidate, "package.json"), "utf8"));
      if (packageJson.name === "snapback3") installed.push({ root: await realpath(candidate), packageJson });
    } catch {}
  }
  assert(installed.length === 1,
    `app dependency graph did not resolve exactly one snapback3 package: ${JSON.stringify(installed.map(item => item.root))}`);
  const target = installed[0].packageJson.exports?.["./expo"]?.import;
  assert(typeof target === "string" && target.startsWith("./"), "snapback3/expo has no import export target");
  const entry = await realpath(resolve(installed[0].root, target));
  assert(entry.startsWith(`${installed[0].root}${sep}`), `snapback3/expo resolved outside installed package: ${entry}`);
  return { ...installed[0], entry, entryRelative: relative(installed[0].root, entry).split(sep).join("/") };
}

export async function extractArchivePayload(archivePath, destination) {
  await mkdir(destination, { recursive: true });
  assert((await readdir(destination)).length === 0, `archive extraction destination is not empty: ${destination}`);
  await execFile("tar", ["-xzf", archivePath, "-C", destination], { maxBuffer: 16 * 1024 * 1024 });
  const packageRoot = join(destination, "package");
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert(packageJson.name === "snapback3", `archive payload is not snapback3: ${JSON.stringify(packageJson.name)}`);
  return packageRoot;
}

export async function verifyInstalledPackage({ archivePath, archivePackageRoot, appRoot,
  expectedArchiveSha256, label }) {
  const archiveSha256 = await fileSha256(archivePath);
  assert(archiveSha256 === expectedArchiveSha256,
    `${label} archive SHA-256 differs: expected ${expectedArchiveSha256}, found ${archiveSha256}`);
  const resolved = await resolveInstalledPackage(appRoot);
  const archiveManifest = await walkPayload(archivePackageRoot);
  const installedManifest = await walkPayload(resolved.root);
  const comparison = comparePackagePayload(archiveManifest, installedManifest, label);
  return { label, checkedAt: new Date().toISOString(), archivePath, archiveSha256,
    archivePackageRoot, installedRoot: resolved.root, resolvedEntry: resolved.entry,
    resolvedEntryRelative: resolved.entryRelative, ...comparison, archiveManifest, installedManifest };
}

function sourceRelative(source) {
  const marker = "node_modules/snapback3/";
  const decoded = decodeURIComponent(String(source));
  const index = decoded.lastIndexOf(marker);
  return index < 0 ? null : decoded.slice(index + marker.length).split(/[?#]/, 1)[0];
}

export function verifyMetroSourceMap({ sourceMapBytes, packageBinding, bundleSha256, bundleBytes, bundleUrl }) {
  const map = JSON.parse(sourceMapBytes.toString("utf8"));
  assert(Array.isArray(map.sources) && Array.isArray(map.sourcesContent)
    && map.sources.length === map.sourcesContent.length, "Metro source map lacks aligned sourcesContent");
  const installed = new Map(packageBinding.installedManifest.map(entry => [entry.path, entry]));
  const modules = [];
  for (let index = 0; index < map.sources.length; index++) {
    const path = sourceRelative(map.sources[index]);
    if (path === null) continue;
    const content = map.sourcesContent[index];
    assert(typeof content === "string", `Metro omitted sourcesContent for installed snapback3 module ${path}`);
    const installedEntry = installed.get(path);
    assert(installedEntry?.type === "file", `Metro resolved snapback3 source outside archive payload: ${path}`);
    const contentSha256 = sha256(Buffer.from(content));
    assert(contentSha256 === installedEntry.sha256,
      `Metro sourcesContent differs from installed snapback3 module ${path}`);
    modules.push({ source: map.sources[index], path, bytes: Buffer.byteLength(content), sha256: contentSha256 });
  }
  modules.sort((left, right) => left.path.localeCompare(right.path));
  assert(modules.some(module => module.path === packageBinding.resolvedEntryRelative),
    `Metro source map does not contain resolved snapback3/expo entry ${packageBinding.resolvedEntryRelative}`);
  assert(new Set(modules.map(module => module.path)).size === modules.length,
    `Metro source map contains duplicate snapback3 module identities: ${JSON.stringify(modules)}`);
  return { checkedAt: new Date().toISOString(), bundleUrl, bundleBytes, bundleSha256,
    sourceMapBytes: sourceMapBytes.length, sourceMapSha256: sha256(sourceMapBytes),
    resolvedEntry: packageBinding.resolvedEntry, modules };
}
