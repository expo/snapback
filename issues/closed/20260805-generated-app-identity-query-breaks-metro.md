# Generated app identity query specifiers break Metro resolution

**Status:** Resolved
**Date:** 2026-08-05
**Resolved:** 2026-08-06
**Systems:** Code generation, React/Expo, Metro, AppDescriptor
**Related:** LLP 0176 G1, LLP 0179 S0, LLP 0181 E1,
`demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md`
**Fix commit:** pending landing by the orchestrator (this task was required to
remain uncommitted)

## Reproduction

After local closure installation and generation, Metro refused imports such
as:

```text
./app.binding.mjs?identity=383770f66c298358a4a2e5f83523e881c31ff36d17e20fcd7af38d82d82bc6ec
```

Node's ESM resolver accepts a URL query; Metro treated it as part of the
filesystem name.

## Resolution

Codegen now emits real content-addressed files:

```text
app.descriptor.<sha256>.json
app.binding.<sha256>.mjs
```

`app.mjs` and `api.mjs` import the digest-named binding, and the binding
imports the digest-named descriptor. Four-way descriptor/app/schema/function
identity admission remains owned by `@expo/snapback-expo` and is unchanged.
Review-surface classification and descriptor tests cover the new paths and
reject malformed digest names.

`app.binding.mjs` deliberately remains as a stable compatibility alias. It
contains only re-exports from the digest-named binding; the digest-named file
is the sole hydrated binding authority, so there are no divergent hydrated
copies. `app.descriptor.json` remains the portable inspection authority; its
digest-named bundler input is required to be byte-identical.

The repaired fixture generated, typechecked, exported for iOS, and ran in
Expo Go on the Air. The real simulator observed both the live query and
ordinary mutation and emitted `G1_IOS_PASS`.
