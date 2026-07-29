import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const sealedWork = path.resolve(root, "../work");
const preparedWork = path.resolve(root, "work");

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function files(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(absolute, relative));
    else if (entry.isFile()) output.push(relative);
  }
  return output;
}

const copiedPaths = (await files(preparedWork))
  .filter((relative) => relative !== ".gitignore")
  .filter((relative) => !relative.startsWith(".state/"))
  .filter((relative) => !relative.startsWith("dist/"))
  .filter((relative) => !relative.startsWith("receipts/"))
  .filter((relative) => !relative.startsWith("receipts-isolation-discovery/"))
  .filter((relative) => !relative.includes("node_modules/"))
  .filter((relative) => relative !== "tsconfig.tsbuildinfo")
  .filter((relative) => relative !== "firestore-debug.log")
  .sort();
const copiedFiles = [];
for (const relative of copiedPaths) {
  const source = await readFile(path.join(sealedWork, relative));
  const prepared = await readFile(path.join(preparedWork, relative));
  const sourceSha256 = sha256(source);
  const preparedSha256 = sha256(prepared);
  copiedFiles.push({
    path: relative,
    sourceSha256,
    preparedSha256,
    treatment: sourceSha256 === preparedSha256 ? "copied-byte-identical" : "copied-and-transformed",
  });
}
await writeFile(
  path.join(root, "copy-transform-manifest.v1.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    source: "../work",
    prepared: "work",
    copiedFileCount: copiedFiles.length,
    copiedFiles,
  }, null, 2)}\n`,
);

function lockDiff(source, prepared) {
  const changed = [];
  const added = [];
  const removed = [];
  const keys = new Set([...Object.keys(source.packages), ...Object.keys(prepared.packages)]);
  for (const key of [...keys].sort()) {
    if (!key) continue;
    const from = source.packages[key]?.version ?? null;
    const to = prepared.packages[key]?.version ?? null;
    if (from === to) continue;
    const row = { package: key.replace(/^node_modules\//, ""), from, to };
    if (from === null) added.push(row);
    else if (to === null) removed.push(row);
    else changed.push(row);
  }
  return {
    changed,
    added,
    removed,
    counts: { changed: changed.length, added: added.length, removed: removed.length },
  };
}

const rootSourceLock = JSON.parse(await readFile(path.join(sealedWork, "package-lock.json")));
const rootPreparedLock = JSON.parse(await readFile(path.join(preparedWork, "package-lock.json")));
const functionsSourceLock = JSON.parse(await readFile(path.join(sealedWork, "functions/package-lock.json")));
const functionsPreparedLock = JSON.parse(await readFile(path.join(preparedWork, "functions/package-lock.json")));
await writeFile(
  path.join(root, "dependency-diff.v1.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    requestedDirectChanges: [
      { package: "firebase-admin", from: "13.5.0", to: "14.2.0", manifests: ["work/package.json", "work/functions/package.json"] },
      { package: "firebase-functions", from: "6.4.0", to: "7.3.2", manifests: ["work/functions/package.json"] },
    ],
    compatibilityChanges: [
      { field: "work/functions/package.json#engines.node", from: "20", to: "22", reason: "firebase-admin 14 requires Node.js 22 or newer; Firebase Functions officially supports Node.js 22." },
    ],
    unchangedDirectVersions: {
      firebase: "12.16.0",
      firebaseTools: "15.24.0",
      react: "19.2.8",
      reactDom: "19.2.8",
      typescript: "7.0.2",
      vite: "8.1.5",
    },
    lockDiff: {
      root: lockDiff(rootSourceLock, rootPreparedLock),
      functions: lockDiff(functionsSourceLock, functionsPreparedLock),
    },
  }, null, 2)}\n`,
);

const evidencePaths = [
  "../run-capsule.v1.json",
  ...(await files(path.join(sealedWork, "receipts")))
    .map((relative) => `../work/receipts/${relative}`)
    .sort(),
];
const evidenceFiles = [];
for (const relative of evidencePaths) {
  const body = await readFile(path.resolve(root, relative));
  evidenceFiles.push({ path: relative, bytes: body.byteLength, sha256: sha256(body) });
}
await writeFile(
  path.join(root, "sealed-evidence-lineage.v1.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    treatment: "immutable lineage only; no Stage 5 result is claimed from these files",
    fileCount: evidenceFiles.length,
    files: evidenceFiles,
    aggregateSha256: sha256(JSON.stringify(evidenceFiles)),
  }, null, 2)}\n`,
);

const handoffPaths = (await files(root))
  .filter((relative) => relative !== "handoff-inventory.v1.json")
  .filter((relative) => !relative.startsWith("work/.state/"))
  .filter((relative) => !relative.startsWith("work/dist/"))
  .filter((relative) => !relative.includes("node_modules/"))
  .filter((relative) => relative !== "work/tsconfig.tsbuildinfo")
  .filter((relative) => relative !== "work/firestore-debug.log")
  .sort();
const handoffFiles = [];
for (const relative of handoffPaths) {
  const body = await readFile(path.join(root, relative));
  handoffFiles.push({ path: relative, bytes: body.byteLength, sha256: sha256(body) });
}
await writeFile(
  path.join(root, "handoff-inventory.v1.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    fileCount: handoffFiles.length,
    files: handoffFiles,
    aggregateSha256: sha256(JSON.stringify(handoffFiles)),
  }, null, 2)}\n`,
);
