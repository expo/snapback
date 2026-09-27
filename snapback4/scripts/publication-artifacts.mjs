// @ref LLP 3000.021#3.3 — one client digest, platform-local qualification, digest-only import
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
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
export function validateLinux(receipt, tarball, client, source) {
  if (receipt.format !== 1 || receipt.platform?.name !== platforms[1] || receipt.platform.version !== client.version || receipt.source !== source || !/^[a-f0-9]{40}$/.test(source ?? ""))
    throw new Error("Linux receipt source/version/platform does not match the prepared release");
  if (receipt.target !== linuxTarget || receipt.flags?.LIBSQLITE3_FLAGS !== sqliteBuildFlags || receipt.flags?.RUSTFLAGS !== linuxRustFlags || !receipt.toolchain?.rustc || !receipt.toolchain?.cc || !receipt.toolchain?.linker)
    throw new Error("Linux receipt target/toolchain/SQLite flags are incomplete or differ");
  if (receipt.suite?.status !== "passed" || receipt.suite.exitCode !== 0 || !/^== 0 failure\(s\) in \d+ s$/.test(receipt.suite.summary ?? ""))
    throw new Error("Linux receipt does not carry a successful suite result");
  if (receipt.clientIntegrity !== client.integrity) throw new Error("Linux receipt proved a different client SRI");
  if (sri(tarball) !== receipt.platform.integrity) throw new Error("Linux tarball does not match receipt SRI");
  const proofs = receipt.proofs;
  if (!Array.isArray(proofs) || proofs.length !== 2 || !["ubuntu:22.04", "alpine"].every(base => proofs.some(p => p.base === base && p.status === "passed" && p.node === nodeVersion && /^(docker|podman)$/.test(p.runtime) && p.image && p.clientIntegrity === client.integrity && p.platformIntegrity === receipt.platform.integrity)))
    throw new Error("Linux receipt needs successful Ubuntu 22.04 and Alpine proofs bound to both artifacts and pinned Node");
  if (receipt.elf?.status !== "passed" || receipt.elf.machine !== "x86_64" || receipt.elf.interpreter !== null || !Array.isArray(receipt.elf.needed) || receipt.elf.needed.length)
    throw new Error("Linux receipt must record ELF with no interpreter and no NEEDED entries");
  const m = manifest(tarball, platforms[1], client.version);
  if (JSON.stringify(m.os) !== '["linux"]' || JSON.stringify(m.cpu) !== '["x64"]') throw new Error("Linux packed manifest must select linux/x64");
  if (!/^[a-f0-9]{64}$/.test(receipt.binarySha256 ?? "") || hash(member(tarball, "snapback4")) !== receipt.binarySha256)
    throw new Error("Linux packed binary does not match receipt sha256");
  return receipt;
}
