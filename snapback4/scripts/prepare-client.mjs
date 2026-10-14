import { lintPackagedDocs } from "./packaged-docs.mjs";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { artifact, cleanSource, clientManifest, json, platforms, run, save, verifyArtifact } from "./publication-artifacts.mjs";
// @ref LLP 3000.021#3.3 — pack once, after rebuilding generated wasm and removing dist
export function prepareClient(root, version, directory, selectedPlatforms = platforms) {
  lintPackagedDocs(root);
  const receiptPath = join(directory, "prepare.json");
  if (existsSync(receiptPath)) throw new Error(`prepared client already exists at ${receiptPath}; reuse it or bump the release version`);
  const source = cleanSource(root), pkg = join(root, "packages/snapback4");
  run("bash", [join(root, "scripts/build-wasm.sh")], { cwd: root, stdio: "inherit" });
  rmSync(join(pkg, "dist"), { recursive: true, force: true });
  run("bun", ["run", "--cwd", pkg, "build"], { cwd: root });
  const work = mkdtempSync(join(tmpdir(), "snapback4-client-"));
  try {
    // Select dependencies before packing without editing the release checkout.
    const packPkg = join(work, "snapback4");
    cpSync(pkg, packPkg, { recursive: true, filter: path => basename(path) !== "node_modules" });
    const m = json(join(packPkg, "package.json"));
    m.optionalDependencies = Object.fromEntries(selectedPlatforms.map(name => [name, version]));
    save(join(packPkg, "package.json"), m);
    const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], { cwd: packPkg }));
    const tarball = join(work, packed.filename);
    clientManifest(tarball, version, selectedPlatforms);
    if (cleanSource(root) !== source) throw new Error("release source changed during client preparation");
    mkdirSync(directory, { recursive: true });
    copyFileSync(tarball, join(directory, packed.filename));
    const [expoPacked] = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", work], { cwd: join(root, "packages/snapback4-expo") }));
    const expoTarball = join(work, expoPacked.filename);
    copyFileSync(expoTarball, join(directory, expoPacked.filename));
    if (cleanSource(root) !== source) throw new Error("release source changed during Expo packing");
    save(receiptPath, { format: 1, source, expo: artifact(expoTarball, "snapback4-expo", version), client: artifact(tarball, "snapback4", version, { files: packed.entryCount }) });
  } finally { rmSync(work, { recursive: true, force: true }); }
  return loadPrepared(directory, version, selectedPlatforms);
}
export function loadPrepared(directory, version, selectedPlatforms = platforms) {
  const receipt = json(join(directory, "prepare.json"));
  if (receipt.format !== 1 || !/^[a-f0-9]{40}$/.test(receipt.source ?? "") || receipt.client?.name !== "snapback4") throw new Error("invalid prepared client receipt");
  receipt.client = verifyArtifact(receipt.client, directory, version);
  receipt.expo = verifyArtifact(receipt.expo, directory, version);
  if (receipt.expo.name !== "snapback4-expo") throw new Error("prepared Expo artifact must name snapback4-expo");
  clientManifest(receipt.client.tarball, version, selectedPlatforms);
  return receipt;
}
