# 0137 A2: generated api.ephemeral references are rejected by the React binding (schemaVersion v0 vs v1)

- **Date:** 2026-08-01
- **Source:** LLP 0137 Phase 1, A2 snapback-web arm (external consumer, @expo/snapback-* 0.1.7)
- **Finding:** `demos/improvement-sweep/arms/a2-snapback-web/findings/0137-a2-f2-ephemeral-reference-schemaversion-mismatch.json`
- **Severity:** defect — the documented `api.ephemeral.<name>` path into `useSnapbackPresence`/`observeSnapbackPresence` fails for every app

On 0.1.7, generated `api.mjs` stamps ephemeral collection references `schemaVersion: "snapback.v0"`, while `prepareReactBinding` reconstructs the admitted reference from the schema manifest's `"snapback.v1"`. `admittedReactEphemeralDefinition` canonical-compares the two and refuses with `SNAPBACK_REACT_REFERENCE_INVALID` ("React presence requires a complete generated ephemeral collection reference admitted by this binding"). Every other field is byte-identical (`demos/improvement-sweep/arms/a2-snapback-web/evidence/probes.json`, ephemeralReferenceMismatch).

Workaround: pass `binding.ephemeral.<name>` (undocumented).

Fix shape: one version stamp across both producers plus a packaged-closure conformance test that admits `api.ephemeral.<name>` through the binding. Keep the fail-closed canonical comparison.
