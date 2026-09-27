import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { artifact, cleanSource, clientManifest, json, run, save, verifyArtifact } from "./publication-artifacts.mjs";
// @ref LLP 3000.021#3.3 — pack once, after rebuilding generated wasm and removing dist
export function prepareClient(root, version, directory) {
  const receiptPath = join(directory, "prepare.json");
  if (existsSync(receiptPath)) throw new Error(`prepared client already exists at ${receiptPath}; reuse it or bump the release version`);
  const source = cleanSource(root), pkg = join(root, "packages/snapback4");
  run("bash", [join(root, "scripts/build-wasm.sh")], { cwd: root, stdio: "inherit" });
  rmSync(join(pkg, "dist"), { recursive: true, force: true });
  run("bun", ["run", "--cwd", pkg, "build"], { cwd: root });
  const work = mkdtempSync(join(tmpdir(), "snapback4-client-"));
  try {
    const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], { cwd: pkg }));
    const tarball = join(work, packed.filename);
    clientManifest(tarball, version);
    if (cleanSource(root) !== source) throw new Error("release source changed during client preparation");
    mkdirSync(directory, { recursive: true });
    copyFileSync(tarball, join(directory, packed.filename));
    save(receiptPath, { format: 1, source, client: artifact(tarball, "snapback4", version, { files: packed.entryCount }) });
  } finally { rmSync(work, { recursive: true, force: true }); }
  return loadPrepared(directory, version);
}
export function loadPrepared(directory, version) {
  const receipt = json(join(directory, "prepare.json"));
  if (receipt.format !== 1 || !/^[a-f0-9]{40}$/.test(receipt.source ?? "") || receipt.client?.name !== "snapback4") throw new Error("invalid prepared client receipt");
  receipt.client = verifyArtifact(receipt.client, directory, version);
  clientManifest(receipt.client.tarball, version);
  return receipt;
}
