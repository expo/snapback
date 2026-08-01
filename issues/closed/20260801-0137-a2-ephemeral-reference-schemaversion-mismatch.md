# 0137 A2: generated api.ephemeral references are rejected by the React binding (schemaVersion v0 vs v1)

- **Status:** Resolved
- **Date:** 2026-08-01
- **Resolved:** 2026-08-01 (between-arms fix lane; ticket text imported from
  the A2 arm's worktree — if the arm's landing also carries the open copy
  under `issues/`, this closed copy is the resolution of record)
- **Source:** LLP 0137 Phase 1, A2 snapback-web arm (external consumer, @expo/snapback-* 0.1.7)
- **Finding:** `demos/improvement-sweep/arms/a2-snapback-web/findings/0137-a2-f2-ephemeral-reference-schemaversion-mismatch.json`
- **Severity:** defect — the documented `api.ephemeral.<name>` path into `useSnapbackPresence`/`observeSnapbackPresence` fails for every app

On 0.1.7, generated `api.mjs` stamps ephemeral collection references `schemaVersion: "snapback.v0"`, while `prepareReactBinding` reconstructs the admitted reference from the schema manifest's `"snapback.v1"`. `admittedReactEphemeralDefinition` canonical-compares the two and refuses with `SNAPBACK_REACT_REFERENCE_INVALID` ("React presence requires a complete generated ephemeral collection reference admitted by this binding"). Every other field is byte-identical (`demos/improvement-sweep/arms/a2-snapback-web/evidence/probes.json`, ephemeralReferenceMismatch).

Workaround: pass `binding.ephemeral.<name>` (undocumented).

Fix shape: one version stamp across both producers plus a packaged-closure conformance test that admits `api.ephemeral.<name>` through the binding. Keep the fail-closed canonical comparison.

## Resolution (2026-08-01)

Root cause: the two producers disagreed on which grammar an ephemeral
collection reference carries. Codegen's `renderApiModule` stamps every
generated reference — function, query-group, asset-upload, ephemeral — with
the public reference grammar (`SCHEMA_VERSION = 'snapback.v0'`; the
generated `api.d.ts` even pins `type SchemaVersion = 'snapback.v0'`), while
`prepareReactBinding` (packages/snapback-client/react-binding.mjs)
reconstructed its admitted ephemeral reference from
`generated.schema.schemaVersion` — the sessions **carrier** grammar
(`snapback.v1`). Function and query-group references already used the
documented rule (`referenceSchemaVersion` from the capability manifest,
byte-identical to api.mjs, per the b1006fa2 comment); the ephemeral
reconstruction had missed the same treatment, so the fail-closed canonical
comparison in `admittedReactEphemeralDefinition` rejected every
`api.ephemeral.*` reference on sessions apps.

Fix: the binding now stamps its reconstructed ephemeral references with
`referenceSchemaVersion` — one grammar across both producers, byte-identical
to `api.mjs`. The strict canonical admission is unchanged (mustNotRegress
honored); codegen is untouched. The reference's `schemaVersion` is
client-side identity only — the wire path (`subscribeEphemeral`) sends the
collection name, so no server or wire change is involved.

Regression: `packages/snapback-react/presence.test.mjs` sessions-grammar
scenario — builds a binding from `snapback.v1` manifests, asserts
`binding.ephemeral.*` deep-equals the exact reference `renderApiModule`
emits (v0 stamp), and drives `observeSnapbackPresence` with that generated
api-style reference to `ready`. Verified to FAIL on the pre-fix code
(`schemaVersion: 'snapback.v1'` vs `'snapback.v0'` deep-equal mismatch; the
observe path would raise `SNAPBACK_REACT_REFERENCE_INVALID`).

The packaged-closure conformance witness (fresh external scaffold admitting
`api.ephemeral.<name>` on the public closure) lands with the arm's rerun on
a release cut carrying this fix; 0.1.7 stays the pinned baseline. Doc: LLP
0107 implementation journal (2026-08-01 entry).
