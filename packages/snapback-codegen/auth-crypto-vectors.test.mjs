import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

// @ref LLP 0055#keyring-and-crypto — a second language pins the exact v1
// canonicalization, length-prefix, HMAC, base64url, checksum, and token-hash
// bytes consumed by the Rust provider.

const lp = (value) => {
  const bytes = Buffer.from(value);
  const framed = Buffer.allocUnsafe(4 + bytes.length);
  framed.writeUInt32BE(bytes.length, 0);
  bytes.copy(framed, 4);
  return framed;
};

const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
};

test("auth v1 cross-language crypto vectors remain exact", () => {
  const canonicalAddress = "CAFÉ@EXAMPLE.COM".normalize("NFC").toLowerCase();
  assert.equal(canonicalAddress, "café@example.com");
  const finalSigmaAddress = "ΟΣ@EXAMPLE.COM".normalize("NFC").toLowerCase();
  assert.equal(finalSigmaAddress, "ος@example.com");
  assert.equal(finalSigmaAddress, "ος@example.com".normalize("NFC").toLowerCase());

  const challengeId = "sbc_AAAAAAAAAAAAAAAAAAAAAA";
  const code = "012345";
  const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  const message = Buffer.concat([
    lp("snapback.auth.email-code.v1"),
    lp(challengeId),
    lp(canonicalAddress),
    lp(code),
  ]);
  assert.equal(
    createHmac("sha256", key).update(message).digest("hex"),
    "a20020496edbc0952087cb4053d12f5cd8a2a800335046cafaae36597d6fbd47",
  );

  const random = Buffer.alloc(32);
  assert.equal(random.toString("base64url"), "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(random).toString(16).padStart(8, "0"), "190a55ad");

  const bearer = `sbs_${random.toString("base64url")}.190a55ad`;
  assert.equal(bearer.length, 56);
  assert.equal(
    createHash("sha256").update(bearer, "ascii").digest("hex"),
    "9d1a7107cb91bc1fe07a5a9222f52e48cbf1c226fb0f9ebf4937e703819abbeb",
  );
});
