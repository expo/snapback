import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const classes = {
  authoredSource: ["src", "functions/index.js"],
  tests: ["scripts"],
  configuration: [
    "firebase.json",
    ".firebaserc",
    "firestore.indexes.json",
    "vite.config.ts",
    "tsconfig.json",
  ],
  policy: ["firestore.rules", "storage.rules"],
  dependencyManifests: [
    "package.json",
    "package-lock.json",
    "functions/package.json",
    "functions/package-lock.json",
  ],
};

async function filesAt(candidate) {
  const absolute = path.join(root, candidate);
  const info = await stat(absolute);
  if (info.isFile()) return [absolute];
  const entries = await readdir(absolute, { withFileTypes: true });
  return (await Promise.all(entries
    .filter((entry) => !["node_modules", "dist", "receipts", ".state"].includes(entry.name))
    .map((entry) => filesAt(path.relative(root, path.join(absolute, entry.name)))))).flat();
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
  return (await Promise.all((await readdir(absolute, { withFileTypes: true }))
    .map((entry) => treeBytes(path.join(absolute, entry.name)))))
    .reduce((sum, value) => sum + value, 0);
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
    item: "Full-text issue search",
    classification: "explicit GAP",
    files: [],
    note: "Firestore has no native full-text search; no external service was added merely to manufacture a pass.",
  },
  {
    item: "Relational detail composition",
    classification: "application-authored fan-out",
    files: ["scripts/acceptance.mjs"],
    note: "Firestore supplies point/indexed queries but no server join; issue detail composes bounded reads in application code.",
  },
  {
    item: "Migration backfill",
    classification: "application-authored operation",
    files: ["scripts/acceptance.mjs", "firestore.indexes.json"],
    note: "Firestore is schemaless; adding an indexed field required an Admin SDK BulkWriter backfill plus index declaration.",
  },
];
await writeFile("receipts/inventory.json", `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify(inventory, null, 2));
