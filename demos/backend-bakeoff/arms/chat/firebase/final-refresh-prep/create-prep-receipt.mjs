#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const armRoot = path.resolve(here, "..");
const sealedRoot = path.join(armRoot, "work");
const refreshedRoot = path.join(here, "work");
const receiptsRoot = path.join(here, "receipts");
const capsulePath = path.join(armRoot, "run-capsule.v1.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function files(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const collected = [];
  for (const entry of entries) {
    if (["node_modules", "dist", "receipts"].includes(entry.name)) continue;
    if (entry.name === "tsconfig.tsbuildinfo") continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) collected.push(...await files(root, child));
    else if (entry.isFile()) collected.push(child);
  }
  return collected.sort();
}

const sourceFiles = await files(sealedRoot);
const refreshedFiles = await files(refreshedRoot);
if (JSON.stringify(sourceFiles) !== JSON.stringify(refreshedFiles)) {
  throw new Error("refreshed file inventory is not a complete source/config copy");
}

const transformations = [];
for (const relative of sourceFiles) {
  const before = await readFile(path.join(sealedRoot, relative));
  const after = await readFile(path.join(refreshedRoot, relative));
  const beforeSha256 = sha256(before);
  const afterSha256 = sha256(after);
  transformations.push({
    path: relative,
    operation: beforeSha256 === afterSha256 ? "copied-byte-identical" : "refreshed",
    beforeSha256,
    afterSha256
  });
}

const rootPackage = JSON.parse(await readFile(path.join(refreshedRoot, "package.json"), "utf8"));
const rootLock = JSON.parse(await readFile(path.join(refreshedRoot, "package-lock.json"), "utf8"));
const functionsPackage = JSON.parse(await readFile(path.join(refreshedRoot, "functions/package.json"), "utf8"));
const functionsLock = JSON.parse(await readFile(path.join(refreshedRoot, "functions/package-lock.json"), "utf8"));
const scanText = (await Promise.all(
  refreshedFiles
    .filter((relative) => !relative.endsWith("package-lock.json"))
    .map((relative) => readFile(path.join(refreshedRoot, relative), "utf8"))
)).join("\n");
const runtimeBindingScanText = (await Promise.all(
  refreshedFiles
    .filter((relative) =>
      !relative.endsWith("package-lock.json")
      && relative !== "scripts/cleanup.mjs"
    )
    .map((relative) => readFile(path.join(refreshedRoot, relative), "utf8"))
)).join("\n");
const cleanupSource = await readFile(path.join(refreshedRoot, "scripts/cleanup.mjs"), "utf8");

const receipt = {
  schemaVersion: "llp0102.firebase-final-refresh-prep.v1",
  coordinatorBase: "8cd9e46794038239279587702fb4728e4f2bc589",
  arm: "chat/firebase",
  sealed: {
    workPath: path.relative(armRoot, sealedRoot),
    workTrackedMutation: false,
    runCapsulePath: path.relative(armRoot, capsulePath),
    runCapsuleSha256: sha256(await readFile(capsulePath)),
    runCapsuleMutation: false
  },
  target: {
    namespace: "llp0102-final-chat-firebase-w2",
    mode: "fresh-local-emulator",
    ports: {
      auth: 35299,
      firestore: 35280,
      firestoreWebsocket: 35250,
      realtimeDatabase: 35281,
      functions: 35287,
      vite: 35288,
      hub: 35201,
      logging: 35202,
      eventarc: 35203,
      tasks: 35204
    }
  },
  dependencies: {
    firebaseClient: rootPackage.dependencies.firebase,
    firebaseTools: rootPackage.devDependencies["firebase-tools"],
    rootFirebaseAdmin: {
      declared: rootPackage.devDependencies["firebase-admin"],
      locked: rootLock.packages["node_modules/firebase-admin"].version,
      previous: "13.5.0"
    },
    functionsFirebaseAdmin: {
      declared: functionsPackage.dependencies["firebase-admin"],
      locked: functionsLock.packages["node_modules/firebase-admin"].version,
      previous: "13.5.0"
    },
    firebaseFunctions: {
      declared: functionsPackage.dependencies["firebase-functions"],
      locked: functionsLock.packages["node_modules/firebase-functions"].version,
      previous: "6.4.0"
    },
    importPathTreatment: "current modular firebase-admin subpaths and firebase-functions/v2/https retained"
  },
  transformations,
  scans: {
    oldNamespaceAbsent: !scanText.includes("llp0102-chat-firebase-w1"),
    oldRuntimeBindingsAbsent:
      !/\b(?:9299|9499|8280|9280|5287|4287|4501|4502|9150)\b/.test(runtimeBindingScanText),
    legacyDefaultPortsReferencedOnlyForCleanupProof:
      /\b9299\b/.test(cleanupSource)
      && /\b9499\b/.test(cleanupSource)
      && !/\b(?:8280|9280|5287|4287|4501|4502|9150)\b/.test(cleanupSource),
    sourceAndConfigInventoryComplete: true
  },
  gate: {
    releasedByCoordinator: true,
    providerStartedDuringPrep: false
  }
};

if (
  receipt.dependencies.rootFirebaseAdmin.declared !== "14.2.0"
  || receipt.dependencies.rootFirebaseAdmin.locked !== "14.2.0"
  || receipt.dependencies.functionsFirebaseAdmin.declared !== "14.2.0"
  || receipt.dependencies.functionsFirebaseAdmin.locked !== "14.2.0"
  || receipt.dependencies.firebaseFunctions.declared !== "7.3.2"
  || receipt.dependencies.firebaseFunctions.locked !== "7.3.2"
  || Object.values(receipt.scans).some((value) => value !== true)
) {
  throw new Error(`refresh prep validation failed: ${JSON.stringify(receipt, null, 2)}`);
}

await mkdir(receiptsRoot, { recursive: true });
const receiptPath = path.join(receiptsRoot, "prep-transformation.v1.json");
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, receiptPath, files: transformations.length }));
