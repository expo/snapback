#!/usr/bin/env node
// @ref LLP 1013#8-the-bundle-and-its-size — measure emitted bytecode, not its filename.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { workspace, packageRoot, project, dist, environment, prepareExpoProject, run, walk } from "./expo-project.mjs";
import { attributeBundle } from "./witness-expo/attribution.mjs";
const { cli } = await prepareExpoProject();
const bytecodeDir = resolve(workspace, "target/e2-expo-export");
const analysisDir = resolve(workspace, "target/e2-expo-analysis");
const env = { ...environment, EXPO_OFFLINE: "1", EXPO_PUBLIC_SNAPBACK_WITNESS: "", EXPO_PUBLIC_SNAPBACK_URL: "http://127.0.0.1:3210" };
const commands = [
  ["export", "--platform", "ios", "--clear", "--source-maps", "--output-dir", bytecodeDir],
  ["export", "--platform", "ios", "--clear", "--source-maps", "--no-bytecode", "--output-dir", analysisDir],
];
let log = "";
for (const args of commands) log += await run(process.execPath, [cli, ...args], { cwd: project, env });
await writeFile(resolve(workspace, "target/e2-expo-export.log"), log);
const hermes = [];
for (const path of await walk(bytecodeDir)) {
  const bytes = await readFile(path);
  if (bytes.subarray(0, 8).toString("hex") === "c61fbc03c103191f") hermes.push({ path, bytes });
}
if (hermes.length !== 1) throw new Error(`expected one Hermes artifact, found ${hermes.length}`);
const { path, bytes } = hermes[0];
if (bytes.includes(Buffer.from("barrier reached"))) throw new Error("production export contains the witness; clear the Metro environment");
const analysisPaths = await walk(analysisDir);
const jsPath = analysisPaths.find((path) => path.endsWith(".js") && path.includes("/ios/"));
if (!jsPath) throw new Error("analysis export did not emit iOS JavaScript");
const attribution = await attributeBundle(await readFile(jsPath, "utf8"), JSON.parse(await readFile(jsPath + ".map", "utf8")), dist);
if (!attribution.twinSubsetJsBytes || !attribution.clientIncludingTwinJsBytes) throw new Error("source maps did not attribute the client and twin");
const pkg = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
const record = { date: new Date().toISOString(), platform: "ios", expo: pkg.devDependencies.expo,
  reactNative: pkg.devDependencies["react-native"], artifact: relative(workspace, path),
  format: "Hermes bytecode", magic: bytes.subarray(0, 8).toString("hex"), bytes: bytes.length,
  gzipBytes: gzipSync(bytes, { level: 9 }).length, sha256: createHash("sha256").update(bytes).digest("hex"),
  attribution, method: "Scaffold chat --client expo; link local dist and installed SDK 54 dependencies; SDK 54 Metro watchFolders/nodeModulesPaths for linked packages; expo export --platform ios --clear --source-maps, inspect HBC magic; gzip level 9. Separate --clear --no-bytecode export for source-map attribution. Clear Metro for each export so EXPO_PUBLIC values cannot use a previous transform. Witness URL empty at Metro time; no simulator required.",
  commands: commands.map((args) => `expo ${args.join(" ")}`) };
await mkdir(resolve(workspace, "metrics"), { recursive: true });
await appendFile(resolve(workspace, "metrics/expo.jsonl"), JSON.stringify(record) + "\n");
console.log(JSON.stringify(record, null, 2));
