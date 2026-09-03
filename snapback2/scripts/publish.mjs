#!/usr/bin/env node
// Publish snapback2 to npm: stage immutable tarballs, then converge the
// platform package and shim to that exact pair. `--dry-run` commits neither.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
import { basename, dirname, isAbsolute, resolve } from "node:path";
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

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadResume(path, name, version) {
  if (!existsSync(path)) return undefined;
  const resume = JSON.parse(readFileSync(path, "utf8"));
  if (resume.name !== name
    || resume.version !== version
    || !Array.isArray(resume.artifacts)
    || !/^[a-f0-9]{64}$/.test(resume.mediaDigest ?? "")) return undefined;
  for (const artifact of resume.artifacts) {
    if (!existsSync(artifact.tarball) || sri(artifact.tarball) !== artifact.integrity) return undefined;
  }
  return resume;
}

function requireFullMediaHelper(mediaBin, run = command) {
  const result = run(mediaBin, ["capabilities"]);
  const stdout = result.stdout ?? "";
  if (Buffer.byteLength(stdout, "utf8") > 4096
    || !stdout.endsWith("\n")
    || stdout.indexOf("\n") !== stdout.length - 1) {
    throw new Error("snapback2-media capabilities exceeded the one-line stdout ceiling");
  }
  let capabilities;
  try {
    capabilities = JSON.parse(stdout);
  } catch {
    throw new Error("snapback2-media did not report valid capabilities JSON");
  }
  if (capabilities?.images !== true || capabilities?.heic !== true) {
    throw new Error("refusing to publish snapback2-media without the images and heic features");
  }
}

function machODependencies(path, inspect = command) {
  const output = inspect("otool", ["-L", path]).stdout ?? "";
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().replace(/ \(compatibility version.*$/, ""))
    .filter(Boolean);
}

function isSystemMacDependency(path) {
  return path.startsWith("/usr/lib/") || path.startsWith("/System/Library/");
}

function verifySelfContainedMediaHelper(mediaBin, inspect = command, platform = process.platform) {
  if (platform !== "darwin") {
    throw new Error(`refusing to publish snapback2-media: self-contained dependency qualification is not implemented for ${platform}`);
  }
  const directory = dirname(mediaBin);
  const queue = [mediaBin];
  const seen = new Set();
  const files = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    files.push(current);
    for (const dependency of machODependencies(current, inspect)) {
      if (isSystemMacDependency(dependency)) continue;
      if (isAbsolute(dependency)) {
        throw new Error(`refusing to publish snapback2-media with absolute dependency ${dependency}`);
      }
      if (!dependency.startsWith("@loader_path/")) {
        throw new Error(`refusing to publish snapback2-media with non-relocatable dependency ${dependency}`);
      }
      const local = resolve(dirname(current), dependency.slice("@loader_path/".length));
      if (dirname(local) !== directory || !existsSync(local)) {
        throw new Error(`refusing to publish snapback2-media with missing bundled dependency ${dependency}`);
      }
      queue.push(local);
    }
  }
  return files;
}

function makeMediaHelperSelfContained(mediaBin, inspect = command, rewrite = command) {
  if (process.platform !== "darwin") {
    verifySelfContainedMediaHelper(mediaBin, inspect);
    return [mediaBin];
  }
  const direct = machODependencies(mediaBin, inspect);
  if (!direct.some((dependency) => isAbsolute(dependency) && !isSystemMacDependency(dependency))) {
    return verifySelfContainedMediaHelper(mediaBin, inspect);
  }

  const sourceDependencies = new Map();
  const queue = [mediaBin];
  const seen = new Set();
  const nativeSources = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    // `otool -L` reports a dylib's install ID as its first entry. `-id`
    // rewrites that entry below; it is not a load command or another file in
    // the closure.
    const inspected = machODependencies(current, inspect);
    const dependencies = current === mediaBin ? inspected : inspected.slice(1);
    sourceDependencies.set(current, dependencies);
    for (const dependency of dependencies) {
      if (isSystemMacDependency(dependency)) continue;
      if (!isAbsolute(dependency)) {
        throw new Error(`cannot bundle non-absolute media dependency ${dependency}`);
      }
      if (!existsSync(dependency)) {
        throw new Error(`cannot bundle missing media dependency ${dependency}`);
      }
      const name = basename(dependency);
      const prior = nativeSources.get(name);
      if (prior && prior !== dependency) {
        throw new Error(`cannot bundle colliding media dependencies ${prior} and ${dependency}`);
      }
      nativeSources.set(name, dependency);
      queue.push(dependency);
    }
  }

  const directory = dirname(mediaBin);
  const stagedBySource = new Map([[mediaBin, mediaBin]]);
  for (const [name, source] of nativeSources) {
    const destination = resolve(directory, name);
    rmSync(destination, { force: true });
    copyFileSync(source, destination);
    chmodSync(destination, 0o755);
    stagedBySource.set(source, destination);
  }
  for (const [source, destination] of stagedBySource) {
    if (source !== mediaBin) {
      rewrite("install_name_tool", ["-id", `@loader_path/${basename(destination)}`, destination]);
    }
    for (const dependency of sourceDependencies.get(source) ?? []) {
      if (isAbsolute(dependency) && !isSystemMacDependency(dependency)) {
        rewrite("install_name_tool", [
          "-change",
          dependency,
          `@loader_path/${basename(dependency)}`,
          destination,
        ]);
      }
    }
  }
  // Homebrew dylibs are ad-hoc signed. Rewriting their Mach-O commands
  // invalidates those signatures, and macOS otherwise kills the helper before
  // it can emit protocol JSON. Sign only after every file has been rewritten.
  for (const destination of stagedBySource.values()) {
    rewrite("codesign", ["--force", "--sign", "-", destination]);
  }
  return verifySelfContainedMediaHelper(mediaBin, inspect);
}

function qualifyStagedMedia(staged, platformName, options = {}) {
  const platformArtifact = staged.artifacts.find((artifact) => artifact.name === platformName);
  if (!platformArtifact) throw new Error(`staged publication has no ${platformName} artifact`);
  const directory = mkdtempSync(resolve(tmpdir(), "snapback2-media-qualify-"));
  try {
    (options.extract ?? command)("tar", ["-xzf", platformArtifact.tarball, "-C", directory]);
    const mediaBin = resolve(directory, "package/bin/snapback2-media");
    if (!existsSync(mediaBin)) throw new Error("staged platform tarball has no snapback2-media helper");
    requireFullMediaHelper(mediaBin, options.run ?? command);
    (options.verifyDependencies ?? verifySelfContainedMediaHelper)(mediaBin);
    const digest = sha256(mediaBin);
    if (staged.mediaDigest !== undefined && staged.mediaDigest !== digest) {
      throw new Error(`staged snapback2-media digest ${digest} does not match resume record ${staged.mediaDigest}`);
    }
    staged.mediaDigest = digest;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return staged;
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

function prepare(version, name, stateDirectory) {
  rmSync(stateDirectory, { recursive: true, force: true });
  mkdirSync(stateDirectory, { recursive: true });
  // @ref LLP 1006#14a-codecs-live-in-a-separate-executable-the-type-does-not — the one published helper carries every admitted image codec.
  command("cargo", [
    "build",
    "--quiet",
    "--profile",
    "production",
    "-p",
    "snapback2-media",
    "--features",
    "images,heic",
  ], { stdio: "inherit" });
  const mediaBin = resolve(root, "target/production/snapback2-media");
  const mediaFiles = makeMediaHelperSelfContained(mediaBin);
  requireFullMediaHelper(mediaBin);
  verifySelfContainedMediaHelper(mediaBin);
  const mediaBytes = mediaFiles.reduce((bytes, path) => bytes + statSync(path).size, 0);

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
  for (const mediaFile of mediaFiles) {
    copyFileSync(mediaFile, resolve(platformStage, "bin", basename(mediaFile)));
  }
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
    mediaBin,
    mediaBytes,
    withoutEngine,
    withoutEngineBytes,
    withEngineBytes,
    artifacts: [
      { name, version, ...platformPack },
      { name: "snapback2", version, ...shimPack },
    ],
  };
  return resume;
}

function stagePublication(version, name, stateDirectory, resumePath, options = {}) {
  const dryRun = options.dryRun ?? dry;
  const prepareArtifacts = options.prepareArtifacts ?? prepare;
  const qualifyArtifacts = options.qualifyArtifacts
    ?? ((staged) => qualifyStagedMedia(staged, name));
  if (!dryRun) {
    const staged = loadResume(resumePath, name, version)
      ?? prepareArtifacts(version, name, stateDirectory);
    qualifyArtifacts(staged);
    writeFileSync(resumePath, `${JSON.stringify(staged, null, 2)}\n`);
    return {
      staged,
      cleanup() {},
    };
  }

  mkdirSync(dirname(stateDirectory), { recursive: true });
  const dryStateDirectory = mkdtempSync(`${stateDirectory}.dry-`);
  try {
    return {
      staged: qualifyArtifacts(prepareArtifacts(version, name, dryStateDirectory)),
      cleanup() {
        rmSync(dryStateDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(dryStateDirectory, { recursive: true, force: true });
    throw error;
  }
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

    requireFullMediaHelper("snapback2-media", () => ({
      stdout: '{"images":true,"heic":true}\n',
    }));
    assert.throws(() => requireFullMediaHelper("snapback2-media", () => ({
      stdout: '{"images":true,"heic":true}\n\n',
    })), /one-line stdout ceiling/);
    assert.throws(() => requireFullMediaHelper("snapback2-media", () => ({
      stdout: '{"images":true,"heic":false}\n',
    })), /refusing to publish snapback2-media without the images and heic features/);
    assert.throws(() => verifySelfContainedMediaHelper(
      "snapback2-media",
      (_cmd, argv) => ({
        stdout: `${argv[1]}:\n\t/opt/homebrew/opt/libheif/lib/libheif.1.dylib (compatibility version 17.0.0)\n`,
      }),
      "darwin",
    ), /absolute dependency \/opt\/homebrew\/opt\/libheif/);

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

    const durable = resolve(directory, "durable");
    mkdirSync(durable, { recursive: true });
    const oldPlatform = resolve(durable, "old-platform.tgz");
    const oldShim = resolve(durable, "old-shim.tgz");
    const oldMedia = resolve(durable, "snapback2-media");
    writeFileSync(oldPlatform, "published platform bytes");
    writeFileSync(oldShim, "missing shim bytes");
    writeFileSync(oldMedia, "published media bytes");
    const durableResume = resolve(durable, "resume.json");
    writeFileSync(durableResume, `${JSON.stringify({
      name: "snapback2-test-platform",
      version: "0.0.1",
      mediaBin: oldMedia,
      mediaDigest: sha256(oldMedia),
      artifacts: [
        { ...artifacts[0], tarball: oldPlatform, integrity: sri(oldPlatform) },
        { ...artifacts[1], tarball: oldShim, integrity: sri(oldShim) },
      ],
    })}\n`);
    const dryStage = stagePublication(
      "0.0.1",
      "snapback2-test-platform",
      durable,
      durableResume,
      {
        dryRun: true,
        prepareArtifacts(_version, _name, dryDirectory) {
          rmSync(dryDirectory, { recursive: true, force: true });
          mkdirSync(dryDirectory, { recursive: true });
          const rebuilt = resolve(dryDirectory, "rebuilt.tgz");
          writeFileSync(rebuilt, "different rebuilt bytes");
          return { artifacts: [{ ...artifacts[0], tarball: rebuilt, integrity: sri(rebuilt) }] };
        },
        qualifyArtifacts(staged) {
          return staged;
        },
      },
    );
    assert.notEqual(dryStage.staged.artifacts[0].integrity, sri(oldPlatform));
    assert.equal(loadResume(durableResume, "snapback2-test-platform", "0.0.1")?.artifacts[0].integrity, sri(oldPlatform));
    dryStage.cleanup();
    assert.equal(existsSync(oldPlatform), true);
    assert.equal(existsSync(oldShim), true);

    const badRoot = resolve(directory, "resume-without-heic");
    const badPackageBin = resolve(badRoot, "package/bin");
    mkdirSync(badPackageBin, { recursive: true });
    const badHelper = resolve(badPackageBin, "snapback2-media");
    writeFileSync(badHelper, "#!/bin/sh\nprintf '%s\\n' '{\"images\":true,\"heic\":false}'\n");
    chmodSync(badHelper, 0o755);
    const badTarball = resolve(badRoot, "platform.tgz");
    command("tar", ["-czf", badTarball, "package"], { cwd: badRoot });
    const badShim = resolve(badRoot, "shim.tgz");
    writeFileSync(badShim, "shim");
    const badResume = resolve(badRoot, "resume.json");
    writeFileSync(badResume, `${JSON.stringify({
      name: "snapback2-test-platform",
      version: "0.0.1",
      mediaDigest: sha256(badHelper),
      artifacts: [
        { ...artifacts[0], tarball: badTarball, integrity: sri(badTarball) },
        { ...artifacts[1], tarball: badShim, integrity: sri(badShim) },
      ],
    })}\n`);
    assert.throws(() => stagePublication(
      "0.0.1",
      "snapback2-test-platform",
      badRoot,
      badResume,
      {
        dryRun: false,
        qualifyArtifacts(staged) {
          return qualifyStagedMedia(staged, "snapback2-test-platform", {
            verifyDependencies() {},
          });
        },
      },
    ), /refusing to publish snapback2-media without the images and heic features/);

    writeFileSync(badHelper, "#!/bin/sh\nprintf '%s\\n' '{\"images\":true,\"heic\":true}'\n");
    command("tar", ["-czf", badTarball, "package"], { cwd: badRoot });
    writeFileSync(badResume, `${JSON.stringify({
      name: "snapback2-test-platform",
      version: "0.0.1",
      mediaDigest: "0".repeat(64),
      artifacts: [
        { ...artifacts[0], tarball: badTarball, integrity: sri(badTarball) },
        { ...artifacts[1], tarball: badShim, integrity: sri(badShim) },
      ],
    })}\n`);
    assert.throws(() => stagePublication(
      "0.0.1",
      "snapback2-test-platform",
      badRoot,
      badResume,
      {
        dryRun: false,
        qualifyArtifacts(staged) {
          return qualifyStagedMedia(staged, "snapback2-test-platform", {
            verifyDependencies() {},
          });
        },
      },
    ), /does not match resume record/);
    console.log("publish self-test ok; staged helper qualified; resume without HEIC refused; helper digest bound; durable dry-run resume preserved");
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
  const publication = stagePublication(version, name, stateDirectory, resumePath);
  const staged = publication.staged;

  try {
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
      `published ${name}@${version} (engine ${(bytes / 1e6).toFixed(1)} MB; media ${(staged.mediaBytes / 1e6).toFixed(1)} MB; no-engine ${(staged.withoutEngineBytes / 1e6).toFixed(1)} MB) + snapback2@${version} in ${seconds}s${dry ? " (dry run)" : ""}`,
    );
    const metric = {
      at: new Date().toISOString(),
      publish_s: seconds,
      production_binary_bytes: bytes,
      production_binary_without_engine_bytes: staged.withoutEngineBytes,
      production_binary_with_engine_bytes: staged.withEngineBytes,
      production_media_binary_bytes: staged.mediaBytes,
      engine: staged.withoutEngine ? "none (explicit override)" : "ibex2 + vanilla hermes",
      dry,
    };
    writeFileSync(resolve(root, "metrics/loop.jsonl"), `${JSON.stringify(metric)}\n`, { flag: "a" });
    console.log(`metric ${JSON.stringify(metric)}`);
  } finally {
    publication.cleanup();
  }
}

try {
  if (selfTest) runSelfTest();
  else main();
} catch (error) {
  console.error(`publish: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
