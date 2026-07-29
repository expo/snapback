import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const receipts = path.join(root, "receipts");
const classes = {
  authoredSource: ["src", "functions/index.js"],
  tests: ["scripts"],
  configuration: ["firebase.json", ".firebaserc", "firestore.indexes.json", "vite.config.ts", "tsconfig.json"],
  policy: ["firestore.rules", "database.rules.json"],
  dependencyManifests: ["package.json", "package-lock.json", "functions/package.json", "functions/package-lock.json"]
};

async function filesAt(candidate) {
  const absolute = path.join(root, candidate);
  const info = await stat(absolute);
  if (info.isFile()) return [absolute];
  const entries = await readdir(absolute, { withFileTypes: true });
  const nested = await Promise.all(entries
    .filter((entry) => entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== "receipts")
    .map((entry) => filesAt(path.relative(root, path.join(absolute, entry.name)))));
  return nested.flat();
}

async function summarize(candidates) {
  const files = (await Promise.all(candidates.map(filesAt))).flat();
  let bytes = 0;
  let lines = 0;
  for (const file of files) {
    const body = await readFile(file);
    bytes += body.byteLength;
    lines += body.toString("utf8").split("\n").length;
  }
  return { files: files.length, lines, bytes };
}

async function treeBytes(absolute) {
  const info = await stat(absolute);
  if (info.isFile()) return info.size;
  const entries = await readdir(absolute, { withFileTypes: true });
  const sizes = await Promise.all(entries.map((entry) => treeBytes(path.join(absolute, entry.name))));
  return sizes.reduce((sum, size) => sum + size, 0);
}

const inventory = {};
for (const [name, candidates] of Object.entries(classes)) {
  inventory[name] = await summarize(candidates);
}
inventory.generated = await summarize(["dist"]);
inventory.installedDependencyBytes =
  await treeBytes(path.join(root, "node_modules")) +
  await treeBytes(path.join(root, "functions/node_modules"));
inventory.glue = [
  {
    item: "Realtime Database typing lifecycle",
    classification: "application glue on native Firebase transport",
    files: ["scripts/acceptance.mjs"],
    note: "Firebase supplies RTDB realtime and onDisconnect; the typing timeout/removal policy is app-authored."
  },
  {
    item: "Protected-cache clearing",
    classification: "application responsibility",
    files: ["src/App.tsx"],
    note: "Firestore persistent cache retains previously authorized documents; the app clears rendered state on auth/revocation errors but SDK cache bytes remain."
  }
];
await writeFile(path.join(receipts, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify(inventory, null, 2));
