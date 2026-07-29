import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armDir = path.resolve(workDir, "..");
const runtimeDir = path.join(workDir, ".arm-runtime");
const receiptsDir = path.join(armDir, "receipts");
const title = "llp0102-research-instantdb-w3-a1";
await Promise.all([
  mkdir(runtimeDir, { recursive: true, mode: 0o700 }),
  mkdir(receiptsDir, { recursive: true }),
  mkdir(path.join(runtimeDir, "xdg", "config"), { recursive: true, mode: 0o700 }),
  mkdir(path.join(runtimeDir, "xdg", "cache"), { recursive: true, mode: 0o700 }),
]);

const provisioningBeganAt = new Date().toISOString();
const command = spawnSync(
  "npx",
  [
    "--yes",
    "instant-cli@1.0.52",
    "init-without-files",
    "--title",
    title,
    "--temp",
  ],
  {
    cwd: workDir,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: path.join(runtimeDir, "xdg", "config"),
      XDG_CACHE_HOME: path.join(runtimeDir, "xdg", "cache"),
    },
  },
);
if (command.status !== 0) {
  const rawFailurePath = path.join(runtimeDir, `provision-failure-${Date.now()}.log`);
  await writeFile(
    rawFailurePath,
    `${String(command.stdout)}\n${String(command.stderr)}`,
    { mode: 0o600 },
  );
  await chmod(rawFailurePath, 0o600);
  const receipt = {
    schemaVersion: 1,
    failedAt: new Date().toISOString(),
    classification: "provider-or-environment",
    command: "instant-cli init-without-files --title <exact-arm-title> --temp",
    exitCode: command.status,
    rawOutputLocation: "ignored mode-0600 runtime file",
    containsCredentialValues: false,
  };
  await writeFile(
    path.join(receiptsDir, `provision-failure-${Date.now()}.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  throw new Error(`Instant target provisioning exited ${command.status}`);
}

const stdout = String(command.stdout);
const firstBrace = stdout.indexOf("{");
const lastBrace = stdout.lastIndexOf("}");
if (firstBrace < 0 || lastBrace <= firstBrace) {
  throw new Error("Instant target provisioning returned no JSON object.");
}
const payload = JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
const app = payload.app ?? payload;
const appId = app.appId;
const adminToken = app.adminToken;
if (!appId || !adminToken) throw new Error("Instant target provisioning omitted app credentials.");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const target = {
  appId,
  adminToken,
  title,
  provisionedAt: new Date().toISOString(),
};
const targetPath = path.join(runtimeDir, "target.json");
await writeFile(targetPath, `${JSON.stringify(target)}\n`, { mode: 0o600 });
await chmod(targetPath, 0o600);

const receipt = {
  schemaVersion: 1,
  provisioningBeganAt,
  provisionedAt: target.provisionedAt,
  command: "instant-cli@1.0.52 init-without-files --title <exact-arm-title> --temp",
  exitCode: 0,
  target: {
    title,
    appIdSha256: sha256(appId),
    adminTokenSha256: sha256(adminToken),
    profile: "official hosted temporary app",
    lifecycle: "provider automatically deletes after more than 24 hours",
    freshByConstruction: true
  },
  localState: {
    targetCredentials: "work/.arm-runtime/target.json mode 0600",
    xdgRoots: "work/.arm-runtime/xdg",
    retainedAfterCleanup: false
  },
  containsCredentialValues: false
};
await writeFile(
  path.join(receiptsDir, "target-provision-redacted.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({
  ok: true,
  provisioningBeganAt,
  targetIdSha256: sha256(appId),
  title,
})}\n`);
