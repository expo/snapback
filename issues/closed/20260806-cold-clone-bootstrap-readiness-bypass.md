# Cold-clone lane bypassed runtime readiness bootstrap

**Status:** Closed — fixed forward 2026-08-06
**Opened:** 2026-08-06
**Systems:** CI, Native runtime, Acceptance testing
**Related:** LLP 0010, LLP 0030, GitHub Actions run `31136312805`, PR #17

## Failure

The fresh cold-clone check for PR #17 at source
`192a9fc12215a1b3e8d3c267ab57daa065111302` built its Contract surface and
then ran zero browser assertions. The harness rejected
`target/debug/snapback` because the process loader could not find
`libhermesvm.so`; its source-tree fallback then exceeded the 90-second link
deadline and failed with `SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT`.

This was not a package, push-seam, or F0a correctness failure. The lane called
the coded `scripts/bootstrap-ibex-runtime` entry point but explicitly defaulted
`SNAPBACK_BOOTSTRAP_CHECK=0`, disabling the exact link, loader-closure staging,
restricted-VM qualification, and digest-bound readiness receipt that make a
served binary trustworthy. A later plain `cargo build` emitted the intentional
Linux `$ORIGIN/../lib` RUNPATH but did not populate `target/lib/libhermesvm.so`.

## Attribution

The bypass originated in the cold-clone landing `20c21a701a` (ENG-22480).
Linux loader-relative runtime packaging landed later in `14e19617d5` (LLP
0074), but the older lane was not reconciled to the new closure requirement.
The runtime-readiness machinery subsequently made the mismatch fail closed,
as designed. PR #17 exposed the latent producer/consumer drift; none of its
wave-regeneration changes introduced it.

## Resolution

The cold-clone lane now invokes the coded bootstrap with its authoritative
default behavior before any separate build or acceptance step. A CI fixture
requires that invocation and rejects any reintroduction of
`SNAPBACK_BOOTSTRAP_CHECK` in the lane. This preserves the documented bootstrap
boundary and makes Linux loader-closure staging part of the same readiness
claim the browser harness consumes.
