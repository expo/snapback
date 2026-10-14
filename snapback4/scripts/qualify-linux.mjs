#!/usr/bin/env node
// @ref LLP 3000.021#3.3 — Linux qualifies bytes; it never packs the client or publishes
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, openSync, closeSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { artifact, cleanSource, clientManifest, digest, json, linuxRustFlags, linuxTarget, manifest, nodeVersion, platforms, refuseCredentials, run, save, sqliteBuildFlags, sri, validateLinux } from "./publication-artifacts.mjs";
import { checkElf } from "./check-elf.mjs";
import { prootProof } from "./qualify-linux-proot.mjs";
export function containerRuntime(probeRuntime = name => spawnSync(name, ["info"], { stdio: "ignore", timeout: 15_000 })) {
  for (const name of ["docker", "podman"]) {
    const probe = probeRuntime(name);
    if (probe.status === 0) return name;
  }
  return "proot";
}
export function containerProof(runtime, client, platform, version, work, expo) {
  const context = join(work, "container"); mkdirSync(context);
  copyFileSync(expo, join(context, "expo.tgz"));
  copyFileSync(new URL("./publication-starters.mjs", import.meta.url), join(context, "starters.mjs"));
  copyFileSync(client, join(context, "client.tgz")); copyFileSync(platform, join(context, "platform.tgz"));
  copyFileSync(new URL("./publication-roundtrip.mjs", import.meta.url), join(context, "roundtrip.mjs"));
  const proofs = [];
  for (const base of ["ubuntu:22.04", "alpine"]) {
    const started = Date.now();
    const dockerfile = base === "alpine"
      ? `FROM node:${nodeVersion}-alpine AS node\nFROM alpine:3.23\nCOPY --from=node /usr/local /usr/local\nRUN apk add --no-cache libstdc++ ca-certificates\n`
      : `FROM node:${nodeVersion}-bookworm-slim AS node\nFROM ubuntu:22.04\nCOPY --from=node /usr/local /usr/local\nRUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*\n`;
    writeFileSync(join(context, "Dockerfile"), dockerfile + `COPY client.tgz platform.tgz expo.tgz roundtrip.mjs starters.mjs /proof/\nWORKDIR /consumer\nENV NPM_CONFIG_USERCONFIG=/dev/null NPM_CONFIG_GLOBALCONFIG=/tmp/snapback4-empty-global.npmrc\n`);
    const tag = `snapback4-proof-${process.pid}-${base.startsWith("ubuntu") ? "ubuntu" : "alpine"}`;
    try {
      run(runtime, ["build", "--pull", "--platform", "linux/amd64", "-t", tag, context], { stdio: "inherit" });
      const image = run(runtime, ["image", "inspect", "--format", "{{.Id}}", tag]).trim();
      // The only host files in the image are these proof inputs. No checkout,
      // home, npmrc, binary override or host credentials enter the container.
      run(runtime, ["run", "--rm", "--name", tag, "--platform", "linux/amd64", tag, "sh", "-ec",
        `test -z "\${SNAPBACK4_BIN+x}"; test "$(node -v)" = v${nodeVersion}; printf '{"private":true,"type":"module"}' > package.json; npm install --ignore-scripts --no-audit --no-fund /proof/client.tgz /proof/platform.tgz; cp /proof/roundtrip.mjs .; node roundtrip.mjs ${version}; node /proof/starters.mjs /proof/client.tgz /proof/platform.tgz /proof/expo.tgz`], { stdio: "inherit", timeout: 1_200_000 });
      proofs.push({ base, image, runtime, route: runtime, elapsedMs: Date.now() - started, node: nodeVersion, status: "passed", clientIntegrity: sri(client), platformIntegrity: sri(platform), expoIntegrity: sri(expo), starters: { web: "passed", expo: "passed", adapted: "passed", templates: "passed" } });
    } finally {
      spawnSync(runtime, ["rm", "--force", tag], { stdio: "ignore", timeout: 30_000 });
      spawnSync(runtime, ["image", "rm", tag], { stdio: "ignore", timeout: 30_000 });
    }
  }
  return proofs;
}
export function qualify(args = process.argv.slice(2)) {
  refuseCredentials(); // Must precede all commands, including argument-dependent work.
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Linux qualification requires a linux-x64 host");
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--client", "--expo", "--out"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("usage: qualify-linux.mjs --client /path/client.tgz --expo /path/expo.tgz --out /path/new-directory");
    options[args[i]] = resolve(args[i + 1]);
  }
  if (!options["--client"] || !options["--expo"] || !options["--out"]) throw new Error("usage: qualify-linux.mjs --client /path/client.tgz --expo /path/expo.tgz --out /path/new-directory");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), out = options["--out"], client = options["--client"], expo = options["--expo"];
  if (existsSync(join(out, "receipt.json"))) throw new Error("qualification receipt already exists; choose a new --out directory");
  const source = cleanSource(root), version = json(join(root, "packages/snapback4/package.json")).version;
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error("invalid release version");
  clientManifest(client, version);
  manifest(expo, "snapback4-expo", version);
  const clientIntegrity = sri(client), expoIntegrity = sri(expo), runtime = containerRuntime();
  const env = { ...process.env, LIBSQLITE3_FLAGS: sqliteBuildFlags }; delete env.SNAPBACK4_BIN;
  mkdirSync(out, { recursive: true });
  const log = join(out, "suite.log"), fd = openSync(log, "w");
  let result;
  try { result = spawnSync("bash", [join(root, "scripts/test.sh")], { cwd: root, env, stdio: ["ignore", fd, fd] }); }
  finally { closeSync(fd); }
  const summary = readFileSync(log, "utf8").match(/^== \d+ failure\(s\) in \d+ s$/m)?.[0];
  const suitePassed = result.status === 0 && summary?.startsWith("== 0 ");
  run("bash", [join(root, "scripts/build-linux-musl.sh")], { cwd: root, env, stdio: "inherit" });
  const binary = join(root, `target/${linuxTarget}/production/snapback4`), binarySha256 = digest(binary), elf = checkElf(readFileSync(binary));
  if (run(binary, ["--version"]).trim() !== `snapback4 ${version}`) throw new Error("Linux built binary version differs from client");
  const work = mkdtempSync(join(tmpdir(), "snapback4-linux-"));
  try {
    const pkg = join(work, platforms[1]); mkdirSync(pkg);
    for (const name of ["package.json", "THIRD-PARTY-NOTICES"]) copyFileSync(join(root, "packages", platforms[1], name), join(pkg, name));
    copyFileSync(binary, join(pkg, "snapback4"));
    const [packed] = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", work], { cwd: pkg }));
    const tarball = join(work, packed.filename), platform = artifact(tarball, platforms[1], version);
    const proofs = runtime === "proot" ? prootProof(client, tarball, version, undefined, undefined, expo) : containerProof(runtime, client, tarball, version, work, expo);
    // Keep executed consumer evidence on a red suite, without a success receipt.
    // An isolated flake rerun cannot turn the original suite into a release pass.
    save(join(out, "proofs.json"), { source, route: runtime, proofs, suite: { exitCode: result.status, summary } });
    if (!suitePassed) throw new Error(`Linux source suite failed: ${summary ?? result.error?.message ?? result.status}; see ${log}; consumer evidence in proofs.json (no qualification receipt)`);
    const cc = process.env.SNAPBACK4_MUSL_CC ?? join(process.env.HOME, ".local/share/snapback4-musl-1.2.5/bin/musl-gcc");
    const receipt = { format: 1, route: runtime, source, target: linuxTarget, toolchain: { rustc: run("rustc", ["-Vv"]).trim(), cargo: run("cargo", ["-V"]).trim(), cc: run(cc, ["--version"]).trim(), linker: cc }, flags: { LIBSQLITE3_FLAGS: sqliteBuildFlags, RUSTFLAGS: linuxRustFlags }, suite: { status: "passed", exitCode: result.status, summary }, proofs, elf, platform, binarySha256, clientIntegrity, expo: artifact(expo, "snapback4-expo", version) };
    if (cleanSource(root) !== source || sri(client) !== clientIntegrity || sri(expo) !== expoIntegrity) throw new Error("release source or client changed during Linux qualification");
    validateLinux(receipt, tarball, { version, integrity: clientIntegrity }, source);
    copyFileSync(tarball, join(out, packed.filename));
    save(join(out, "receipt.json"), receipt);
    console.log(JSON.stringify(receipt, null, 2));
    return receipt;
  } finally { rmSync(work, { recursive: true, force: true }); }
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) qualify();
