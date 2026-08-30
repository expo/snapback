#!/usr/bin/env node
// Publish snapback2 to npm: the platform binary package, then the shim. Meant to
// take seconds and run constantly. `--dry-run` passes through to npm publish.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry-run");
const sh = (cmd, argv, cwd = root) => {
  const r = spawnSync(cmd, argv, { cwd, stdio: "inherit" });
  if (r.status !== 0) { console.error(`publish: ${cmd} ${argv.join(" ")} failed`); process.exit(r.status ?? 1); }
};
const t0 = performance.now();
const version = /^version = "([^"]+)"/m.exec(readFileSync(resolve(root, "Cargo.toml"), "utf8"))[1];
const shimPkg = JSON.parse(readFileSync(resolve(root, "packages/snapback2/package.json"), "utf8"));
if (shimPkg.version !== version) { console.error(`publish: packages/snapback2 is ${shimPkg.version}, Cargo workspace is ${version}`); process.exit(2); }

const bin = resolve(root, "target/production/snapback2");
sh("cargo", ["build", "--quiet", "--profile", "production", "-p", "snapback2"]);
const withoutEngineBytes = statSync(bin).size;
const withoutEngine = process.env.SNAPBACK2_PUBLISH_WITHOUT_ENGINE === "1";
let withEngineBytes = null;
if (withoutEngine) {
  console.error("publish: WARNING SNAPBACK2_PUBLISH_WITHOUT_ENGINE=1 — shipping an engine-less binary by explicit override");
} else {
  const built = spawnSync(resolve(root, "scripts/hermes"), ["build", "--quiet", "--profile", "production", "-p", "snapback2"], {
    cwd: root,
    stdio: "inherit",
  });
  if (built.status !== 0) {
    console.error("publish: refusing an engine-less artifact; prepare vanilla Hermes or set SNAPBACK2_PUBLISH_WITHOUT_ENGINE=1 explicitly");
    process.exit(built.status ?? 1);
  }
  const doctor = spawnSync(bin, ["doctor", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      SNAPBACK2_COMPILER: resolve(root, "packages/snapback2/dist/compiler.mjs"),
    },
  });
  if (doctor.status !== 0 || !doctor.stdout.includes('"effects":"ibex2 + vanilla hermes"')) {
    console.error("publish: refusing artifact because its doctor output does not report the effects engine");
    process.exit(1);
  }
  withEngineBytes = statSync(bin).size;
}
const platform = `${process.platform}-${process.arch}`;
const name = `snapback2-${platform}`;
const dir = resolve(root, "dist/npm", name);
rmSync(dir, { recursive: true, force: true }); mkdirSync(resolve(dir, "bin"), { recursive: true });
copyFileSync(bin, resolve(dir, "bin/snapback2"));
writeFileSync(resolve(dir, "package.json"), JSON.stringify({
  name, version, description: `Snapback 2 binary for ${platform}`, license: "MIT",
  os: [process.platform], cpu: [process.arch], files: ["bin"],
  repository: { type: "git", url: "git+https://github.com/expo/snapback.git", directory: "snapback2" },
}, null, 2) + "\n");
const flags = ["publish", "--access", "public", ...(dry ? ["--dry-run"] : [])];
sh("npm", flags, dir);
sh("npm", flags, resolve(root, "packages/snapback2"));
const seconds = ((performance.now() - t0) / 1000).toFixed(1);
const bytes = statSync(bin).size;
console.log(`published ${name}@${version} (${(bytes / 1e6).toFixed(1)} MB; no-engine ${(withoutEngineBytes / 1e6).toFixed(1)} MB) + snapback2@${version} in ${seconds}s${dry ? " (dry run)" : ""}`);
const metric = {
  at: new Date().toISOString(),
  publish_s: +seconds,
  production_binary_bytes: bytes,
  production_binary_without_engine_bytes: withoutEngineBytes,
  production_binary_with_engine_bytes: withEngineBytes,
  engine: withoutEngine ? "none (explicit override)" : "ibex2 + vanilla hermes",
  dry,
};
writeFileSync(resolve(root, "metrics/loop.jsonl"), JSON.stringify(metric) + "\n", { flag: "a" });
console.log(`metric ${JSON.stringify(metric)}`);
