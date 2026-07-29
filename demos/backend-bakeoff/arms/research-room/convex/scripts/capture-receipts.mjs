import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const arm = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = execFileSync("git", ["-C", arm, "rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const state = path.join(repo, ".arm-state");
const logs = path.join(state, "logs");
const digest = (data) => createHash("sha256").update(data).digest("hex");

const commandLogs = [];
for (const name of (await readdir(logs)).filter((name) => name.endsWith(".raw.log")).sort()) {
  const data = await readFile(path.join(logs, name));
  commandLogs.push({ name, sha256: digest(data), bytes: data.length });
}

const readOptional = async (name) => {
  try {
    return (await readFile(path.join(logs, name), "utf8")).trim();
  } catch {
    return null;
  }
};

const osRelease = Object.fromEntries(
  (await readFile("/etc/os-release", "utf8"))
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^"|"$/g, "")];
    }),
);
const meminfo = await readFile("/proc/meminfo", "utf8");
const memoryKiB = Number(meminfo.match(/^MemTotal:\s+(\d+)/m)?.[1] ?? 0);

const receipt = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  baseCommit: execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  frozenSnapbackSourceCommit: "5f31cb6174daaefa04a1e05242acbbc22c725040",
  namespace: await readOptional("namespace"),
  timestamps: {
    timedStart: await readOptional("timed-start.utc"),
    provisioningStart: await readOptional("provisioning-start.utc"),
    r2ProvisioningStart: await readOptional("r2-provisioning-start.utc"),
  },
  machine: {
    hostname: execFileSync("hostname", [], { encoding: "utf8" }).trim(),
    architecture: process.arch,
    os: `${osRelease.PRETTY_NAME}`,
    kernel: execFileSync("uname", ["-r"], { encoding: "utf8" }).trim(),
    logicalCpuCount: Number(execFileSync("nproc", [], { encoding: "utf8" }).trim()),
    memoryBytes: memoryKiB * 1024,
    node: process.version,
  },
  isolation: {
    r1ContainmentProof: await readOptional("r1-containment-proof.txt"),
    r2IsolationProof: await readOptional("r2-isolation-proof.txt"),
    backendPort: 3345,
    sitePort: 3346,
    vitePort: 4345,
    processProofPolicy: "PID, owner, executable, bind address, and argv flag names only; never argv values",
  },
  commandLogs,
};

await writeFile(
  path.join(arm, "evidence", "isolation-and-command-receipts.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
