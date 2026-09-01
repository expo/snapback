#!/usr/bin/env node
// Publish snapback2 to npm: stage immutable tarballs, then converge the
// platform package and shim to that exact pair. `--dry-run` commits neither.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry-run");
const selfTest = process.argv.includes("--self-test");
const npm = process.env.SNAPBACK2_PUBLISH_NPM ?? "npm";

function command(cmd, argv, options = {}) {
  const result = spawnSync(cmd, argv, { cwd: root, encoding: "utf8", ...options });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`${cmd} ${argv.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function packageVersion() {
  const match = /^version = "([^"]+)"/m.exec(readFileSync(resolve(root, "Cargo.toml"), "utf8"));
  if (!match) throw new Error("Cargo workspace version is missing");
  const version = match[1];
  const shim = JSON.parse(readFileSync(resolve(root, "packages/snapback2/package.json"), "utf8"));
  if (shim.version !== version) {
    throw new Error(`packages/snapback2 is ${shim.version}, Cargo workspace is ${version}`);
  }
  return version;
}

function buildAndQualifyPackage(snapshot, buildPackage, qualify) {
  buildPackage(snapshot);
  const compiler = resolve(snapshot, "dist/compiler.mjs");
  if (!existsSync(compiler)) throw new Error(`package build did not stage ${compiler}`);
  qualify(compiler);
}

function pack(directory, stateDirectory) {
  const result = command(npm, [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    stateDirectory,
    directory,
  ]);
  const report = JSON.parse(result.stdout)[0];
  if (!report?.filename || !report?.integrity) throw new Error(`npm pack returned no artifact for ${directory}`);
  return {
    tarball: resolve(stateDirectory, report.filename),
    integrity: report.integrity,
  };
}

function sri(path) {
  return `sha512-${createHash("sha512").update(readFileSync(path)).digest("base64")}`;
}

function loadResume(path, name, version) {
  if (!existsSync(path)) return undefined;
  const resume = JSON.parse(readFileSync(path, "utf8"));
  if (resume.name !== name || resume.version !== version || !Array.isArray(resume.artifacts)) return undefined;
  for (const artifact of resume.artifacts) {
    if (!existsSync(artifact.tarball) || sri(artifact.tarball) !== artifact.integrity) return undefined;
  }
  return resume;
}

function registryIntegrity(name, version) {
  const result = spawnSync(npm, ["view", `${name}@${version}`, "dist.integrity", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status === 0) {
    const value = JSON.parse(result.stdout || "null");
    return typeof value === "string" ? value : undefined;
  }
  const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/E404|404 Not Found|is not in this registry/i.test(detail)) return undefined;
  throw new Error(`npm view ${name}@${version} failed\n${detail.trim()}`);
}

function convergeArtifacts(artifacts, lookup, publish) {
  for (const artifact of artifacts) {
    const published = lookup(artifact.name, artifact.version);
    if (published === artifact.integrity) {
      console.log(`publish: ${artifact.name}@${artifact.version} already matches staged artifact`);
      continue;
    }
    if (published !== undefined) {
      throw new Error(
        `${artifact.name}@${artifact.version} already exists with integrity ${published}; staged artifact is ${artifact.integrity}`,
      );
    }
    publish(artifact);
  }
}

function prepare(version, name, stateDirectory, resumePath) {
  rmSync(stateDirectory, { recursive: true, force: true });
  mkdirSync(stateDirectory, { recursive: true });
  command("cargo", ["build", "--quiet", "--profile", "production", "-p", "snapback2"], { stdio: "inherit" });
  const engineLessBin = resolve(root, "target/production/snapback2");
  const withoutEngineBytes = statSync(engineLessBin).size;
  const withoutEngine = process.env.SNAPBACK2_PUBLISH_WITHOUT_ENGINE === "1";
  let bin = engineLessBin;
  let withEngineBytes = null;
  if (withoutEngine) {
    console.error("publish: WARNING SNAPBACK2_PUBLISH_WITHOUT_ENGINE=1 — shipping an engine-less binary by explicit override");
  } else {
    command(resolve(root, "scripts/hermes"), ["build", "--quiet", "--profile", "production", "-p", "snapback2"], {
      stdio: "inherit",
    });
    bin = resolve(root, "target/hermes/production/snapback2");
    withEngineBytes = statSync(bin).size;
  }

  const shimStage = resolve(stateDirectory, "shim");
  buildAndQualifyPackage(
    shimStage,
    (snapshot) => command("node", [resolve(root, "packages/snapback2/build.mjs")], {
      stdio: "inherit",
      env: { ...process.env, SNAPBACK2_PACKAGE_BUILD_SNAPSHOT: snapshot },
    }),
    (compiler) => {
      const doctor = command(bin, ["doctor", "--json"], {
        env: { ...process.env, SNAPBACK2_COMPILER: compiler },
      });
      if (!withoutEngine && !doctor.stdout.includes('"effects":"ibex2 + vanilla hermes"')) {
        throw new Error("artifact doctor output does not report the effects engine");
      }
    },
  );

  const platform = `${process.platform}-${process.arch}`;
  const platformStage = resolve(stateDirectory, name);
  mkdirSync(resolve(platformStage, "bin"), { recursive: true });
  copyFileSync(bin, resolve(platformStage, "bin/snapback2"));
  writeFileSync(resolve(platformStage, "package.json"), `${JSON.stringify({
    name,
    version,
    description: `Snapback 2 binary for ${platform}`,
    license: "MIT",
    os: [process.platform],
    cpu: [process.arch],
    files: ["bin"],
    repository: { type: "git", url: "git+https://github.com/expo/snapback.git", directory: "snapback2" },
  }, null, 2)}\n`);

  const platformPack = pack(platformStage, stateDirectory);
  const shimPack = pack(shimStage, stateDirectory);
  const resume = {
    name,
    version,
    bin,
    withoutEngine,
    withoutEngineBytes,
    withEngineBytes,
    artifacts: [
      { name, version, ...platformPack },
      { name: "snapback2", version, ...shimPack },
    ],
  };
  if (!dry) writeFileSync(resumePath, `${JSON.stringify(resume, null, 2)}\n`);
  return resume;
}

function runSelfTest() {
  const directory = mkdtempSync(resolve(tmpdir(), "snapback2-publish-self-test-"));
  try {
    const snapshot = resolve(directory, "shim");
    let qualified = false;
    buildAndQualifyPackage(snapshot, (target) => {
      mkdirSync(resolve(target, "dist"), { recursive: true });
      writeFileSync(resolve(target, "dist/compiler.mjs"), "// built\n");
    }, (compiler) => {
      assert.equal(readFileSync(compiler, "utf8"), "// built\n");
      qualified = true;
    });
    assert.equal(qualified, true, "doctor ran before the clean package snapshot was built");

    const artifacts = [
      { name: "snapback2-test-platform", version: "0.0.1", integrity: "sha512-platform", tarball: "platform.tgz" },
      { name: "snapback2", version: "0.0.1", integrity: "sha512-shim", tarball: "shim.tgz" },
    ];
    const registry = new Map();
    const attempts = [];
    assert.throws(() => convergeArtifacts(artifacts,
      (name, version) => registry.get(`${name}@${version}`),
      (artifact) => {
        attempts.push(artifact.name);
        if (artifact.name === "snapback2") throw new Error("transient shim failure");
        registry.set(`${artifact.name}@${artifact.version}`, artifact.integrity);
      }), /transient shim failure/);
    convergeArtifacts(artifacts,
      (name, version) => registry.get(`${name}@${version}`),
      (artifact) => {
        attempts.push(artifact.name);
        registry.set(`${artifact.name}@${artifact.version}`, artifact.integrity);
      });
    assert.deepEqual(attempts, ["snapback2-test-platform", "snapback2", "snapback2"]);
    assert.throws(() => convergeArtifacts(
      [{ ...artifacts[0], integrity: "sha512-conflict" }],
      () => "sha512-platform",
      () => assert.fail("conflicting registry artifact was republished"),
    ), /already exists with integrity/);
    console.log("publish self-test ok");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function main() {
  const started = performance.now();
  const version = packageVersion();
  const platform = `${process.platform}-${process.arch}`;
  const name = `snapback2-${platform}`;
  const stateDirectory = resolve(root, "dist/npm", `publish-${name}-${version}`);
  const resumePath = resolve(stateDirectory, "resume.json");
  const resumed = dry ? undefined : loadResume(resumePath, name, version);
  const staged = resumed ?? prepare(version, name, stateDirectory, resumePath);

  if (dry) {
    for (const artifact of staged.artifacts) {
      command(npm, ["publish", artifact.tarball, "--access", "public", "--dry-run", "--ignore-scripts"], {
        stdio: "inherit",
      });
    }
  } else {
    convergeArtifacts(
      staged.artifacts,
      registryIntegrity,
      (artifact) => command(npm, ["publish", artifact.tarball, "--access", "public", "--ignore-scripts"], {
        stdio: "inherit",
      }),
    );
  }

  const seconds = +((performance.now() - started) / 1000).toFixed(1);
  const bytes = staged.withoutEngine ? staged.withoutEngineBytes : staged.withEngineBytes;
  console.log(
    `published ${name}@${version} (${(bytes / 1e6).toFixed(1)} MB; no-engine ${(staged.withoutEngineBytes / 1e6).toFixed(1)} MB) + snapback2@${version} in ${seconds}s${dry ? " (dry run)" : ""}`,
  );
  const metric = {
    at: new Date().toISOString(),
    publish_s: seconds,
    production_binary_bytes: bytes,
    production_binary_without_engine_bytes: staged.withoutEngineBytes,
    production_binary_with_engine_bytes: staged.withEngineBytes,
    engine: staged.withoutEngine ? "none (explicit override)" : "ibex2 + vanilla hermes",
    dry,
  };
  writeFileSync(resolve(root, "metrics/loop.jsonl"), `${JSON.stringify(metric)}\n`, { flag: "a" });
  console.log(`metric ${JSON.stringify(metric)}`);
}

try {
  if (selfTest) runSelfTest();
  else main();
} catch (error) {
  console.error(`publish: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
