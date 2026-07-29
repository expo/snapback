import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { actors, armDir, evidenceDir, runtimeDir, sha256, target, writeJson, workDir } from "./lib.mjs";

const t = await target();
const a = await actors();
const secretValues = [t.adminToken, ...Object.values(a).map((x) => x.token), "LLP0102_INSTANT_CANARY_DO_NOT_PERSIST"];
const roots = [
  path.join(workDir, "src"),
  path.join(workDir, "dist"),
  path.join(armDir, "receipts"),
  path.join(armDir, "evidence"),
];
const matches = [];
const walk = async (root) => {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile() && (await stat(file)).size <= 5_000_000) {
      const body = await readFile(file);
      for (let i = 0; i < secretValues.length; i++) {
        if (body.includes(Buffer.from(secretValues[i]))) matches.push({
          file: path.relative(armDir, file),
          secretSha256: sha256(secretValues[i]),
        });
      }
    }
  }
};
for (const root of roots) await walk(root);
const receipt = {
  schemaVersion: 1,
  scannedRoots: roots.map((root) => path.relative(armDir, root)),
  exactSecretValueCount: secretValues.length,
  matches,
  passed: matches.length === 0,
  runtimeSecrets: "ignored mode-0600 files excluded by design and removed in cleanup",
  containsCredentialValues: false,
};
await writeJson(path.join(evidenceDir, "secret-scan.json"), receipt);
if (!receipt.passed) throw new Error("STOP: retained client/evidence artifact contains a credential or canary.");
process.stdout.write(JSON.stringify({ ok: true, exactValuesScanned: secretValues.length, matches: 0 }) + "\n");
