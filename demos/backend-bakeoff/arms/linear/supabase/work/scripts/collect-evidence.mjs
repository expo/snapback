import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "..");
const arm = path.resolve(work, "..");
const receipts = path.join(arm, "receipts");
const inventoryScript = path.resolve(work, "..", "..", "..", "..", "scripts", "inventory-arm.mjs");
const inventory = execFileSync(process.execPath, [inventoryScript, arm], {
  cwd: work,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
const audit = execFileSync("npm", ["audit", "--json"], {
  cwd: work,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});

await Promise.all([
  writeFile(path.join(receipts, "inventory.json"), inventory),
  writeFile(path.join(receipts, "npm-audit.json"), audit)
]);
console.log(JSON.stringify({
  inventory: "receipts/inventory.json",
  audit: JSON.parse(audit).metadata.vulnerabilities
}));
