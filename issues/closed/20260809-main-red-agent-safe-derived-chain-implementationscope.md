# main red: agent_safe_publication derived-chain test rejects `implementationScope` in a committed fixture

- **Status:** Closed
- **Date:** 2026-08-09
- **Systems:** agent-safe publication, testing
- **Detected during:** LLP 0204 S1 pre-landing verification (full lib suite)

`agent_safe_publication::tests::derived_chain_invariants_hold_across_lifecycle_states`
fails on main: deserialization refuses `unknown field \`implementationScope\``
(src/agent_safe_publication.rs:503) while reading a committed fixture.
Commit `2c4d707aa` ("Publish qualified derived-fork evidence chain") added
`implementationScope` to the committed evidence JSON
(tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-09.v3.json
and the 2026-08-04 receipt), but the deny-unknown-fields struct in
`src/agent_safe_publication.rs` was not extended, so the lib suite is red at
every commit since.

Looks like a fixture-first landing whose struct half hasn't landed yet. Owner
of the derived-fork evidence chain (LLP 0158 / fork-publication program):
either land the struct field (with its validation semantics) or re-mint the
fixture without the field. Not S1's to guess — the field's meaning belongs to
the evidence-chain owner.

Verified: the failure reproduces with and without unrelated working-tree
changes; the 2331 other lib tests pass.

## Author ruling — 2026-08-10

**Author-routing released: any session may fix this forward now** (same
24-hour fix-forward convention as
`issues/20260809-main-red-handler-error-exposure-triple.md`). Preferred
path: land the `implementationScope` struct field with its validation
semantics recovered from the `2c4d707aa` landing context; if the field's
meaning cannot be pinned from that context, re-mint the fixture without the
field to restore green and file the field's re-introduction as its own
ticket.

## Resolution — 2026-08-10

Fixed forward through the preferred path. Commit `2c4d707aa`, the receipt
history, the v3 checker, and the requalification reviews pin
`implementationScope` as the LLP 0189 D-4 claim classification accepted by
the named author: the exact roots and files whose committed Git entries form
the derived-fork v3 implementation digest. Both committed v3 artifacts carry
the same closed `snapback.agent-safe-implementation-scope.v1` value.

`src/agent_safe_publication.rs` now parses that object through closed enums for
its schema, sole root, and seven admitted files, and the lifecycle mirror
requires exact ordered equality with the canonical derived-fork scope. The
companion v3 `selectionPolicySha256` field added by the same receipt landing is
recognized and required to be a nonzero SHA-256. These are receipt-schema
invariants, not publication-state invariants: v1/v2 require both fields absent;
v3 requires them whether its anchor is withheld or published. Publication
state continues to control only carrier binding and nonzero evidence/digest
requirements.

The same v3 landing also moved four evidence bindings to fresh dated,
append-only locators. The Rust mirror now retains exact historical v1/v2 paths
and accepts only the checker-defined valid ISO-date patterns for those four v3
paths; all kinds, ordering, and stable paths remain exact.

Verification:

- `DYLD_FRAMEWORK_PATH="$PWD/vendor/ibex/ios/Frameworks" cargo test -j 6 --lib agent_safe_publication::tests::derived_chain_invariants_hold_across_lifecycle_states -- --exact` — 1 passed.
- `DYLD_FRAMEWORK_PATH="$PWD/vendor/ibex/ios/Frameworks" cargo test -j 6 --lib agent_safe_publication::tests` — 4 passed.
- `node --test tests/agent_safe_publication_checker_v1.mjs` — 110 passed.
- `./ref-check --verbose` — 225 LLP docs, 4,755 refs, zero errors or unchecked refs.

The fixture was not re-minted and no re-introduction ticket was needed.
