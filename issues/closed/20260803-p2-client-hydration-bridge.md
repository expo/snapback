# P2 — the public client hydration bridge (flips retained-render)

**Status:** Open (program: `20260803-local-first-continuation-program.md`;
requires P1)

The carrier-exit receipt's GAP: "no shipped public client path seeds an
LLP 0166 v3 materialization from a live backend and renders the
answer-class projection after backend loss." Wire it: a public client
surface (the registration API's establishment path) that performs
LLP 0157 §D7 establishment against the live server — beginEstablishment
→ server page + proof → commitPage — with the trusted activation
artifact delivered via the application bundle, then renders through the
answer classes; offline relaunch serves the authoritative-retained row 1
path. Exit: the carrier-exit harness's retained-render leg upgraded from
GAP to a real leg and the receipt regenerated in a dated rerun
(15 PASS / 2 GAP expected — Triage/Fleet remain).

## Resolution (2026-08-03)

Landed on main at 724e94715: the generated-activation materialization
bridge (generated `api.mjs` is the only activation source), registration-
led establishment with proof + lease validation before `commitPage`,
auth-barrier fencing, and the retained-render projection through
`readRenderable`. Server carries the exact `authorizationWitness`
preimage beside the signed proof (additive, LLP 0094 §0C.2).
Carrier-exit receipt regenerated outside the sandbox: **15 PASS /
2 GAP** (retained-render GAP closed); `--check` green. Auth-backup
cargo cluster 25/25 outside the sandbox (the lane's 22 failures were
sandbox-only). Client suite + S4 74/74 + real backend-loss leg green.
Remaining GAPs are the two publication-gated rows; capability
publication stays parked per Charlie's 2026-08-03 ruling.
