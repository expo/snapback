# Write-policy scanner: aliased/computed receivers produce neither a site nor an opaque marker

**Status:** Resolved
**Systems:** Authorization, Code generation
**Date:** 2026-08-25
**Related:** LLP 0274 (write-operation census: escaped contexts, computed
members, and unresolved call graphs must become opaque absent proof),
LLP 0264, LLP 0308 §I3 (Shelved research; found during its review),
`llp/reviews/0308-agentic-program-representations.run.md`,
`issues/20260825-write-policy-scanner-mutable-helper-exactness.md`

## Defect

The write-site scanner's receiver recognition requires a direct
identifier in the context-name set:

- `isContextDbObject` (`packages/snapback-codegen/write-policy.mjs`)
  accepts only `member.object.type === 'Identifier'` with
  `contextNames.has(member.object.name)`.

Consequently, write sites whose receiver is reached any other way are
**silently invisible** — they produce neither a recorded write site nor
an `opaque` marker, and the resulting (possibly empty) census passes
through `buildWritePolicyChecks` as if complete:

1. **Context alias:** `const alias = ctx; alias.db.insert('t', {...})`
   — `alias` is not in `contextNames`.
2. **Computed member on the context:** `ctx[key].insert(...)` (and
   similar computed paths that reach `db`) — the member shape does not
   match the direct-identifier pattern.

This is an exact-empty **false negative**, the failure class Accepted
LLP 0274 explicitly requires to resolve to *opaque*: escaped contexts,
computed members, indirect helpers, and unresolved call graphs must
become opaque absent a sound proof. An authorization census that looks
exact-and-empty while writes exist is worse than an honest opaque
verdict.

## Provenance

Found by the codex reviewer in round 2 of the LLP 0308 super-refine
loop (2026-08-25) and verified against the tree by the orchestrator
before filing (receiver-recognition code read directly; see the run
journal's round-2 receipts). Independent of 0308's shelved proposals —
this is a today-bug in shipped tooling.

## Fix direction (suggestion, not a ruling)

Track context escape: any binding initialized from a context parameter
(or from another escaped binding), and any computed member access whose
object may be a context, marks the enclosing function's census
contribution `opaque` unless the scanner can prove otherwise. The cheap
sound version is aggressive opacity; precision can be recovered later.
Add regression fixtures for both forms asserting an `opaque` (or
site-bearing) outcome — never exact-empty.

## Owner

The LLP 0274 implementation program's scanner soundness audit (these
holes are that audit's named starting set).

## Resolution

Resolved 2026-08-25 in `packages/snapback-codegen/write-policy.mjs`.

`scanGenericWriteSites` now marks the module `opaque` when a binding is
initialized or assigned from a context identifier (`const alias = ctx`,
`alias = ctx`) and when a computed member on a context identifier has no
statically resolved string key (`ctx[key].insert(...)`). Static computed
paths that already resolve (`ctx["db"].insert(...)`) stay exact.

Without `opaqueWritePosture: conservative-v1`, those shapes now refuse
as `SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE` with `opaque-module`
resolution; they no longer project an exact-empty census. Regression
coverage is in `write-policy.test.mjs` ("aliased context and computed
context members are opaque, never exact-empty").

This is the write-policy JavaScript census (LLP 0274 D6), not LLP 0284's
Rust privilege-surface scanner or the durable-effect sink census.
