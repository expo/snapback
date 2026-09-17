import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticStreamsAreSecretFree } from "./diagnostic-secrecy.mjs";

const knownSecrets = new Set(["synthetic-known-secret"]);

test("rejects a known secret found only on stderr", () => {
  assert.equal(diagnosticStreamsAreSecretFree({ stdout: "clean", stderr: "synthetic-known-secret" }, knownSecrets), false);
});

test("accepts clean stdout and stderr", () => {
  assert.equal(diagnosticStreamsAreSecretFree({ stdout: "clean", stderr: "also clean" }, knownSecrets), true);
});

test("rejects a known secret found on stdout", () => {
  assert.equal(diagnosticStreamsAreSecretFree({ stdout: "synthetic-known-secret", stderr: "clean" }, knownSecrets), false);
});
