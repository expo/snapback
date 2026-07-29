import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arm = path.resolve(here, "..", "..");
const receipts = path.join(arm, "receipts");
const project = "llp0102-linear-supabase-w3";

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", env: process.env }).trim();
}

const containers = lines(docker([
  "ps", "-a", "--filter", `name=${project}`, "--format", "{{.Names}}|{{.Image}}|{{.Status}}"
])).map((line) => {
  const [name, image, status] = line.split("|");
  return { name, image, status };
});
const volumes = lines(docker(["volume", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"]));
const networks = lines(docker(["network", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"]));
const receipt = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  projectId: project,
  identityHash: createHash("sha256").update(`${project}|http://127.0.0.1:56431|56432`).digest("hex"),
  selection: "exact arm project-id substring only",
  containers,
  volumes,
  networks,
  counts: { containers: containers.length, volumes: volumes.length, networks: networks.length },
  unrelatedResourcesSelected: 0
};

await mkdir(receipts, { recursive: true });
await writeFile(path.join(receipts, "pre-cleanup-resources.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt.counts));

function lines(value) {
  return value.split(/\r?\n/).filter(Boolean);
}
