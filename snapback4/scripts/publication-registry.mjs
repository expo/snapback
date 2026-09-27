import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { run, verifyArtifact } from "./publication-artifacts.mjs";

// @ref LLP 3000.021#3.3 — copy then verify all qualified bytes before any upload
export function withPublicationSnapshot(artifacts, publish) {
  const directory = mkdtempSync(join(tmpdir(), "snapback4-publish-snapshot-"));
  try {
    if (new Set(artifacts.map(a => a.filename)).size !== artifacts.length) throw new Error("publication artifact filenames must be unique");
    const snapshot = artifacts.map(a => {
      const path = join(directory, a.filename);
      copyFileSync(a.tarball, path);
      chmodSync(path, 0o400);
      return verifyArtifact(a, directory, a.version);
    });
    return publish(snapshot);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
export function registryIntegrity(name, selectedVersion) {
  const result = spawnSync("npm", ["view", `${name}@${selectedVersion}`, "dist.integrity", "--json"], { encoding: "utf8", env: process.env });
  if (result.status === 0) {
    let value;
    try { value = JSON.parse(result.stdout || "null"); }
    catch { throw new Error(`npm view ${name}@${selectedVersion} returned malformed integrity JSON`); }
    if (typeof value !== "string" || !value.startsWith("sha512-")) throw new Error(`npm view ${name}@${selectedVersion} returned no unambiguous dist.integrity`);
    return value;
  }
  const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/(?:E404|404 Not Found|is not in this registry)/i.test(detail)) return undefined;
  throw new Error(`npm view ${name}@${selectedVersion} failed\n${detail.trim()}`);
}

export function converge(artifact, directory) {
  const published = registryIntegrity(artifact.name, artifact.version);
  if (published === artifact.integrity) {
    console.log(`publish: ${artifact.name}@${artifact.version} already matches staged artifact`);
    return;
  }
  if (published !== undefined) throw new Error(`${artifact.name}@${artifact.version} already exists with integrity ${published}; staged artifact is ${artifact.integrity}`);
  console.log(`== npm publish ${artifact.filename}`);
  // Check the private copy against the loaded receipt immediately before upload,
  // after even the last registry command. Never rely on the post-upload check.
  verifyArtifact(artifact, dirname(artifact.tarball), artifact.version);
  run("npm", ["publish", artifact.tarball, "--access", "public"], { cwd: directory });
  // npm answers "your package is being processed"; dist.integrity is not readable
  // for a minute or two after a successful upload. Reading it immediately failed
  // two 0.2.27 attempts on packages that had in fact published, so wait for the
  // registry rather than calling an accepted upload a failure. Observed
  // propagation on 2026-09-17: 60 s, 90 s and 120 s for the three packages.
  const deadline = Date.now() + 10 * 60 * 1000;
  let after = registryIntegrity(artifact.name, artifact.version);
  while (after === undefined && Date.now() < deadline) {
    process.stdout.write(`publish: waiting for ${artifact.name}@${artifact.version} to become readable\n`);
    spawnSync("sleep", ["15"]);
    after = registryIntegrity(artifact.name, artifact.version);
  }
  if (after !== artifact.integrity) throw new Error(`npm published ${artifact.name}@${artifact.version}, but registry integrity is ${after ?? "absent after waiting 10 minutes"}; expected ${artifact.integrity}`);
}
