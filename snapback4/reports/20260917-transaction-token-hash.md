# Transaction-local token hashing — 2026-09-17

The `sha256(text)` prerequisite is implemented and qualified on the shared
interpreter. This does not complete organizations/invitations, Identity or B,
and does not change the published Workroom pin.

Source: `1e91bc7fe6b9be532efd5da98b94127151c0c289`, based on
`e5cbbd8a2`. Test-only correction:
`81da438fe4aad608cdc25b59e524f70794abb62f`. The integrated copies are
`6b6259d50` and `b54f5543e`; production and test files match their source.

The unary builtin accepts present text, including empty text, hashes its exact
UTF-8 bytes without normalization and returns lowercase hexadecimal bounded
at 64 characters. It uses the existing RustCrypto dependency. It charges
`UTF-8 byte length + 1` steps before hashing, then the existing 64-byte owned
string heap charge. The shared interpreter, not a host callback, implements it.
It is not on the total-expression presence allowlist or conditional
write-target purity allowlist. No client contract, static ceiling, dependency
or identity protocol changed.

The initial serial checks on 450b used six Cargo jobs and one test thread:

| Check | Result |
| --- | --- |
| Core meter | 8/8 |
| Core corpus | 18 harness checks; 211 server cases, 83 named skips |
| Focused language hash regression | 1/1 |
| Language guide / presence | 50/50 and 9/9 |
| Focused device witness | 1/1 over SQLite and memory device stores, SQLite server |

The broader frontend attempt ended **37/38**, because the emitted-TypeScript
check lacked the Bun workspace dependency setup. No install was authorized
in that authoring slice; the focused new case passed separately. The corpus's
Postgres arm reported 294 skips with its feature disabled. No actual Postgres
hash execution or browser-WASM result is claimed.

Both independent initial reviews found useful test gaps. The ASCII-only
meter comparison did not independently pin the fixed +1 or UTF-8 byte count;
the rollback probe also named a different row from the preceding insert. The
runtime was not changed. The correction adds a raw-empty baseline, a four-byte
single-character input, the matching row ID and a positive successful-write
control before asserting rollback. Initial Sol was NOT READY; Grok was READY
but identified the vacuous rollback assertion. Both own-thread blind delta
reviews are READY for `81da438fe`:
[Sol](../../llp/reviews/3000.009-b1d-hash.sol.md),
[Grok](../../llp/reviews/3000.009-b1d-hash.grok.md).

The serial qualifier then ran the full affected meter target on exact
integrated `b54f5543e`: **8/8 passed**, no skips. The retained 450b log
`/tmp/sb4-c3-20260916-supervision/hash-b54-meter.log` has SHA-256
`96efe77f11e93d22d96258f70bec543e4a15cc4a29cab4493a240c458bee4b6c`.
The already built hash-capable CLI remains source `1e91bc7fe`, version 0.2.27,
SHA-256 `7342e869fe475e0a4629c36b87f91beac262d4551b769773574903a4cb32f187`;
the later delta is test/documentation-only and does not claim a rebuilt binary.

The append-only JOURNAL retains, and explicitly corrects, the initial false
sentence saying no model work ran: native Sol xhigh authored the original
slice, and native Sol high authored its test correction. The correction's
reference to the preceding entry means the hashing entry in its source branch;
integration retains intervening historical appends rather than rewrite them.

This primitive is suitable for high-entropy capability tokens and content
checksums. It is not password hashing, email anonymization, a signature, a
MAC or entropy generation. Hash-only invitation rows will not imply plaintext
absence from protected action results, steps or delivery payloads. No full
suite, production-store, performance, provider, publication or promotion claim
follows from this prerequisite.
