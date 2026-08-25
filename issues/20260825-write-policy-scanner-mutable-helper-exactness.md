# Write-policy scanner: mutable helper bindings accepted as exact without reassignment analysis

**Status:** Open
**Systems:** Authorization, Code generation
**Date:** 2026-08-25
**Related:** LLP 0274 (census exactness requires proof; unresolved call
graphs become opaque), LLP 0264, LLP 0308 §I3 (Shelved research; found
during its review),
`llp/reviews/0308-agentic-program-representations.run.md`,
`issues/20260825-write-policy-scanner-receiver-aliasing-false-negatives.md`

## Defect

The module census follows top-level helper bindings with
function-valued initializers and classifies their write sites as
`exact-static` — including `let` and `var` bindings — without any
reassignment analysis. The committed test pins the behavior
(`packages/snapback-codegen/write-policy.test.mjs`, "module census
follows top-level variable helpers with function-valued initializers":
`let persist = function save(...) {...}` and `var persist = async
(...) => ...` both yield `siteResolution: 'exact-static'`).

A later `persist = somethingElse` (top-level or reached at runtime)
changes what the handler executes, but the census still reports the
initializer's write shape as exact. Exactness derived from a mutable
binding is not proof; under Accepted LLP 0274's rules an unresolved
call graph must be opaque absent one.

Lower severity than the receiver-aliasing sibling ticket (a wrong-exact
row is visible in review; a missing row is not), but it is the same
root discipline: `exact-static` must mean *proven*.

## Provenance

Found by the codex reviewer in round 2 of the LLP 0308 super-refine
loop (2026-08-25); the pinning test read directly by the orchestrator
before filing. Independent of 0308's shelved proposals.

## Fix direction (suggestion, not a ruling)

Either restrict `exact-static` helper following to `const` bindings
whose initializer is a function literal (demote `let`/`var` to opaque),
or add a same-file reassignment scan that demotes any reassigned
binding. Update the pinning test to assert the demotion rather than the
current acceptance.

## Owner

The LLP 0274 implementation program's scanner soundness audit.
