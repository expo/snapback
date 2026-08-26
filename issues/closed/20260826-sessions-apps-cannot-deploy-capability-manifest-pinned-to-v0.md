# A sessions app cannot deploy: the capability manifest is pinned to `snapback.v0`

**Status:** open
**Severity:** blocks deployment for every app using `authMode: 'sessions'`
**Found:** 2026-08-26, by the LLP 0283 F-3 npm cold-install witness — on its first
successful run, against a staged 13-tarball closure in a fresh external application.

## Symptom

`snapback deploy build snapback --target-profile local-dev-sqlite-ibex` refuses:

```json
{"code":"SNAPBACK_DEPLOY_GENERATED_IDENTITY_MISMATCH",
 "message":"generated schema, function, and capability artifacts do not describe one application build",
 "schemaAppId":"todo-contract","functionsAppId":"todo-contract",
 "schemaVersion":"snapback.v1","functionsSchemaVersion":"snapback.v1",
 "capabilitySchemaVersion":"snapback.v0"}
```

Schema and functions agree at `snapback.v1`; the capability manifest is `snapback.v0`.

## Cause

`packages/snapback-codegen/index.mjs` carries two version constants:

```js
const SCHEMA_VERSION = 'snapback.v0';           // :1046
const SESSIONS_SCHEMA_VERSION = 'snapback.v1';  // :1047
```

Schema and function artifacts select between them by auth mode (`:2576`):

```js
const artifactVersion = authMode === 'sessions' ? SESSIONS_SCHEMA_VERSION : SCHEMA_VERSION;
```

The capability manifest does not. It emits `SCHEMA_VERSION` unconditionally (`:8158`):

```js
['capability.manifest.schema.json', capabilityManifest,
 { artifactKind: 'capabilityManifest', schemaVersion: SCHEMA_VERSION }],
```

The CLI then requires the three to agree
(`packages/snapback-cli/index.mjs:1659`):

```js
|| capabilityManifest.schemaVersion !== schemaManifest.schemaVersion
```

So the mismatch is unconditional for `authMode: 'sessions'`: schema and functions move to v1, the
capability manifest stays at v0, and deploy refuses. Non-sessions apps are unaffected because all
three then agree at v0.

Note `packages/snapback-codegen/auth-artifacts.test.mjs:323` and `:889` assert **both** at
`snapback.v0`, which is why the existing unit tests do not catch this — they cover the non-sessions
path only.

## Suggested fix

Thread the same `artifactVersion` used at `:2576` into the capability-manifest emission at `:8158`,
rather than the bare constant, and extend `auth-artifacts.test.mjs` with a sessions-mode case that
asserts all three artifacts report the same `schemaVersion`. The absence of that case is the actual
gap — a version selected by mode in one emitter and hardcoded in another will drift again.

## Why this was not caught earlier

This is the first time `scripts/snapback-package-cold-install.mjs` has run to completion. LLP 0283 F-3
lists it and `scripts/cold-clone-check.sh` as the two witnesses that had "genuinely never been
exercised". The cold-clone witness found that `main` did not compile
(`issues/20260826-main-did-not-compile-and-no-gate-caught-it.md`); this one found that a sessions app
built from the published closure cannot deploy. Both were found by running a gate for the first time,
not by any new code.

## Related

- LLP 0283 F-3 — the outstanding verification witnesses.
- LLP 0041 — publication acceptance; published packages are immutable, so this should be fixed
  before the next publication rather than after.
- `issues/20260826-main-did-not-compile-and-no-gate-caught-it.md` — the sibling finding.

## Resolution — 2026-08-26

Fixed at `fde8f8635` ("fix(codegen): align sessions capability artifact versions").

The mode-selected `artifactVersion` is now threaded into the capability-manifest emission instead of
the bare `SCHEMA_VERSION` constant, and the lane checked the two sibling emitters on its own
initiative — the asset-upload reference and the generic artifact path had the same latent bug.

The test gap that let this ship is closed with a sessions-mode case asserting the **invariant** — that
schema, functions, and capability artifacts all report the same `schemaVersion` — rather than the
literal `snapback.v1`, so it survives the next version bump. Fail-first was verified independently:
the suite fails on `main` without the fix and passes with it.

Verified end to end by the lane: `snapback deploy build` clears
`SNAPBACK_DEPLOY_GENERATED_IDENTITY_MISMATCH`, then reaches a later unrelated release-validator error.
The regenerated demo capability manifests move `snapback.v0` → `snapback.v1` as expected.

Found by `scripts/snapback-package-cold-install.mjs` on its first successful completion — one of the
two F-3 witnesses LLP 0283 lists as never having been exercised. Both of those witnesses found a real
defect the first time they ran.
