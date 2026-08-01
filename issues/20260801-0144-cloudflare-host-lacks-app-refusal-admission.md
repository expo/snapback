# Cloudflare host has no declared-refusal admission: undeclared ctx.refuse survives

**Opened:** 2026-08-01
**Systems:** Cloudflare, Runtime, Client protocol
**Related:** LLP 0144 (round-1 Codex MATERIAL 1), LLP 0108 §"Declared
application refusals", LLP 0053

The LLP 0108 declared-refusal first slice is admission-gated only on the
Rust host: `admit_declared_refusal` (src/runtime.rs:3104) folds
undeclared, forged, and bare `SNAPBACK_APP_REFUSAL` claims to
`SNAPBACK_HANDLER_FAILED` against the prepared invocation's declared
set. The JS envelope decoder is deliberately claims-only — its own
comment says "Claims, not facts: the host admits these only against the
declared refusal set (LLP 0108)"
(packages/snapback-harness/envelope.mjs:94-98) — but the Cloudflare
host has no admitting counterpart: `classifyHandlerPlatformFailure`
(cloudflare/src/coordinator.js, cloudflare/src/platform-errors.js)
classifies platform failures and passes every other decoded result —
including a claimed `appCode`/`appDetails` — through unchanged, and no
declaration-admission implementation exists anywhere under
`cloudflare/src/`.

Consequence: on the Cloudflare host an **undeclared** `ctx.refuse`
survives to the caller with its app-authored bytes, violating the
channel's fail-closed invariant (LLP 0144 I1/I3) and the LLP 0053
symmetry (a code admitted with no corroborating declaration). LLP 0108's
"fail-closed by construction" is true per-host, not cross-host.

Fix shape: implement Cloudflare-side admission against the invoked
function's manifest-declared refusal set, with declared / undeclared /
bare-claim tests mirroring
`runtime::parse_handler_output_tests::application_refusal_is_admitted_only_when_declared`;
until it lands, LLP 0108/0144 describe the floor as local-host with this
ticket as the named parity blocker (recorded in LLP 0144 v2's floor
section).
