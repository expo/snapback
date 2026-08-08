# `check-package-export-types` is red: public runtime exports are missing declarations

**Status:** Open
**Filed:** 2026-08-06
**Area:** packages/snapback-cli (type surface), tooling/check-package-export-types

## Symptom

`node scripts/check-package-export-types.mjs` fails its global consumer
fixture with:

```
packages/snapback-cli/expo-dev.d.mts:50 error TS2503: Cannot find namespace 'NodeJS'.
```

`packages/snapback-cli/expo-dev.d.mts:50` declares `env?: NodeJS.ProcessEnv;`.
The `NodeJS` global namespace comes from `@types/node`, which is not resolved
in the check's global-consumer compilation context, so the aggregate fixture
goes red even though the individual package's own strict type fixture passes.

## Pre-existing, not caused by current work

The declaration was introduced 2026-08-05 by `567a8e0fd`
(`feat(cli,expo): snapback dev --expo supervised loop + bootstrap exchange`,
LLP 0181 E1 / LLP 0176 G1). It reproduces with unrelated in-flight changes
stashed. It was observed while landing the LLP 0081 outbox-quarantine seam
(`snapback-client`), whose own client type fixtures pass; this blocker is
orthogonal and was ruled out as that work's doing.

## Fix options (pick one)

1. Reference the Node types explicitly for this declaration file, e.g. a
   `/// <reference types="node" />` at the top of `expo-dev.d.mts`, or import
   the type rather than relying on the ambient `NodeJS` global.
2. Replace `NodeJS.ProcessEnv` with a local structural type
   (`Readonly<Record<string, string | undefined>>`) so the `.d.mts` carries no
   dependency on the ambient Node namespace.
3. Ensure `check-package-export-types.mjs`'s global-consumer compilation
   includes `@types/node` in its `types`/`lib` resolution when a package's
   public surface legitimately references Node globals.

Option 2 is the lowest-coupling for a CLI type surface that only needs the
shape of an env map; option 1 is the smallest diff if the Node dependency is
intentional. Whoever owns the LLP 0181/0176 CLI surface should choose.

## Acceptance

`node scripts/check-package-export-types.mjs` passes its global consumer
fixture with no `TS2503 Cannot find namespace 'NodeJS'` error.

## Re-triage — 2026-08-08

The original `NodeJS.ProcessEnv` failure is no longer the active failure: the
checker compiles 95 subpaths successfully. The same canonical gate remains red
on runtime-vs-declaration parity:

```text
@expo/snapback-cli ./expo-dev
  runtime exports missing from the declaration:
  admittedBrowserExchangeOrigin, startBootstrapExchange

@expo/snapback-client .
  runtime exports missing from the declaration:
  rqsRetentionIneligibilityReason
```

These symbols are present in the shipped runtime entry points but absent from
their `.d.mts` surfaces, so JavaScript consumers can call APIs TypeScript
consumers cannot name. Keep this ticket open, but treat the old ambient-Node
description as history rather than the current repair target.

Revised acceptance: `node scripts/check-package-export-types.mjs` passes both
consumer compilation and declared-vs-runtime export parity for all 95 public
subpaths.
