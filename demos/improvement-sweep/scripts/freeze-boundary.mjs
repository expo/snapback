import { createHash } from "node:crypto";

// @ref LLP 0137#g0--sweep-freeze — the freeze digest binds the protocol
// artifacts; arms, probes, receipts, and reports stay outside it because the
// sweep's fix loop keeps producing evidence after G0.
export const liveOutputDirectories = new Set([
  "arms",
  "probes",
  "receipts",
  "reports",
]);

export function digestRecord(path, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    path,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function aggregateDigest(records) {
  return createHash("sha256")
    .update(records.map((item) => `${item.sha256}  ${item.path}\n`).join(""))
    .digest("hex");
}
