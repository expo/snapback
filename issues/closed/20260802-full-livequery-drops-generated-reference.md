# Full `liveQuery` drops generated-reference contracts at subscription admission

**Status:** Resolved 2026-08-02
**Found:** 2026-08-02, PKG-02 Gate 22 operational attribution
**Systems:** Full client, live queries, generated references, wire protocol
**Related:** LLP 0012 (call-time generation binding), LLP 0147 (Gate 22)

## Defect

The Full client's `liveQuery(ref, options)` reduced `ref` to its function name
before calling `subscribeLive` on each fresh admission. When `ref` was a
generated function reference, that reduction discarded both its argument
schema and its complete `expectedGeneration` tuple.

Consequently, a generated live query admitted malformed arguments instead of
refusing them before network I/O, and its subscribe body omitted generation
binding even though direct `subscribeLive(ref, options)` was correct. The same
loss recurred on reconnect because every fresh subscription used the reduced
name.

## Why PKG-02 exposed it

LLP 0147 Gate 22 compares Micro with Full under the same workload. The first
operational comparison reported 1,045 bytes for Micro and 700 bytes for Full.
Of the 345-byte gap, 342 bytes were the complete generation tuple that Micro
correctly sent and Full incorrectly dropped; the other three bytes came from
different synthetic fixture labels. Treating that defective Full request as
the baseline would reward a contract violation and misattribute the resulting
bytes to Micro.

This is a pre-existing Full-client correctness defect, not a Micro
optimization. Its fix is therefore a distinct prerequisite commit for the
PKG-02 Gate 22 evidence. The corrected comparison uses identical fixture
labels and contract-correct generated references on both clients.

## Resolution

Keep the original reference object through the final `liveQuery` subscription
boundary. `subscribeLive` now performs the same generated-reference argument
validation and generation binding whether it is called directly or through
`liveQuery`.

Focused proof covers both directions:

- a generated `liveQuery` with an undeclared argument fails with
  `SNAPBACK_ARGUMENT_VALIDATION_FAILED` before any network request; and
- a valid generated `liveQuery` emits the exact five-field generation tuple,
  alongside the other generated call families.

Verification:

- `node packages/snapback-client/package.test.mjs`;
- `node packages/snapback-client/argument-validation.test.mjs`; and
- `git diff --check`.
