# check-guide red: "generated API cold signatures" expects `VerifyProfile[]` that `verify.d.mts` never declares (inherited)

**Status:** Open
**Opened:** 2026-08-27
**Systems:** Guide, CLI, Verification

## Problem

`node scripts/check-guide.mjs` is red on `main` at the
`generated API cold signatures` step (`tests/generated-api-reference-v1.mjs`):

```
AssertionError: The input did not match the regular expression
/readonly profiles\?: readonly VerifyProfile\[\]/u
```

`cbf4fc7fa` (2026-08-27, "fix(cli): authenticate dev-loop lifecycle stops
and observe owned-child exit (ws-devloop)") changed the test to require
`VerifyConfig.profiles` to be typed `readonly VerifyProfile[]`, but
`packages/snapback-cli/verify.d.mts` (unchanged since f11f83341,
2026-08-21) still declares `profiles` as an inline object array
(`readonly profiles?: readonly { ... }[]`), and the committed symbol
registry `guide/reference/registry.json` (regenerated in b911f8158)
faithfully records that inline shape. The assertion and the declaration
disagree; the registry is not stale.

Found while landing LLP 0316 Phase 5 (the same check passes at the older
04da2f52b, where the test still had the previous assertion).

## Fix-forward

Either export a `VerifyProfile` interface from `verify.d.mts` and type
`profiles` with it (then regenerate the registry via
`volta run --node 24.18.0 node scripts/generate-guide-manifest.mjs`), or
restore the previous assertion. The `VerifyProfile` /
`VerifyCommandProfile` `exact(...)` lookups a few lines further down in
the same test suggest the former was the intent of cbf4fc7fa and the
declaration change was left out of that landing.

Owner: the ws-devloop lane that landed cbf4fc7fa; any landing touching
`verify.d.mts` may absorb it.
