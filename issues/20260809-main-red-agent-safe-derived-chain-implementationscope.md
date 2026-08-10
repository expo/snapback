# main red: agent_safe_publication derived-chain test rejects `implementationScope` in a committed fixture

- **Status:** Open
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
