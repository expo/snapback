#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdk = join(root, "packages/snapback3");
const host = `${process.platform}-${process.arch}`;
const executable = process.platform === "win32" ? "snapback3-worker.exe" : "snapback3-worker";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
if (process.argv.length > 3 || process.argv[2]?.startsWith("--")) throw new Error("Usage: node scripts/pack.mjs [output-directory]");
const output = resolve(process.argv[2] ?? join(root, ".snapback3/packages"));
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(join(output, ".pack-"));
const staged = join(scratch, "package");

try {
  const before = await sourceDigest();
  await command(cargo, ["build", "--locked", "--release", "-p", "snapback3-worker", "--target-dir", join(root, "target")]);
  await command(process.execPath, [join(root, "build.mjs"), "--out-dir", join(staged, "dist")]);
  if (before !== await sourceDigest()) throw new Error("Package inputs changed during the build. Rerun after the current edits finish.");
  const binary = join(staged, "dist/native", host, executable);
  await mkdir(dirname(binary), { recursive: true });
  await cp(join(root, "target/release", executable), binary);
  await chmod(binary, 0o755);
  await chmod(join(staged, "dist/cli.mjs"), 0o755);
  await cp(join(root, "LICENSE"), join(staged, "LICENSE"));
  const manifest = JSON.parse(await readFile(join(sdk, "package.json"), "utf8"));
  delete manifest.scripts;
  Object.assign(manifest, { private: true, os: [process.platform], cpu: [process.arch] });
  await writeFile(join(staged, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  const nativeHash = createHash("sha256").update(await readFile(binary)).digest("hex");
  const native = { experimental: true, host, node: process.version, sourceSha256: before, nativeSha256: nativeHash };
  await writeFile(join(staged, "dist/package-build.json"), JSON.stringify(native, null, 2) + "\n");
  await writeFile(join(staged, "README.md"), `# Snapback 3\n\nThis private experimental tarball includes the native worker for **${host}**.\nIt has been tested on the build host; other operating systems and architectures\nneed their own build. No worker override or repository checkout is required.\n\nInstall this tarball into an application, then run:\n\n\`\`\`sh\nnpx snapback3 check .\nnpx snapback3 dev . --port 4383\n\`\`\`\n\nAuthor Quarry in \`snapback/\`. JavaScript exports are \`snapback3\`,\n\`snapback3/client\`, \`snapback3/react\`, and \`snapback3/compiler\`.\nThis package supports the initial query/mutation product slice; it is not a\nproduction release.\n`);
  const packed = JSON.parse((await execute(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch], {
    cwd: staged, maxBuffer: 8 * 1024 * 1024,
  })).stdout)[0];
  const archive = join(output, `snapback3-${manifest.version}-${host}.tgz`);
  const candidate = join(scratch, packed.filename);
  // Preserve the last qualified archive and report if installation or smoke
  // fails. A candidate becomes the named package only after its checks pass.
  const smoke = await execute(process.execPath, [join(root, "scripts/smoke-package.mjs"), candidate], {
    cwd: root, timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
  });
  const report = { archive, ...native, bytes: packed.size, unpackedBytes: packed.unpackedSize,
    sha256: createHash("sha256").update(await readFile(candidate)).digest("hex"), smoke: JSON.parse(smoke.stdout) };
  const reportPath = join(scratch, "qualified-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await rename(candidate, archive);
  await rename(reportPath, archive + ".json");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(scratch, { recursive: true, force: true });
}

async function command(file, args) {
  process.stderr.write(`snapback3 pack: ${file === process.execPath ? "node" : file} ${args.join(" ")}\n`);
  const result = await execute(file, args, { cwd: root, timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

async function sourceDigest() {
  const hash = createHash("sha256");
  const files = [];
  async function walk(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (["node_modules", "dist", "target", ".snapback3", "test", "tests"].includes(entry.name)) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  for (const name of ["Cargo.toml", "Cargo.lock", "build.mjs", "package.json", "bun.lock", "LICENSE"]) files.push(join(root, name));
  for (const name of ["crates", "packages", "unicode"]) await walk(join(root, name));
  for (const file of files.sort()) hash.update(relative(root, file)).update("\0").update(await readFile(file)).update("\0");
  return hash.digest("hex");
}
