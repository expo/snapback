import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init, tx, lookup } from "@instantdb/admin";
import schema from "../instant.schema.ts";

export const workDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const armDir = path.resolve(workDir, "..");
export const runtimeDir = path.join(workDir, ".arm-runtime");
export const evidenceDir = path.join(armDir, "evidence");
export const receiptsDir = path.join(armDir, "receipts");
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const uuid = () => randomUUID();
export const json = async (file) => JSON.parse(await readFile(file, "utf8"));
export const writeJson = async (file, value, mode) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
  if (mode) await chmod(file, mode);
};
export const target = async () => json(path.join(runtimeDir, "target.json"));
export const actors = async () => json(path.join(runtimeDir, "actors.json"));
export const fixture = async () => json(path.join(runtimeDir, "fixture.json"));
export const adminDb = async () => {
  const t = await target();
  return init({ appId: t.appId, adminToken: t.adminToken, schema });
};
export const scopedDb = async (token) => {
  const db = await adminDb();
  return db.asUser({ token });
};
export { tx, lookup };

export const settle = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const sourceBytes = (n) => {
  const prefix = `source-${String(n).padStart(2, "0")} climate adaptation evidence\n`;
  return Buffer.from((prefix + "x".repeat(65536)).slice(0, 65536));
};
export const embedding = (n) =>
  Array.from({ length: 32 }, (_, i) => Number((((n * 17 + i * 13) % 101) / 100).toFixed(2)));
export const queryRows = (payload, key) => payload?.[key] ?? [];
