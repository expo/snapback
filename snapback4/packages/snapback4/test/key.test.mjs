// The TypeScript key encoding is held to the Rust vectors.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeKey, upperBound, hex } from "../dist/replica/key.js";

const vectors = JSON.parse(readFileSync(new URL("./key-vectors.json", import.meta.url), "utf8"));

test("every vector encodes to the server's bytes", () => {
  for (const v of vectors) {
    const components = v.values.map((value, i) => [v.kinds[i], value]);
    const encoded = encodeKey(components);
    assert.equal(hex(encoded), v.hex, v.name);
    assert.equal(hex(upperBound(encoded)), v.upper, `${v.name} upper bound`);
  }
});
