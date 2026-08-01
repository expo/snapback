# A3 sweep: sessions restart-after-regenerate refusal is misattributed to a runtime/codegen mismatch

**Opened:** 2026-08-01
**Systems:** CLI, Auth, Diagnostics
**Related:** LLP 0137 (A3 arm), demos/improvement-sweep/arms/a3-snapback-web/findings/0137-a3-f4-restart-evolution-refusal-misattributed-diagnostic.json

Stop dev, regenerate evolved schema/functions, start again over the same
sessions database: the server refuses with
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` (the startup artifact-pair pin),
but the CLI wraps it in `SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH`,
claiming the runtime "could not deserialize artifacts emitted by the current
codegen" and advising a runtime reinstall/rebuild or a
`SNAPBACK_RUNTIME_BINARY` override — advice that cannot help and sends an
external consumer reinstalling packages in a loop. The true cause appears
only as a stderr prose line. Probe retained:
`demos/improvement-sweep/arms/a3-snapback-web/evidence/app/repro-evolution.mjs`.

Fix shape: propagate the auth-subsystem cause as the primary structured
diagnostic with a recovery naming the sanctioned evolution path (live reload
through the running supervisor); reserve the runtime-identity code for real
deserialization failures. The pin itself must stay.
