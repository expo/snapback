import { createHash } from "node:crypto";

export const liveOutputDirectories = new Set(["arms", "reports", "receipts"]);

export function appendOnlyRecord(path, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    path,
    prefixBytes: bytes.byteLength,
    prefixSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function appendOnlyPrefixMatches(record, currentBody) {
  const bytes = Buffer.isBuffer(currentBody) ? currentBody : Buffer.from(currentBody);
  if (bytes.byteLength < record.prefixBytes) return false;
  return createHash("sha256")
    .update(bytes.subarray(0, record.prefixBytes))
    .digest("hex") === record.prefixSha256;
}
