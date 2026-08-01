# Declared-refusal admission runs on one engine leg only: undeclared ctx.refuse survives on the workerd twin and on Cloudflare

**Opened:** 2026-08-01
**Widened:** 2026-08-01 (LLP 0144 round-2, Fable M-R2-1: the local
host's workerd-v8 twin leg is a second unadmitted surface — see below)
**Systems:** Cloudflare, Runtime, Workerd twin, Client protocol
**Related:** LLP 0144 (round-1 Codex MATERIAL 1), LLP 0108 §"Declared
application refusals", LLP 0053

The LLP 0108 declared-refusal first slice is admission-gated only on the
local Ibex engine leg: `admit_declared_refusal` (src/runtime.rs:3104) folds
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
"fail-closed by construction" is true per-engine-leg, not per-host and
not cross-host.

**Widening (2026-08-01, LLP 0144 round-2).** The gap is an engine-leg
gap, not just a host gap. The only `admit_declared_refusal` call site
is on the local host's Ibex leg (src/runtime.rs:2726). When the
LLP 0048 workerd-v8 twin is selected,
`run_ibex_handler_with_context_until` routes every non-action
invocation to the twin and returns at src/runtime.rs:2682 — *before*
that call site — and `run_handler_workerd` ends in plain
`parse_handler_output` (src/workerd_exec.rs:874): no claim extraction,
no admission. An undeclared `ctx.refuse` therefore survives on the
LOCAL host under the twin, inside the parity harness whose purpose is
engine equivalence.

Fix shape (structural, per LLP 0144 v3 floor fact 3): hoist claim
extraction and admission into the engine-neutral completion path shared
by both local legs — do not duplicate the admitter per engine — and
implement Cloudflare-side admission against the invoked function's
manifest-declared set. The denial-witness restore may remain on the
Ibex leg: witness restores are action-scoped and actions never take the
twin ("Actions stay on Ibex", the LLP 0048 @ref at the routing site).
Acceptance: the declared / undeclared / bare-claim triad (mirroring
`runtime::parse_handler_output_tests::application_refusal_is_admitted_only_when_declared`)
green on all THREE serving surfaces — local Ibex leg, local workerd
twin leg, Cloudflare host. Until it lands, LLP 0108/0144 describe the
floor as one-engine-leg with this ticket as the named parity blocker
(LLP 0144 v3 floor section).
