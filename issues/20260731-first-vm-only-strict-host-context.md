# Only the first handler VM per process holds the Enforce-mode Ibex context

**Status:** Open
**Date:** 2026-07-31
**Systems:** Runtime, Security
**Governing:** LLP 0009 (host-install policy), LLP 0123 (finding provenance)

## The standing fact

Code-verified in LLP 0123 v0.3 (§Option 2, "The strict-Host handoff
hazard") and re-confirmed while executing LLP 0115 CV-3:
`ensure_host_installed()` installs `Host::strict()` (`SecurityMode::Enforce`,
default-deny) exactly once per process behind a `std::sync::Once`
(`src/runtime.rs`); `install_host` arms a single-use, thread-bound pending
creation token (`PENDING_HOST_CONTEXT`, `vendor/ibex/src/host/abi.rs`);
`ex_hermes_create_no_eval()` claims and zeroes it; and every later
construction through that diagnostic constructor, finding no pending token,
falls back to a fresh `SecurityMode::Audit` context — the rollout mode that
computes and logs the capability decision but lets denied operations proceed
(`vendor/ibex/src/host/mod.rs`).

Consequence: in any serving process, exactly one VM — the first
`RuntimeGuard::create()` on the installing thread — ever holds the
Enforce-mode Ibex capability context. Every later per-invocation or warm-pool
VM runs against an Audit-fallback context. Snapback's effective enforcement
survives through its other layers (the JS ambient denial shadowing, the
no-eval constructor, and `snapback_host_call` being the only host
dispatcher), and `tests/runtime_qualify_posture_v0.rs` pins that the observed
fail-closed surface is identical on the first (strict-claimed) and second
(Audit-fallback) VM — but the Ibex capability gate itself is honest
defense-in-depth on VM 1 only.

## What this is NOT

This is not a CV-2/CV-3 regression: the landed `snapback runtime-qualify`
runs as a separate process and does not consume any serving process's
handoff (see LLP 0123's 2026-07-31 dated note). The fact predates the
qualification work and is independent of it.

## Direction (LLP 0009 owners' decision)

LLP 0123 sketches the shapes: per-creation strict reinstallation (revisits
the deliberate M2-era install-once caching), re-arming the pending token per
construction, or an Ibex ABI change (a non-consuming or claim-preserving
constructor). Each changes the posture of second-and-later VMs and belongs
with LLP 0009's host-install policy, not with the readiness tooling. Until
decided, any in-serving-process boot witness (LLP 0030/0031 `/health`
option) stays gated on this same ratification.
