import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateDigest,
  digestRecord,
  liveOutputDirectories,
} from "./freeze-boundary.mjs";

test("live output directories stay outside the freeze", () => {
  assert.deepEqual(
    [...liveOutputDirectories].sort(),
    ["arms", "probes", "receipts", "reports"],
  );
});

test("digest records are stable and content-bound", () => {
  const record = digestRecord("a/b.json", "body");
  assert.equal(record.bytes, 4);
  assert.equal(record.sha256.length, 64);
  assert.equal(
    digestRecord("a/b.json", "body").sha256,
    record.sha256,
  );
  assert.notEqual(
    digestRecord("a/b.json", "other").sha256,
    record.sha256,
  );
});

test("aggregate digest depends on paths and order", () => {
  const one = digestRecord("a.json", "x");
  const two = digestRecord("b.json", "y");
  assert.notEqual(aggregateDigest([one, two]), aggregateDigest([two, one]));
  assert.equal(aggregateDigest([one]).length, 64);
});
