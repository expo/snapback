# `bootstrap-ibex-runtime` calls unusable Hermes artifacts "already usable"

**Status:** Resolved
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 5
**Systems:** Bootstrap, Runtime, Testing
**Date:** 2026-08-06
**Related:** LLP 0010 ("Bootstrap diagnostic codes"),
`issues/closed/20260804-telemetry-receipt-linux-remint.md` (2026-08-05
correction — where this was found),
`issues/20260806-linux-runtime-fleet-recipe-unscripted.md` (same lane)

## Summary

`scripts/bootstrap-ibex-runtime` decides the vendored Hermes artifacts are
fine by checking that they are *present*, not that they match the current
`vendor/ibex` pin or that they resolve on this host. When they don't, it
prints a reassuring line and then fails several steps later at the launch
smoke, with a diagnostic that points at the loader rather than at the stale
artifacts that are the actual cause.

Observed on the Minisforum lane (Ubuntu 25.10) on 2026-08-05:

```
[snapback-bootstrap] vendored Ibex/Hermes artifacts are already usable
[snapback-bootstrap] validating Snapback native runtime: exact cargo link + launch smoke
[snapback-bootstrap] error: SNAPBACK_IBEX_RUNTIME_LOAD_FAILED: the newly linked
snapback binary did not launch with dynamic-loader overrides scrubbed
```

The recovery record's own `reuse.reason` had the real answer all along:

```
libicuuc.so.74: cannot open shared object file: No such file or directory
```

The checkout's `vendor/ibex/linux/lib/libhermesvm.so` linked ICU 74. That box
has system ICU 76 and ICU 78 in `~/icu-prefix`; ICU 74 exists nowhere on it.
A sibling checkout (`~/projects/snapback-telemetry-remint`) held a Hermes
built against ICU 78 that worked. Copying `vendor/ibex/linux/{lib,hermes-headers}`
contents across and running `cargo clean -p ibex-runtime` fixed it.

## Why it matters

The failure is cheap to fix once understood and expensive to understand. The
"already usable" line actively points investigation away from the cause — it
reads as *this leg is fine, the problem is elsewhere*, so time goes into the
loader, SIP/`DYLD_*`/`LD_LIBRARY_PATH` scrubbing, and the link step instead of
the artifacts. This cost hours on a lane whose own ticket described it as
fully provisioned.

It also silently straddles a submodule re-pin. The prepared artifacts are not
pin-stamped, so after `vendor/ibex` moves, a stale `linux/lib` looks exactly
as "usable" as a correct one. (In the case above the artifacts were stale for
the *current* pin rather than left over from the previous one, which is the
same defect seen from the other side.)

## Proposed fix

1. Make the usability check verifiable rather than existential: before
   declaring artifacts usable, confirm the interpreter/loader can actually
   resolve `libhermesvm.so` on this host — an `ldd`-equivalent resolution
   check, or a trivial dlopen probe — and treat unresolved `NEEDED` entries
   as not-usable.
2. Stamp prepared artifacts with the `vendor/ibex` gitlink they were prepared
   from, and re-prepare when the pin differs, instead of trusting presence.
3. When the check fails, fail *there* with a distinct code naming the
   artifacts and the unresolved libraries — the `reuse.reason` text is
   already computed and already correct; surface it as the error rather than
   burying it in the recovery record and failing later at the launch smoke.

Note that `scripts/ibex-doctor` is the documented read-only diagnosis path
(AGENTS.md) and should grow the same resolution check, so "the runtime state
looks wrong" gets a coded answer instead of a loader red herring.

## Repro

On a host whose ICU major does not match the vendored Hermes build:
initialize `vendor/ibex`, place (or inherit) a `linux/lib/libhermesvm.so`
linked against an absent ICU, run `scripts/bootstrap-ibex-runtime`. It reports
the artifacts usable, then fails with `SNAPBACK_IBEX_RUNTIME_LOAD_FAILED`.

## Resolution (2026-08-10)

Bootstrap now requires three independent facts before calling a prepared set
usable: the existing structural/profile checks, a stamp equal to this
Snapback revision's `vendor/ibex` gitlink, and a host `dlopen` of the actual
Hermes runtime library. A compatible local set created before stamps existed
is adopted only when its Ibex checkout itself equals the pin and both older
checks plus `dlopen` pass. Copied or downloaded sets are probed before their
stamp is written.

Presence with a stale stamp or an unresolved runtime now refuses early as
`SNAPBACK_IBEX_HERMES_ARTIFACTS_UNUSABLE`; `scripts/ibex-doctor` performs the
same provenance and loader checks read-only and includes the loader error in
its finding. LLP 0010 and the repository bootstrap-code list record the new
stable code. The negative path was exercised against a truncated temporary
copy of `hermesvm`, and the real vendored framework passed both bootstrap's
adoption probe and doctor's mirrored check.

## Resolution — 2026-08-10

`scripts/bootstrap-ibex-runtime` no longer equates presence with usability:
artifacts must pass structural/profile compatibility, a real `dlopen` loader
probe, and vendor/ibex gitlink provenance stamping before being declared
usable, failing at the probe with a distinct stable code; `scripts/ibex-doctor`
mirrors the check. Negative test: an empty/truncated library fails the probe
immediately (no late launch-smoke red herring). LLP 0010's bootstrap
diagnostic codes section updated.
