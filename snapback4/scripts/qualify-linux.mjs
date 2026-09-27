#!/usr/bin/env node
// @ref LLP 3000.021#3.3 — Linux qualifies bytes; it never packs the client or publishes
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, openSync, closeSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { artifact, cleanSource, clientManifest, digest, json, linuxRustFlags, linuxTarget, nodeVersion, platforms, refuseCredentials, run, save, sqliteBuildFlags, sri, validateLinux } from "./publication-artifacts.mjs";
import { checkElf } from "./check-elf.mjs";
export function containerRuntime() {
  for (const name of ["docker", "podman"]) {
    const probe = spawnSync(name, ["info"], { stdio: "ignore", timeout: 15_000 });
    if (probe.status === 0) return name;
  }
  throw new Error("Linux consumer proof needs a working Docker or Podman; install/enable a runtime, then rerun qualify-linux.mjs (no receipt was written)");
}
export function containerProof(runtime, client, platform, version, work) {
  const context = join(work, "container"); mkdirSync(context);
  copyFileSync(client, join(context, "client.tgz")); copyFileSync(platform, join(context, "platform.tgz"));
  copyFileSync(new URL("./publication-roundtrip.mjs", import.meta.url), join(context, "roundtrip.mjs"));
  const proofs = [];
  for (const base of ["ubuntu:22.04", "alpine"]) {
    const dockerfile = base === "alpine"
      ? `FROM node:${nodeVersion}-alpine AS node\nFROM alpine:3.23\nCOPY --from=node /usr/local /usr/local\nRUN apk add --no-cache libstdc++ ca-certificates\n`
      : `FROM node:${nodeVersion}-bookworm-slim AS node\nFROM ubuntu:22.04\nCOPY --from=node /usr/local /usr/local\nRUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*\n`;
    writeFileSync(join(context, "Dockerfile"), dockerfile + `COPY client.tgz platform.tgz roundtrip.mjs /proof/\nWORKDIR /consumer\nENV NPM_CONFIG_USERCONFIG=/dev/null NPM_CONFIG_GLOBALCONFIG=/dev/null\n`);
    const tag = `snapback4-proof-${process.pid}-${base.startsWith("ubuntu") ? "ubuntu" : "alpine"}`;
    try {
      run(runtime, ["build", "--pull", "--platform", "linux/amd64", "-t", tag, context], { stdio: "inherit" });
      const image = run(runtime, ["image", "inspect", "--format", "{{.Id}}", tag]).trim();
      // The only host files in the image are these three proof inputs. No checkout,
      // home, npmrc, binary override or host credentials enter the container.
      run(runtime, ["run", "--rm", "--platform", "linux/amd64", tag, "sh", "-ec",
        `test -z "\${SNAPBACK4_BIN+x}"; test "$(node -v)" = v${nodeVersion}; printf '{"private":true,"type":"module"}' > package.json; npm install --ignore-scripts --no-audit --no-fund /proof/client.tgz /proof/platform.tgz; cp /proof/roundtrip.mjs .; node roundtrip.mjs ${version}`], { stdio: "inherit", timeout: 300_000 });
      proofs.push({ base, image, runtime, node: nodeVersion, status: "passed", clientIntegrity: sri(client), platformIntegrity: sri(platform) });
    } finally { spawnSync(runtime, ["image", "rm", tag], { stdio: "ignore", timeout: 30_000 }); }
  }
  return proofs;
}
export function qualify(args = process.argv.slice(2)) {
  refuseCredentials(); // Must precede all commands, including argument-dependent work.
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Linux qualification requires a linux-x64 host");
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--client", "--out"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("usage: qualify-linux.mjs --client /path/client.tgz --out /path/new-directory");
    options[args[i]] = resolve(args[i + 1]);
  }
  if (!options["--client"] || !options["--out"]) throw new Error("usage: qualify-linux.mjs --client /path/client.tgz --out /path/new-directory");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), out = options["--out"], client = options["--client"];
  if (existsSync(join(out, "receipt.json"))) throw new Error("qualification receipt already exists; choose a new --out directory");
  const source = cleanSource(root), version = json(join(root, "packages/snapback4/package.json")).version;
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error("invalid release version");
  clientManifest(client, version);
  const clientIntegrity = sri(client), runtime = containerRuntime();
  const env = { ...process.env, LIBSQLITE3_FLAGS: sqliteBuildFlags }; delete env.SNAPBACK4_BIN;
  mkdirSync(out, { recursive: true });
  const log = join(out, "suite.log"), fd = openSync(log, "w");
  let result;
  try { result = spawnSync("bash", [join(root, "scripts/test.sh")], { cwd: root, env, stdio: ["ignore", fd, fd] }); }
  finally { closeSync(fd); }
  const summary = readFileSync(log, "utf8").match(/^== \d+ failure\(s\) in \d+ s$/m)?.[0];
  if (result.status !== 0 || !summary?.startsWith("== 0 ")) throw new Error(`Linux source suite failed: ${summary ?? result.error?.message ?? result.status}; see ${log}`);
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
    const proofs = containerProof(runtime, client, tarball, version, work);
    const cc = process.env.SNAPBACK4_MUSL_CC ?? join(process.env.HOME, ".local/share/snapback4-musl-1.2.5/bin/musl-gcc");
    const receipt = { format: 1, source, target: linuxTarget, toolchain: { rustc: run("rustc", ["-Vv"]).trim(), cargo: run("cargo", ["-V"]).trim(), cc: run(cc, ["--version"]).trim(), linker: cc }, flags: { LIBSQLITE3_FLAGS: sqliteBuildFlags, RUSTFLAGS: linuxRustFlags }, suite: { status: "passed", exitCode: result.status, summary }, proofs, elf, platform, binarySha256, clientIntegrity };
    if (cleanSource(root) !== source || sri(client) !== clientIntegrity) throw new Error("release source or client changed during Linux qualification");
    validateLinux(receipt, tarball, { version, integrity: clientIntegrity }, source);
    copyFileSync(tarball, join(out, packed.filename));
    save(join(out, "receipt.json"), receipt);
    console.log(JSON.stringify(receipt, null, 2));
    return receipt;
  } finally { rmSync(work, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) qualify();
