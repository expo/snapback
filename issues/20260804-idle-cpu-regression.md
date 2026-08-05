# Server idle CPU regressed past the telemetry phase-1 ceiling

**Status:** Open
**Found:** 2026-08-04, by the Linux telemetry receipt re-mint
(`issues/20260804-telemetry-receipt-linux-remint.md`)

At main 5df6d666f the phase-1 idle proof measures **12 CPU ticks
(120 ms)** in the idle window against the 100 ms / 10-tick ceiling —
two independent runs, identical readings (user 7-8, system 4-5 ticks),
write-IO 0, RSS growth 0. The retained receipt's revision (de86d22a)
passed the same gate, so the regression landed in
de86d22a..5df6d666f. Candidate attribution (unverified), by what that
range added to the always-on server path: LLP 0167 network condition
profiles (timers/polling), the P1 finite-carrier CompletenessProofV1
issuance path, admin console/tailscale machinery, LLP 0156 error
tracking. Bisect the idle cost on a Linux host (the Minisforum lane is
provisioned; `scripts/verify-telemetry-phase1-proof --full` reproduces
in ~10 min), fix the idle cost — do not raise the ceiling without an
owner ruling — then complete the receipt re-mint.
