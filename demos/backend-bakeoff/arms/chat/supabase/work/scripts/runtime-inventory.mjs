import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arm = path.resolve(here, "..", "..");
const receipts = path.join(arm, "receipts");
const project = "llp0102-chat-supabase-w3";

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", env: process.env }).trim();
}

const containers = docker(["ps", "-a", "--filter", `name=${project}`, "--format", "{{.Names}}|{{.Image}}|{{.Status}}"])
  .split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, image, status] = line.split("|");
    return { name, image, status };
  });
const volumes = docker(["volume", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"])
  .split(/\r?\n/).filter(Boolean);
const networks = docker(["network", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"])
  .split(/\r?\n/).filter(Boolean);

const receipt = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  projectId: project,
  identityHash: createHash("sha256").update(`${project}|http://127.0.0.1:55421|55422`).digest("hex"),
  containers,
  volumes,
  networks,
  counts: { containers: containers.length, volumes: volumes.length, networks: networks.length }
};

await mkdir(receipts, { recursive: true });
await writeFile(path.join(receipts, "pre-cleanup-resources.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt.counts));
