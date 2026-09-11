#!/usr/bin/env node
// Publish snapback2 to npm: stage immutable tarballs, then converge the
// platform package and shim to that exact pair. `--dry-run` commits neither.
import {
  consumerSmoke,
  hostConsumerArtifacts,
  stagePlatformDependencies,
  verifyPlatformDependencies,
} from "./consumer-smoke.mjs";
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
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry-run");
const selfTest = process.argv.includes("--self-test");
const stageOnly = process.argv.includes("--stage-only");
const npm = process.env.SNAPBACK2_PUBLISH_NPM ?? "npm";
const npmEnvironment = {
  ...process.env,
  NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? resolve(root, "target/npm-cache"),
};
const cmake = process.env.SNAPBACK2_CMAKE
  ?? (process.platform === "darwin" && existsSync("/opt/homebrew/bin/cmake")
    ? "/opt/homebrew/bin/cmake"
    : "cmake");
const codecSources = [
  {
    name: "libde265",
    version: "1.1.2",
    url: "https://github.com/strukturag/libde265/releases/download/v1.1.2/libde265-1.1.2.tar.gz",
    sha256: "eaacd1943ab0c452c19f6136a36ca227e6b761b39a81eaca8454d48c147e1f67",
  },
  {
    name: "libheif",
    version: "1.23.3",
    url: "https://github.com/strukturag/libheif/releases/download/v1.23.3/libheif-1.23.3.tar.gz",
    sha256: "11c1179e0e4bec33624b87f22ec42c1e993a40d946d44d26f9c431cf1456a863",
  },
];

const de265CmakeOptions = [
  "-DCMAKE_BUILD_TYPE=Release",
  "-DCMAKE_POSITION_INDEPENDENT_CODE=ON",
  "-DCMAKE_INSTALL_LIBDIR=lib",
  "-DBUILD_SHARED_LIBS=OFF",
  "-DENABLE_SDL=OFF",
  "-DENABLE_DECODER=ON",
  "-DENABLE_ENCODER=OFF",
  "-DENABLE_SHERLOCK265=OFF",
  "-DENABLE_INTERNAL_DEVELOPMENT_TOOLS=OFF",
  "-DWITH_FUZZERS=OFF",
];

const libheifCmakeOptions = [
  "-DCMAKE_BUILD_TYPE=Release",
  "-DCMAKE_INSTALL_LIBDIR=lib",
  "-DBUILD_SHARED_LIBS=OFF",
  "-DBUILD_TESTING=OFF",
  "-DBUILD_DOCUMENTATION=OFF",
  "-DBUILD_DEVELOPMENT_TOOLS=OFF",
  "-DENABLE_PLUGIN_LOADING=OFF",
  "-DWITH_EXAMPLES=OFF",
  "-DWITH_EXAMPLE_HEIF_THUMB=OFF",
  "-DWITH_EXAMPLE_HEIF_VIEW=OFF",
  "-DWITH_GDK_PIXBUF=OFF",
  "-DWITH_LIBDE265=ON",
  "-DWITH_LIBDE265_PLUGIN=OFF",
  "-DWITH_X265=OFF",
  "-DWITH_KVAZAAR=OFF",
  "-DWITH_UVG266=OFF",
  "-DWITH_VVDEC=OFF",
  "-DWITH_VVENC=OFF",
  "-DWITH_X264=OFF",
  "-DWITH_OpenH264_DECODER=OFF",
  "-DWITH_DAV1D=OFF",
  "-DWITH_AOM_DECODER=OFF",
  "-DWITH_AOM_ENCODER=OFF",
  "-DWITH_SvtEnc=OFF",
  "-DWITH_RAV1E=OFF",
  "-DWITH_JPEG_DECODER=OFF",
  "-DWITH_JPEG_ENCODER=OFF",
  "-DWITH_OpenJPEG_DECODER=OFF",
  "-DWITH_OpenJPEG_ENCODER=OFF",
  "-DWITH_FFMPEG_DECODER=OFF",
  "-DWITH_OPENJPH_ENCODER=OFF",
  "-DWITH_UNCOMPRESSED_CODEC=OFF",
  "-DWITH_WEBCODECS=OFF",
  "-DWITH_LIBSHARPYUV=OFF",
  "-DWITH_HEADER_COMPRESSION=OFF",
  "-DWITH_FUZZERS=OFF",
  "-DCMAKE_DISABLE_FIND_PACKAGE_TIFF=ON",
  "-DCMAKE_DISABLE_FIND_PACKAGE_JPEG=ON",
  "-DCMAKE_DISABLE_FIND_PACKAGE_PNG=ON",
  "-DCMAKE_DISABLE_FIND_PACKAGE_WebP=ON",
];

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

function installSnapshotDependencies(snapshot) {
  command(npm, [
    "install",
    "--ignore-scripts",
    "--no-package-lock",
    "--omit=dev",
    "--omit=optional",
    "--omit=peer",
    "--no-audit",
    "--no-fund",
  ], { cwd: snapshot, env: npmEnvironment, stdio: "inherit" });
}

function buildAndQualifyPackage(
  snapshot,
  buildPackage,
  qualify,
  installDependencies = installSnapshotDependencies,
) {
  buildPackage(snapshot);
  installDependencies(snapshot);
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
  ], { env: npmEnvironment });
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

const platformIdentities = new Map([
  ["snapback2-darwin-arm64", { os: "darwin", cpu: "arm64" }],
  ["snapback2-linux-x64", { os: "linux", cpu: "x64" }],
]);

function platformArtifactPaths(argv = process.argv.slice(2)) {
  const paths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--platform-artifact") {
      const path = argv[index + 1];
      if (!path || path.startsWith("--")) throw new Error("--platform-artifact needs a staged resume.json path");
      paths.push(resolve(path));
      index += 1;
    } else if (argument.startsWith("--platform-artifact=")) {
      const path = argument.slice("--platform-artifact=".length);
      if (!path) throw new Error("--platform-artifact needs a staged resume.json path");
      paths.push(resolve(path));
    }
  }
  return paths;
}

function packedManifest(tarball) {
  const unpacked = command("tar", ["-xOzf", tarball, "package/package.json"]);
  try {
    return JSON.parse(unpacked.stdout);
  } catch {
    throw new Error(`staged platform artifact ${tarball} has invalid package metadata`);
  }
}

function portableTarballPath(receiptPath, recordedPath) {
  if (typeof recordedPath !== "string") return undefined;
  const besideReceipt = resolve(dirname(receiptPath), basename(recordedPath));
  if (existsSync(besideReceipt)) return besideReceipt;
  return existsSync(recordedPath) ? recordedPath : undefined;
}

function consumerEvidencePassed(consumer) {
  if (consumer?.verdict !== "pass" || !Array.isArray(consumer.steps)) return false;
  const steps = new Map(consumer.steps.map((step) => [step.name, step]));
  return steps.get("install tarballs")?.ok === true
    && steps.get("doctor")?.ok === true
    && steps.get("todos test")?.ok === true
    && steps.get("todos receipt")?.accepted === true
    && steps.get("chat test")?.ok === true
    && steps.get("chat receipt")?.accepted === true;
}

// @ref LLP 1002#11-measured — every selected native host qualifies the exact immutable shim before publication.
export function recordPlatformQualification(staged, platformName, consumer, host = {
  platform: process.platform,
  arch: process.arch,
}) {
  const identity = platformIdentities.get(platformName);
  if (!identity || identity.os !== host.platform || identity.cpu !== host.arch) {
    throw new Error(`cannot record ${platformName} qualification from ${host.platform}-${host.arch}`);
  }
  if (consumer.status !== 0) throw new Error(`cannot record failed ${platformName} consumer qualification`);
  const artifact = staged.artifacts.find((candidate) => candidate.name === platformName);
  const shim = staged.artifacts.find((candidate) => candidate.name === "snapback2");
  if (!artifact || !shim || !/^[a-f0-9]{64}$/.test(staged.mediaDigest ?? "")) {
    throw new Error(`cannot record incomplete ${platformName} qualification`);
  }
  const steps = consumer.steps.map(({ name, ok, accepted, verdict }) => ({
    name,
    ...(ok === undefined ? {} : { ok }),
    ...(accepted === undefined ? {} : { accepted }),
    ...(verdict === undefined ? {} : { verdict }),
  }));
  const evidence = { verdict: "pass", steps };
  if (!consumerEvidencePassed(evidence)) {
    throw new Error(`cannot record incomplete ${platformName} consumer qualification`);
  }
  staged.platformQualifications ??= {};
  staged.platformQualifications[platformName] = {
    format: 1,
    name: platformName,
    version: artifact.version,
    integrity: artifact.integrity,
    shimIntegrity: shim.integrity,
    mediaDigest: staged.mediaDigest,
    host,
    consumer: evidence,
  };
  return staged;
}

export function readQualifiedPlatformArtifact(receiptPath, version) {
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read staged platform receipt ${receiptPath}: ${error.message}`);
  }
  const name = receipt?.name;
  const identity = platformIdentities.get(name);
  const matching = Array.isArray(receipt?.artifacts)
    ? receipt.artifacts.filter((artifact) => artifact.name === name)
    : [];
  const artifact = matching[0];
  const shims = Array.isArray(receipt?.artifacts)
    ? receipt.artifacts.filter((candidate) => candidate.name === "snapback2")
    : [];
  const shim = shims[0];
  const qualification = receipt?.platformQualifications?.[name];
  const tarball = portableTarballPath(receiptPath, artifact?.tarball);
  const shimTarball = portableTarballPath(receiptPath, shim?.tarball);
  if (!identity || receipt.version !== version || matching.length !== 1 || artifact.version !== version
    || shims.length !== 1 || shim.version !== version || !tarball || !shimTarball) {
    throw new Error(`staged platform receipt ${receiptPath} does not identify one recognized ${version} artifact`);
  }
  if (sri(tarball) !== artifact.integrity) {
    throw new Error(`staged platform artifact ${tarball} does not match its recorded integrity`);
  }
  if (sri(shimTarball) !== shim.integrity) {
    throw new Error(`staged shim artifact ${shimTarball} does not match its recorded integrity`);
  }
  const manifest = packedManifest(tarball);
  if (manifest.name !== name || manifest.version !== version
    || JSON.stringify(manifest.os) !== JSON.stringify([identity.os])
    || JSON.stringify(manifest.cpu) !== JSON.stringify([identity.cpu])) {
    throw new Error(`staged platform artifact ${tarball} has the wrong identity, version, or platform`);
  }
  const shimManifest = packedManifest(shimTarball);
  if (shimManifest.name !== "snapback2" || shimManifest.version !== version) {
    throw new Error(`staged shim artifact ${shimTarball} has the wrong identity or version`);
  }
  if (qualification?.format !== 1
    || qualification.name !== name
    || qualification.version !== version
    || qualification.integrity !== artifact.integrity
    || qualification.shimIntegrity !== shim.integrity
    || !/^[a-f0-9]{64}$/.test(qualification.mediaDigest ?? "")
    || qualification.mediaDigest !== receipt.mediaDigest
    || qualification.host?.platform !== identity.os
    || qualification.host?.arch !== identity.cpu
    || !consumerEvidencePassed(qualification.consumer)) {
    throw new Error(`staged platform receipt ${receiptPath} has no matching successful production consumer evidence`);
  }
  return {
    artifact: { name, version, tarball, integrity: artifact.integrity },
    qualification,
  };
}

export function verifyPublicationQualifications(staged) {
  const shim = staged.artifacts.find((artifact) => artifact.name === "snapback2");
  if (!shim) throw new Error("staged publication has no snapback2 shim artifact");
  for (const artifact of staged.artifacts.filter((candidate) => candidate.name !== "snapback2")) {
    const qualification = staged.platformQualifications?.[artifact.name];
    if (qualification?.name !== artifact.name
      || qualification.version !== artifact.version
      || qualification.integrity !== artifact.integrity
      || qualification.shimIntegrity !== shim.integrity
      || !consumerEvidencePassed(qualification.consumer)) {
      throw new Error(
        `${artifact.name}@${artifact.version} was not production-qualified with final shim ${shim.integrity}; run --stage-only on that platform with the unified artifact set`,
      );
    }
  }
}

function codecBuildEnvironment(prefix, macosDeploymentTarget) {
  const pkgConfig = resolve(prefix, "lib/pkgconfig");
  return {
    ...process.env,
    PKG_CONFIG_PATH: pkgConfig,
    PKG_CONFIG_LIBDIR: pkgConfig,
    SYSTEM_DEPS_LIBHEIF_LINK: "static",
    SYSTEM_DEPS_LIBHEIF_SEARCH_NATIVE: resolve(prefix, "lib"),
    ...(macosDeploymentTarget === undefined
      ? {}
      : { MACOSX_DEPLOYMENT_TARGET: macosDeploymentTarget }),
  };
}

function sourceArchive(source, directory, run = command) {
  mkdirSync(directory, { recursive: true });
  const archive = resolve(directory, `${source.name}-${source.version}.tar.gz`);
  if (existsSync(archive) && sha256(archive) !== source.sha256) {
    rmSync(archive, { force: true });
  }
  if (!existsSync(archive)) {
    const partial = `${archive}.partial-${process.pid}`;
    rmSync(partial, { force: true });
    try {
      run("curl", ["--fail", "--location", "--silent", "--show-error", source.url, "--output", partial]);
      if (sha256(partial) !== source.sha256) {
        throw new Error(`downloaded ${source.name} ${source.version} source failed SHA-256 verification`);
      }
      renameSync(partial, archive);
    } finally {
      rmSync(partial, { force: true });
    }
  }
  return archive;
}

function cachedCodecPrefix(cache, expectedReceipt) {
  const prefix = resolve(cache, "prefix");
  try {
    const receipt = JSON.parse(readFileSync(resolve(cache, "receipt.json"), "utf8"));
    const { archives, ...buildReceipt } = receipt;
    if (JSON.stringify(buildReceipt) !== JSON.stringify(expectedReceipt)) return undefined;
    if (archives === null || typeof archives !== "object" || Array.isArray(archives)) return undefined;
    for (const library of ["libde265.a", "libheif.a"]) {
      const path = resolve(prefix, "lib", library);
      if (!existsSync(path)
        || !/^[a-f0-9]{64}$/.test(archives[library] ?? "")
        || sha256(path) !== archives[library]) return undefined;
    }
    return prefix;
  } catch {
    return undefined;
  }
}

function buildStaticHeicClosure(macosDeploymentTarget, run = command) {
  const receipt = {
    format: 3,
    platform: process.platform,
    arch: process.arch,
    macosDeploymentTarget: macosDeploymentTarget ?? null,
    sources: codecSources.map(({ name, version, sha256: digest }) => ({ name, version, sha256: digest })),
    de265CmakeOptions,
    libheifCmakeOptions,
  };
  const key = [
    ...codecSources.map((source) => `${source.name}-${source.version}`),
    process.platform,
    process.arch,
    macosDeploymentTarget === undefined ? "native" : `macos-${macosDeploymentTarget}`,
  ].join("-");
  const cacheRoot = resolve(root, "target/media-codecs");
  const cache = resolve(cacheRoot, key);
  const cached = cachedCodecPrefix(cache, receipt);
  if (cached !== undefined) {
    console.log(`publish: reusing decoder-only codec build ${cached}`);
    return cached;
  }

  const staging = `${cache}.building-${process.pid}`;
  rmSync(cache, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  mkdirSync(staging, { recursive: true });
  const prefix = resolve(cache, "prefix");
  const sourceRoot = resolve(staging, "source");
  const buildRoot = resolve(staging, "build");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(buildRoot, { recursive: true });
  const environment = codecBuildEnvironment(prefix, macosDeploymentTarget);

  try {
    for (const source of codecSources) {
      const archive = sourceArchive(source, resolve(cacheRoot, "downloads"), run);
      run("tar", ["-xzf", archive, "-C", sourceRoot]);
    }
    const de265Source = resolve(sourceRoot, "libde265-1.1.2");
    const de265Build = resolve(buildRoot, "libde265");
    run(cmake, [
      "-S", de265Source,
      "-B", de265Build,
      `-DCMAKE_INSTALL_PREFIX=${prefix}`,
      ...de265CmakeOptions,
    ], { env: environment, stdio: "inherit" });
    run(cmake, ["--build", de265Build, "--target", "install", "--parallel"], {
      env: environment,
      stdio: "inherit",
    });

    const heifSource = resolve(sourceRoot, "libheif-1.23.3");
    const heifBuild = resolve(buildRoot, "libheif");
    run(cmake, [
      "-S", heifSource,
      "-B", heifBuild,
      `-DCMAKE_INSTALL_PREFIX=${prefix}`,
      `-DCMAKE_PREFIX_PATH=${prefix}`,
      ...libheifCmakeOptions,
    ], { env: environment, stdio: "inherit" });
    run(cmake, ["--build", heifBuild, "--target", "heif", "--parallel"], {
      env: environment,
      stdio: "inherit",
    });
    run(cmake, ["--install", heifBuild, "--config", "Release"], {
      env: environment,
      stdio: "inherit",
    });
    const archives = Object.fromEntries(
      ["libde265.a", "libheif.a"].map((library) => [
        library,
        sha256(resolve(prefix, "lib", library)),
      ]),
    );
    writeFileSync(
      resolve(cache, "receipt.json"),
      `${JSON.stringify({ ...receipt, archives }, null, 2)}\n`,
    );
    rmSync(staging, { recursive: true, force: true });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
    throw error;
  }

  const built = cachedCodecPrefix(cache, receipt);
  if (built === undefined) throw new Error("decoder-only codec build completed without its static archives");
  return built;
}

function loadResume(path, name, version, requestedPlatforms = []) {
  if (!existsSync(path)) return undefined;
  const resume = JSON.parse(readFileSync(path, "utf8"));
  if (resume.name !== name
    || resume.version !== version
    || !Array.isArray(resume.artifacts)
    || !/^[a-f0-9]{64}$/.test(resume.mediaDigest ?? "")) return undefined;
  for (const artifact of resume.artifacts) {
    const tarball = portableTarballPath(path, artifact.tarball);
    if (!tarball || sri(tarball) !== artifact.integrity) return undefined;
    artifact.tarball = tarball;
  }
  const selected = resume.artifacts.filter((artifact) => artifact.name !== "snapback2");
  const expected = [{ name }, ...requestedPlatforms.map(({ artifact }) => artifact)];
  if (selected.length !== expected.length
    || expected.some((artifact) => selected.filter((candidate) => candidate.name === artifact.name).length !== 1)
    || requestedPlatforms.some(({ artifact }) => selected.find((candidate) => candidate.name === artifact.name)?.integrity !== artifact.integrity)) {
    return undefined;
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

function elfDependencies(path, inspect = command) {
  const output = inspect("readelf", ["-d", path]).stdout ?? "";
  return [...output.matchAll(/\(NEEDED\).*?Shared library: \[([^\]]+)\]/g)]
    .map((match) => match[1]);
}

function isSystemLinuxDependency(name) {
  return /^(?:libc|libm|libstdc\+\+|libgcc_s|libpthread|libdl|librt|libutil|libresolv)\.so(?:\..*)?$/.test(name);
}

function verifySelfContainedMediaHelper(mediaBin, inspect = command, platform = process.platform) {
  if (platform === "darwin") {
    for (const dependency of machODependencies(mediaBin, inspect)) {
      if (isSystemMacDependency(dependency)) continue;
      throw new Error(`refusing to publish snapback2-media with non-system dependency ${dependency}`);
    }
    return [mediaBin];
  }
  if (platform === "linux") {
    for (const dependency of elfDependencies(mediaBin, inspect)) {
      if (!isSystemLinuxDependency(dependency)) {
        throw new Error(`refusing to publish snapback2-media with non-system dependency ${dependency}`);
      }
    }
    return [mediaBin];
  }
  throw new Error(`refusing to publish snapback2-media: dependency qualification is not implemented for ${platform}`);
}

function macMinimumVersion(path, inspect = command) {
  const output = inspect("otool", ["-l", path]).stdout ?? "";
  const build = /cmd LC_BUILD_VERSION[\s\S]*?\n\s*minos\s+(\d+(?:\.\d+)*)/.exec(output);
  if (build) return build[1];
  const legacy = /cmd LC_VERSION_MIN_MACOSX[\s\S]*?\n\s*version\s+(\d+(?:\.\d+)*)/.exec(output);
  if (legacy) return legacy[1];
  throw new Error(`cannot read the macOS deployment target from ${path}`);
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function verifyMacDeploymentFloors(mediaBin, shipped, inspect = command, platform = process.platform) {
  if (platform !== "darwin") return;
  const helperMinimum = macMinimumVersion(mediaBin, inspect);
  for (const path of shipped) {
    const minimum = macMinimumVersion(path, inspect);
    if (compareVersions(minimum, helperMinimum) > 0) {
      throw new Error(
        `refusing to publish ${path}: macOS minos ${minimum} exceeds helper minos ${helperMinimum}`,
      );
    }
  }
}

function qualifyStagedMedia(staged, platformName, options = {}) {
  const platformArtifact = staged.artifacts.find((artifact) => artifact.name === platformName);
  if (!platformArtifact) throw new Error(`staged publication has no ${platformName} artifact`);
  const directory = mkdtempSync(resolve(tmpdir(), "snapback2-media-qualify-"));
  try {
    (options.extract ?? command)("tar", ["-xzf", platformArtifact.tarball, "-C", directory]);
    const mediaBin = resolve(directory, "package/bin/snapback2-media");
    if (!existsSync(mediaBin)) throw new Error("staged platform tarball has no snapback2-media helper");
    const engineBin = resolve(directory, "package/bin/snapback2");
    if (!existsSync(engineBin)) throw new Error("staged platform tarball has no snapback2 binary");
    requireFullMediaHelper(mediaBin, options.run ?? command);
    (options.verifyDependencies ?? verifySelfContainedMediaHelper)(mediaBin);
    (options.verifyDeploymentFloors ?? verifyMacDeploymentFloors)(
      mediaBin,
      [mediaBin, engineBin],
    );
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
    env: npmEnvironment,
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

function buildProductionMedia() {
  const mediaBin = resolve(root, "target/production/snapback2-media");
  let macosDeploymentTarget;
  if (process.platform === "darwin") {
    command("cargo", [
      "build",
      "--quiet",
      "--profile",
      "production",
      "-p",
      "snapback2-media",
      "--no-default-features",
    ], { stdio: "inherit" });
    macosDeploymentTarget = macMinimumVersion(mediaBin);
    console.log(`publish: snapback2-media deployment target ${macosDeploymentTarget}`);
  }

  const prefix = buildStaticHeicClosure(macosDeploymentTarget);
  const environment = codecBuildEnvironment(prefix, macosDeploymentTarget);
  command("cargo", [
    "nextest",
    "run",
    "-p",
    "snapback2-media",
    "--features",
    "heic",
    "--test",
    "cli",
    "--no-fail-fast",
  ], { env: environment, stdio: "inherit" });
  command("cargo", [
    "build",
    "--quiet",
    "--profile",
    "production",
    "-p",
    "snapback2-media",
    "--features",
    "images,heic",
  ], { env: environment, stdio: "inherit" });
  requireFullMediaHelper(mediaBin);
  verifySelfContainedMediaHelper(mediaBin);
  if (macosDeploymentTarget !== undefined
    && macMinimumVersion(mediaBin) !== macosDeploymentTarget) {
    throw new Error("source-built snapback2-media changed its derived macOS deployment target");
  }
  return mediaBin;
}

function prepare(version, name, stateDirectory, requestedPlatforms = []) {
  rmSync(stateDirectory, { recursive: true, force: true });
  mkdirSync(stateDirectory, { recursive: true });
  // @ref LLP 1006#14a-codecs-live-in-a-separate-executable-the-type-does-not — the one published helper carries every admitted image codec.
  const mediaBin = buildProductionMedia();
  const mediaBytes = statSync(mediaBin).size;

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
  verifyMacDeploymentFloors(mediaBin, [mediaBin, bin]);

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
  copyFileSync(mediaBin, resolve(platformStage, "bin/snapback2-media"));
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
  const platformArtifacts = [{ name, version, ...platformPack }];
  const platformQualifications = {};
  for (const requested of requestedPlatforms) {
    const target = resolve(stateDirectory, basename(requested.artifact.tarball));
    if (existsSync(target)) throw new Error(`staged platform artifact target already exists: ${target}`);
    copyFileSync(requested.artifact.tarball, target);
    platformArtifacts.push({ ...requested.artifact, tarball: target });
    platformQualifications[requested.artifact.name] = requested.qualification;
  }
  stagePlatformDependencies(shimStage, platformArtifacts);
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
    platformQualifications,
    artifacts: [
      ...platformArtifacts,
      { name: "snapback2", version, ...shimPack },
    ],
  };
  return resume;
}

export function stagePublication(version, name, stateDirectory, resumePath, options = {}) {
  const dryRun = options.dryRun ?? dry;
  const requestedPlatforms = options.platformArtifacts ?? [];
  const prepareArtifacts = options.prepareArtifacts ?? prepare;
  const qualifyArtifacts = options.qualifyArtifacts
    ?? ((staged) => {
      qualifyStagedMedia(staged, name);
      verifyPlatformDependencies(staged.artifacts);
      return staged;
    });
  if (!dryRun) {
    const staged = loadResume(resumePath, name, version, requestedPlatforms)
      ?? prepareArtifacts(version, name, stateDirectory, requestedPlatforms);
    staged.platformQualifications ??= {};
    for (const requested of requestedPlatforms) {
      staged.platformQualifications[requested.artifact.name] = requested.qualification;
    }
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
      staged: qualifyArtifacts(prepareArtifacts(version, name, dryStateDirectory, requestedPlatforms)),
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
  const packagingTests = spawnSync(process.execPath, ["--test", "--test-timeout=30000", resolve(root, "scripts/publish.test.mjs")], {
    stdio: "inherit",
  });
  const directory = mkdtempSync(resolve(tmpdir(), "snapback2-publish-self-test-"));
  try {
    assert.ok(de265CmakeOptions.includes("-DCMAKE_POSITION_INDEPENDENT_CODE=ON"));
    const snapshot = resolve(directory, "shim");
    let qualified = false;
    const packageSteps = [];
    buildAndQualifyPackage(
      snapshot,
      (target) => {
        packageSteps.push("build");
        mkdirSync(resolve(target, "dist"), { recursive: true });
        writeFileSync(resolve(target, "dist/compiler.mjs"), "// built\n");
      },
      (compiler) => {
        packageSteps.push("qualify");
        assert.equal(readFileSync(compiler, "utf8"), "// built\n");
        qualified = true;
      },
      (target) => {
        packageSteps.push("install");
        assert.equal(target, snapshot);
      },
    );
    assert.deepEqual(packageSteps, ["build", "install", "qualify"]);
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
    ), /non-system dependency \/opt\/homebrew\/opt\/libheif/);
    assert.deepEqual(verifySelfContainedMediaHelper(
      "snapback2-media",
      () => ({
        stdout: " 0x0000000000000001 (NEEDED) Shared library: [libstdc++.so.6]\n 0x0000000000000001 (NEEDED) Shared library: [libc.so.6]\n",
      }),
      "linux",
    ), ["snapback2-media"]);
    assert.deepEqual(verifySelfContainedMediaHelper(
      "snapback2-media",
      () => ({ stdout: "There is no dynamic section in this file.\n" }),
      "linux",
    ), ["snapback2-media"]);
    assert.throws(() => verifySelfContainedMediaHelper(
      "snapback2-media",
      () => ({
        stdout: " 0x0000000000000001 (NEEDED) Shared library: [libheif.so.1]\n",
      }),
      "linux",
    ), /non-system dependency libheif\.so\.1/);

    const fakeMacInspect = (_cmd, argv) => ({
      stdout: `Load command 10\n      cmd LC_BUILD_VERSION\n  cmdsize 32\n platform MACOS\n    minos ${argv[1].includes("too-new") ? "14.0" : "11.0"}\n`,
    });
    verifyMacDeploymentFloors(
      "snapback2-media",
      ["snapback2-media", "snapback2"],
      fakeMacInspect,
      "darwin",
    );
    assert.throws(() => verifyMacDeploymentFloors(
      "snapback2-media",
      ["snapback2-media", "too-new-libheif.dylib"],
      fakeMacInspect,
      "darwin",
    ), /minos 14\.0 exceeds helper minos 11\.0/);

    const codecCache = resolve(directory, "codec-cache");
    const codecPrefix = resolve(codecCache, "prefix");
    const codecLibraryDirectory = resolve(codecPrefix, "lib");
    mkdirSync(codecLibraryDirectory, { recursive: true });
    const de265Archive = resolve(codecLibraryDirectory, "libde265.a");
    const heifArchive = resolve(codecLibraryDirectory, "libheif.a");
    writeFileSync(de265Archive, "de265 archive bytes");
    writeFileSync(heifArchive, "heif archive bytes");
    const codecReceipt = { format: 3, platform: "test", arch: "test" };
    writeFileSync(resolve(codecCache, "receipt.json"), `${JSON.stringify({
      ...codecReceipt,
      archives: {
        "libde265.a": sha256(de265Archive),
        "libheif.a": sha256(heifArchive),
      },
    })}\n`);
    assert.equal(cachedCodecPrefix(codecCache, codecReceipt), codecPrefix);
    const de265Bytes = readFileSync(de265Archive);
    const heifBytes = readFileSync(heifArchive);
    writeFileSync(de265Archive, heifBytes);
    writeFileSync(heifArchive, de265Bytes);
    assert.equal(cachedCodecPrefix(codecCache, codecReceipt), undefined);
    writeFileSync(de265Archive, de265Bytes);
    writeFileSync(heifArchive, Buffer.concat([heifBytes, Buffer.from("corrupt")]));
    assert.equal(cachedCodecPrefix(codecCache, codecReceipt), undefined);

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
    const badEngine = resolve(badPackageBin, "snapback2");
    writeFileSync(badHelper, "#!/bin/sh\nprintf '%s\\n' '{\"images\":true,\"heic\":false}'\n");
    writeFileSync(badEngine, "engine");
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
            verifyDeploymentFloors() {},
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
            verifyDeploymentFloors() {},
          });
        },
      },
    ), /does not match resume record/);
    console.log("publish self-test ok; staged helper qualified; macOS floors and Linux dependencies checked; codec cache archives digest-bound; resume without HEIC refused; helper digest bound; durable dry-run resume preserved");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  if (packagingTests.status !== 0) throw new Error("publication packaging tests failed");
}

function main() {
  if (stageOnly && dry) throw new Error("--stage-only and --dry-run are mutually exclusive; staging must retain its receipt");
  const started = performance.now();
  const version = packageVersion();
  const platform = `${process.platform}-${process.arch}`;
  const name = `snapback2-${platform}`;
  const requestedPlatforms = platformArtifactPaths().map((path) => readQualifiedPlatformArtifact(path, version));
  const requestedNames = requestedPlatforms.map(({ artifact }) => artifact.name);
  if (requestedNames.includes(name)) {
    throw new Error(`--platform-artifact must name a foreign platform, not this host's ${name}`);
  }
  if (new Set(requestedNames).size !== requestedNames.length) {
    throw new Error("--platform-artifact names the same platform more than once");
  }
  const stateDirectory = resolve(root, "dist/npm", `publish-${name}-${version}`);
  const resumePath = resolve(stateDirectory, "resume.json");
  const publication = stagePublication(version, name, stateDirectory, resumePath, {
    platformArtifacts: requestedPlatforms,
  });
  const staged = publication.staged;

  try {
    // The shim is qualified exactly as packed, but npm receives only the host
    // binary tarball directly. Foreign os/cpu packages carry their own host
    // receipt and must not be executed (or rejected with EBADPLATFORM) here.
    const consumer = consumerSmoke(hostConsumerArtifacts(staged.artifacts), { npm });
    console.log(`publish consumer: ${consumer.stdout}`);
    if (consumer.status !== 0) throw new Error(`installed package qualification failed\n${consumer.stderr}`);
    recordPlatformQualification(staged, name, consumer);
    if (!dry) writeFileSync(resumePath, `${JSON.stringify(staged, null, 2)}\n`);
    if (stageOnly) {
      console.log(`staged and qualified ${name}@${version}; transfer ${stateDirectory} and pass its resume.json with --platform-artifact`);
      return;
    }
    verifyPublicationQualifications(staged);
    if (dry) {
      for (const artifact of staged.artifacts) {
        command(npm, ["publish", artifact.tarball, "--access", "public", "--dry-run", "--ignore-scripts"], {
          env: npmEnvironment,
          stdio: "inherit",
        });
      }
    } else {
      convergeArtifacts(
        staged.artifacts,
        registryIntegrity,
        (artifact) => command(npm, ["publish", artifact.tarball, "--access", "public", "--ignore-scripts"], {
          env: npmEnvironment,
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

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  try {
    if (selfTest) runSelfTest();
    else main();
  } catch (error) {
    console.error(`publish: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
