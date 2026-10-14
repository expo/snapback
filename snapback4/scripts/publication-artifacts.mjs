// @ref LLP 3000.021#3.3 — one client digest, platform-local qualification, digest-only import
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { matchesPinnedProof } from "./linux-proof-inputs.mjs";
import { starterCases } from "./publication-starters.mjs";
import { checkElf } from "./check-elf.mjs";
export const sqliteBuildFlags = "-USQLITE_ENABLE_MEMORY_MANAGEMENT";
export const platforms = ["snapback4-darwin-arm64", "snapback4-linux-x64"];
export const linuxTarget = "x86_64-unknown-linux-musl";
export const linuxRustFlags = "-C target-feature=+crt-static -C relocation-model=static";
export const nodeVersion = "24.13.1";
export const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const digest = (path) => hash(readFileSync(path));
export const sri = (path) => `sha512-${createHash("sha512").update(readFileSync(path)).digest("base64")}`;
export const json = (path) => JSON.parse(readFileSync(path, "utf8"));
export function save(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, path);
}
export function cleanSource(root) {
  if (run("git", ["status", "--porcelain", "--untracked-files=normal", "--", "."], { cwd: root }).trim())
    throw new Error("publication source is dirty; commit the release changes before preparing or qualifying artifacts");
  return run("git", ["rev-parse", "HEAD"], { cwd: root }).trim();
}
export function member(tarball, path) {
  return execFileSync("tar", ["-xOf", tarball, `package/${path}`], { maxBuffer: 128 * 1024 * 1024 });
}
export function manifest(tarball, name, version) {
  const m = JSON.parse(member(tarball, "package.json"));
  if (m.name !== name || m.version !== version) throw new Error(`packed manifest must name ${name}@${version}`);
  return m;
}
export function clientManifest(tarball, version, expected = platforms) {
  const m = manifest(tarball, "snapback4", version);
  const deps = m.optionalDependencies ?? {};
  if (JSON.stringify(Object.keys(deps).sort()) !== JSON.stringify([...expected].sort()) || expected.some(name => deps[name] !== version))
    throw new Error(`packed client optionalDependencies must be exactly ${expected.join(", ")} at ${version}`);
  return m;
}
export function artifact(tarball, name, version, extra = {}) {
  return { name, version, filename: basename(tarball), integrity: sri(tarball), bytes: statSync(tarball).size, ...extra };
}
export function verifyArtifact(a, directory, version) {
  if (!a || a.version !== version || typeof a.filename !== "string" || basename(a.filename) !== a.filename || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(a.integrity ?? ""))
    throw new Error("publication resume has an incomplete artifact");
  const tarball = join(directory, a.filename);
  if (sri(tarball) !== a.integrity || statSync(tarball).size !== a.bytes)
    throw new Error(`staged ${a.name}@${version} tarball does not match its durable integrity`);
  return { ...a, tarball };
}
export function refuseCredentials(env = process.env) {
  for (const key of ["NPM_TOKEN", "NODE_AUTH_TOKEN"]) if (Object.hasOwn(env, key))
    throw new Error(`Linux qualification refuses ${key}; unset it before qualification (no authenticated registry writes)`);
}
function validAttempts(proofs, starter) {
  return Array.isArray(proofs) && proofs.length === 2 && [1, 2].every(attempt => proofs.some(p =>
    p.starter === starter.id && p.kind === starter.kind && p.attempt === attempt && p.status === "passed" && Array.isArray(p.range) && p.range.length === 2
    && Number.isInteger(p.range[0]) && Number.isInteger(p.range[1]) && p.range[0] > 0 && p.range[1] <= 65535 && p.range[0] < p.range[1]
    && p.occupied === p.range[0] && p.cpuLoadWorkers >= 1 && p.listenerAudit?.status === "passed" && p.listenerAudit.samples > 0
    && Array.isArray(p.listenerAudit.listeners) && p.listenerAudit.listeners.every(row => row.port >= p.range[0] && row.port <= p.range[1])));
}
export function validateFrontendProofs(proofs) {
  if (!Array.isArray(proofs) || proofs.length !== starterCases.length * 2 || !starterCases.every(s => validAttempts(proofs.filter(p => p.starter === s.id), s)))
    throw new Error("Linux receipt needs every generated frontend/template proof twice under occupied-port and CPU load");
}
export function validateStarterProofs(starters) {
  if (!Array.isArray(starters) || starters.length !== starterCases.length) throw Error("Linux receipt needs every starter toolchain and frontend proof");
  validateFrontendProofs(starters.flatMap(s => s.frontendProofs ?? []));
  for (const starter of starterCases) {
    const result = starters.find(s => s.starter === starter.id);
    if (!result || result.status !== "passed" || result.typecheck !== "passed" || result.build !== "passed"
        || (["web", "expo"].includes(starter.id) && (!validAttempts(result.adaptedProofs, starter) || result.negativeProof?.status !== "passed" || result.negativeProof.listenerAudit?.status !== "passed" || (starter.id === "web" && result.formSubmit !== "passed"))))
      throw Error("Linux receipt needs every starter toolchain and frontend proof, including adapted Home");
  }
}
export function validateLinux(receipt, tarball, client, source) {
  if (receipt.format !== 1 || receipt.platform?.name !== platforms[1] || receipt.platform.version !== client.version || receipt.source !== source || !/^[a-f0-9]{40}$/.test(source ?? ""))
    throw new Error("Linux receipt source/version/platform does not match the prepared release");
  if (receipt.target !== linuxTarget || receipt.flags?.LIBSQLITE3_FLAGS !== sqliteBuildFlags || receipt.flags?.RUSTFLAGS !== linuxRustFlags || !receipt.toolchain?.rustc || !receipt.toolchain?.cc || !receipt.toolchain?.linker)
    throw new Error("Linux receipt target/toolchain/SQLite flags are incomplete or differ");
  if (receipt.suite?.status !== "passed" || receipt.suite.exitCode !== 0 || !/^== 0 failure\(s\) in \d+ s$/.test(receipt.suite.summary ?? ""))
    throw new Error("Linux receipt does not carry a successful suite result");
  if (receipt.clientIntegrity !== client.integrity) throw new Error("Linux receipt proved a different client SRI");
  if (sri(tarball) !== receipt.platform.integrity) throw new Error("Linux tarball does not match receipt SRI");
  if (receipt.expo?.name !== "snapback4-expo" || receipt.expo.version !== client.version || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(receipt.expo.integrity ?? "")) throw new Error("Linux receipt needs the packed Expo proof artifact");
  if (client.expoIntegrity && receipt.expo.integrity !== client.expoIntegrity) throw new Error("Linux receipt proved a different Expo SRI");
  // Older staged publications predate this qualification; new releases cannot
  // import a receipt that silently omits the loaded-host browser proof.
  const [major, minor, patch] = client.version.split("-")[0].split(".").map(Number);
  if (major > 0 || minor > 4 || minor === 4 && patch >= 28) { validateFrontendProofs(receipt.frontendProofs); validateStarterProofs(receipt.starterProofs); }
  const proofs = receipt.proofs;
  const proot = receipt.route === "proot";
  const bases = proot ? ["ubuntu:24.04", "alpine"] : ["ubuntu:22.04", "alpine"];
  if (!Array.isArray(proofs) || proofs.length !== 2 || !bases.every(base => proofs.some(p =>
    p.base === base && p.status === "passed" && p.clientIntegrity === client.integrity && p.platformIntegrity === receipt.platform.integrity
    && p.expoIntegrity === receipt.expo.integrity && p.starters?.web === "passed" && p.starters?.expo === "passed" && p.starters?.adapted === "passed" && p.starters?.templates === "passed"
    && (proot ? p.runtime === "proot" && p.route === "proot" && matchesPinnedProof(p)
      : p.node === nodeVersion && /^(docker|podman)$/.test(p.runtime) && p.image && (!receipt.route || receipt.route === p.runtime)))))
    throw new Error(`Linux receipt needs successful Ubuntu ${proot ? "24.04" : "22.04"} and Alpine proofs bound to both artifacts and pinned Node/runtimes/root filesystems`);
  if (receipt.elf?.status !== "passed" || receipt.elf.machine !== "x86_64" || receipt.elf.interpreter !== null || !Array.isArray(receipt.elf.needed) || receipt.elf.needed.length)
    throw new Error("Linux receipt must record ELF with no interpreter and no NEEDED entries");
  const m = manifest(tarball, platforms[1], client.version);
  if (JSON.stringify(m.os) !== '["linux"]' || JSON.stringify(m.cpu) !== '["x64"]') throw new Error("Linux packed manifest must select linux/x64");
  const binary = member(tarball, "snapback4");
  if (!/^[a-f0-9]{64}$/.test(receipt.binarySha256 ?? "") || hash(binary) !== receipt.binarySha256)
    throw new Error("Linux packed binary does not match receipt sha256");
  // Pure byte inspection also runs on the Mac; the receipt is not ELF evidence.
  const elf = checkElf(binary);
  if (elf.interpreter !== null || elf.needed.length) throw new Error("Linux packed ELF must have no interpreter or NEEDED entries");
  return receipt;
}
