#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// @ref LLP 0266#d10-acceptance-harness-direction-for-oq2 — statically qualify
// the shared Coterie source and frozen sm-* vocabulary without claiming the
// separately owed real-browser, native-host, or Clique-tree executions.
const REPOSITORY = fileURLToPath(new URL("../../../../", import.meta.url));
const COTERIE = resolve(REPOSITORY, "demos/coterie");
const SOURCES = [
  "benchmarks/tools/social-messenger/CONTRACT.md",
  "demos/coterie/src/main.native.tsx",
  "demos/coterie/src/app/route-modules.native.ts",
  "demos/coterie/src/app/routes.runtime.native.core.ts",
  "demos/coterie/scripts/check-sm-vocabulary.mjs",
  "demos/coterie/package.json",
];

function usage() {
  return "Usage: node w9-host-preflight.mjs --out <receipt.json>";
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  if (argv.length !== 2 || argv[0] !== "--out" || !argv[1]) throw new Error(usage());
  return { out: resolve(argv[1]) };
}

function run(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (status, signal) => resolvePromise({ status, signal, stdout, stderr }));
  });
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(`${usage()}\n`); return; }
  const startedAt = new Date().toISOString();
  const result = await run("bun", ["run", "verify:coterie"], {
    cwd: COTERIE,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const sources = [];
  for (const path of SOURCES) {
    sources.push({ path, sha256: digest(await readFile(resolve(REPOSITORY, path))) });
  }
  const receipt = {
    schemaVersion: "social-messenger.w9-host-preflight.v1",
    startedAt,
    completedAt: new Date().toISOString(),
    command: "bun run verify:coterie",
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    signal: result.signal,
    stdoutSha256: digest(result.stdout),
    stderrSha256: digest(result.stderr),
    sources,
    proved: {
      generatedProviderFreshness: result.status === 0,
      frozenSmVocabulary: result.status === 0,
      nativeEntryTypecheck: result.status === 0,
      platformSplits: result.status === 0,
      webBundle: result.status === 0,
    },
    notClaimed: [
      "two simultaneous browser contexts in the real Coterie product",
      "iOS native bundle launch and semantic interaction artifact",
      "macOS run through a compatible Exact host",
      "unchanged normalized sm-* tree relative to Clique",
    ],
  };
  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(receipt, null, 2)}\n`);
  if (result.status !== 0) {
    throw new Error(`Coterie W9 host preflight failed (${result.status ?? result.signal})\n${result.stdout}\n${result.stderr}`);
  }
  process.stdout.write(`W9 HOST PREFLIGHT PASS ${JSON.stringify({ receipt: options.out })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
