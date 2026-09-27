import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { idFrom, mintId } from "../dist/client.js";
import { sha256, utf8 } from "../dist/sha256.js";

const idForm = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

// An independent derivation through node:crypto, which idFrom must match.
function reference(label) {
  const digest = createHash("sha256").update(JSON.stringify(["snapback4:id:v1", label])).digest();
  let value = 0n;
  for (const byte of digest.subarray(0, 10)) value = (value << 8n) | BigInt(byte);
  let id = "";
  for (let i = 0; i < 26; i++) { id = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Number(value & 31n)] + id; value >>= 5n; }
  return id;
}

test("the portable SHA-256 matches node:crypto, UTF-8 and lone surrogates included", () => {
  const samples = ["", "a", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(119), "x".repeat(120), "x".repeat(1000), "héllo", "日本語", "😀 emoji", "\ud800 lone", "tail \udfff"];
  for (let i = 0; i < 200; i++) samples.push(randomBytes(i % 97).toString("latin1") + String.fromCodePoint(0x10000 + i * 331));
  for (const text of samples) {
    assert.deepEqual(Buffer.from(utf8(text)), Buffer.from(text, "utf8"), JSON.stringify(text));
    assert.equal(Buffer.from(sha256(utf8(text))).toString("hex"), createHash("sha256").update(text, "utf8").digest("hex"), JSON.stringify(text));
  }
});

test("idFrom names a stable, valid id for a label", () => {
  const id = idFrom("post-17");
  assert.match(id, idForm);
  assert.equal(idFrom("post-17"), id, "the same label gives the same id");
  assert.notEqual(idFrom("post-18"), id);
  assert.notEqual(idFrom("Post-17"), id);
  // Pinned: the derivation is part of the contract, so fixtures replay across releases.
  assert.equal(id, reference("post-17"));
  const seen = new Set();
  for (let i = 0; i < 10_000; i++) {
    const next = idFrom(`fixture-${i}`);
    assert.equal(next, reference(`fixture-${i}`));
    seen.add(next);
  }
  assert.equal(seen.size, 10_000);
  assert.match(mintId(), idForm, "idFrom shares mintId's form");
  assert.match(id, /^0{10}/, "a derived id carries a zero time");
  for (let i = 0; i < 100; i++) assert.ok(idFrom(`fixture-${i}`) < mintId(), "a derived id sorts before every id minted now");
  assert.throws(() => idFrom(""), /non-empty string/);
  assert.throws(() => idFrom(17), /non-empty string/);
});
