# `generated API cold signatures` fails on `VerifyConfig.profiles`

- Status: Open
- Date: 2026-08-27
- Systems: `packages/snapback-cli` (verify types), `tests/generated-api-reference-v1.mjs`
- Governing: LLP 0189 (fix-forward)

## Symptom

`node scripts/check-guide.mjs` reports 21/22 with:

```
[guide-check] FAILED — generated API cold signatures
AssertionError: The input did not match the regular expression
/readonly profiles\?: readonly VerifyProfile\[\]/u
```

The assertion is `tests/generated-api-reference-v1.mjs:53`. The published
signature now inlines the profile object type rather than referring to the
named `VerifyProfile`:

```ts
readonly profiles?: readonly {
  readonly id: string;
  ...
```

## Classification

Inherited. Reproduced on a clean detached worktree at `origin/main`
(`9505981ec`) with the repo's `node_modules` symlinked in — same assertion,
same input. The last commits to touch the assertion and the verify types are
`cbf4fc7fa` and `f11f83341`, neither of which is the shared-auth work.

## Next step

Decide which side is authoritative: either restore the named `VerifyProfile`
reference in the published signature, or update the cold-signature expectation
to the inlined shape. The check exists to notice exactly this kind of drift, so
the expectation should not be relaxed without a reason recorded here.

## Update 2026-08-28

Still open, and the drift has **flipped direction**. The assertion now expects
the inline object (`/readonly profiles\?: readonly \{/u`) while the published
signature refers to the named type
(`readonly profiles?: readonly VerifyProfile[];`) — the mirror of what this
ticket first recorded, after `49275c59c fix(cli): accept command-based verify
profiles`. Same single red, same fix-forward disposition: pick one spelling and
make `tests/generated-api-reference-v1.mjs` agree with it.

Observed as the only `check-guide` failure (21 passed, 1 failed) on an
otherwise clean tree while landing the LLP 0317 O43 read-receipt work, whose
commit touches none of this check's inputs — recorded here as the inherited-red
baseline for that landing under LLP 0232.
