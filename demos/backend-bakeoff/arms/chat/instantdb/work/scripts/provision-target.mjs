import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const runtime = resolve(root, ".arm-runtime");
const receipts = resolve(root, "..", "receipts");
const title = "llp0102-chat-instantdb-w2";
await mkdir(runtime, { recursive: true, mode: 0o700 });
await mkdir(receipts, { recursive: true });

const cli = resolve(root, "node_modules/.bin/instant-cli");
const result = spawnSync(
  cli,
  ["init-without-files", "--title", title, "--temp"],
  {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: resolve(root, ".arm-runtime/home"),
      XDG_CONFIG_HOME: resolve(root, ".arm-runtime/xdg/config"),
      XDG_CACHE_HOME: resolve(root, ".arm-runtime/xdg/cache"),
    },
  },
);
if (result.status !== 0) {
  await writeFile(
    resolve(receipts, "target-provision-failure.json"),
    `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      exitStatus: result.status,
      classification: "provider-or-environment",
      stderrSummary: (result.stderr || "").slice(-2000),
    }, null, 2)}\n`,
  );
  throw new Error(`temporary app provisioning failed with exit ${result.status}`);
}

const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
const jsonMatch = combined.match(/\{[\s\S]*\}/);
const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
const appId = parsed?.app?.appId ?? parsed?.app?.id ?? parsed?.appId;
const adminToken = parsed?.app?.adminToken ?? parsed?.adminToken;
if (!appId || !adminToken) {
  await writeFile(
    resolve(receipts, "target-provision-parse-failure.json"),
    `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      exitStatus: result.status,
      classification: "builder-error",
      responseObjectKeys: parsed ? Object.keys(parsed) : [],
      note: "The CLI may have created a temporary app; no raw response or credential was retained, so it cannot be addressed manually and will expire under the provider's temporary-app lifecycle.",
    }, null, 2)}\n`,
  );
  throw new Error("temporary app response did not contain the expected app id/token shape");
}
const target = {
  appId,
  adminToken,
  title,
  provisionedAt: new Date().toISOString(),
  mode: "fresh-hosted-temporary",
};
const targetPath = resolve(runtime, "target.json");
await writeFile(targetPath, JSON.stringify(target), { mode: 0o600 });
await chmod(targetPath, 0o600);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const receipt = {
  capturedAt: target.provisionedAt,
  provider: "InstantDB",
  targetMode: target.mode,
  title,
  appIdHash: hash(appId),
  adminTokenHash: hash(adminToken),
  namespace: title,
  credentialsPersistedOnlyAt: ".arm-runtime/target.json (0600, cleanup-bound)",
  containsCredentialValues: false,
};
await writeFile(
  resolve(receipts, "target-provision-redacted.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    targetMode: receipt.targetMode,
    appIdHash: receipt.appIdHash,
    namespace: title,
  }, null, 2)}\n`,
);
