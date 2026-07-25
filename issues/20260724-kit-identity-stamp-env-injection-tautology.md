# Kit env-injects the commit stamp, making default-path binary provenance self-confirming

**Status:** Open
**Severity:** P2
**Systems:** Local server lifecycle, Testing, Build
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** LLP 0031 §Server-binary identity on /health, demos/_kit/provenance.mjs, build.rs, expo-jam-allaboard issues/0003
**Marker:** all-aboard-external-review

The server-binary identity block is correctly stamped at build time
(`build.rs:239-303` → `option_env!` in `src/identity.rs:53-72`; ENG-22798,
hardened by ENG-23365/ENG-23419). But the kit defeats it on its default
launch path: `startServer` computes the expected identity from the
launch-time checkout (`readCheckoutBinaryIdentity`,
`demos/_kit/provenance.mjs:180-197` — `git rev-parse HEAD` + status) and
injects that same pair into the child's environment as
`SNAPBACK_BUILD_GIT_COMMIT`/`SNAPBACK_BUILD_GIT_DIRTY`
(`server-process.mjs:185-194`). Because `build.rs` prefers the env
override (`build.rs:279-283`, intended for deterministic CI stamps), the
freshly compiled child stamps exactly the value `verifySpawnedReady`
(`server-process.mjs:482-512`) then compares against. Under the default
`cargo run` path the commit check is a tautology and checkout drift is
invisible — the All Aboard external review's finding ("identity
verification passes trivially exactly when it matters",
expo-jam-allaboard `issues/0003`) is correct, though the mechanism is
kit-side env injection, not a runtime HEAD read.

Verification is meaningful today only for a prebuilt binary launched via
`deps.launchSpec`, where the env has no effect on the already-stamped
binary — and the demo-repo wrappers bypass even that by passing
`expectedIdentity: {}`, degrading verification to the startup nonce.

Fix options (decide in the change, record in LLP 0031): stop injecting
checkout-derived values into spawned children, letting `build.rs` run
its own git probe and reserving the env override for deterministic CI
stamps as documented; or keep the injection but downgrade the default
path's verdict to an explicit `self-attested` classification distinct
from `verified`, so reuse decisions and receipts cannot present the
tautology as verification. Composes with
`20260724-kit-prebuilt-binary-boot-path.md`: a verified prebuilt binary
is the case where the stamp carries real information.

A companion amendment recording the defect was added to LLP 0031
§Server-binary identity on /health (2026-07-24).

**Done when:**

- The default launch path can no longer confirm the binary against a
  stamp derived from the same launch-time git read (injection removed or
  verdict reclassified).
- A test builds/stamps at commit A, drifts the checkout to B, and
  proves the mismatch is detected (or honestly reported unverifiable) —
  the case that is silently invisible today.
- LLP 0031's identity section reflects the implemented resolution.
