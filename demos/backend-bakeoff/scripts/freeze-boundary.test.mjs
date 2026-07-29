import test from "node:test";
import assert from "node:assert/strict";
import { appendOnlyPrefixMatches, appendOnlyRecord, liveOutputDirectories } from "./freeze-boundary.mjs";

test("diary freeze accepts an appended entry", () => {
  const record = appendOnlyRecord("diary.md", "stage zero\n");
  assert.equal(appendOnlyPrefixMatches(record, "stage zero\nprovider entry\n"), true);
});

test("diary freeze rejects edits and truncation of the frozen prefix", () => {
  const record = appendOnlyRecord("diary.md", "stage zero\n");
  assert.equal(appendOnlyPrefixMatches(record, "stage one\nprovider entry\n"), false);
  assert.equal(appendOnlyPrefixMatches(record, "stage"), false);
});

test("living arm outputs are outside the immutable Stage 0 digest", () => {
  assert.deepEqual([...liveOutputDirectories].sort(), ["arms", "receipts", "reports"]);
});
