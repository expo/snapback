# Supervised Expo web admits a predecessor binding after a same-owner schema successor

**Filed:** 2026-08-25
**Revised:** 2026-08-26 (r4, round-3 dual review: root cause located from
source by both reviewer families; unblocked from the P19 probe)
**Revised:** 2026-08-26 (r3 source audit: retitled from "Expo extra keeps the
previous descriptor"; the stale artifact is the delivered `AppBinding`, the
remint already ships, and the regression claim is withdrawn)
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-explicit`
**Systems:** React/Expo, CLI, Local server lifecycle, Code generation
**Owner:** LLP 0310.000 Track A — not a drive-by fix

## Problem

After M1 green, an additive M2 generate produced `startup-successor-activated`
with accounts/sessions/stores preserved. Generated files named the new
descriptor. The web client refused with
`SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`, having admitted a binding that still
named the M1 descriptor (`5204d9d4`). Login never rendered.

**Which artifact is stale.** `admitAppBindingV1`
(`packages/snapback-expo/app-binding.mjs`) compares the imported generated
`AppDescriptor` against the delivered `AppBinding` — under supervised `--expo`,
the one fetched from `GET /_snapback/expo/v1/bootstrap`. The config plugin's
`expo.extra.snapback.integrationReceipt` has **no runtime reader** anywhere in
`packages/`, `guide/`, or `demos/`; it is a build-invalidation record and
cannot cause or cure this refusal. The original filing named it; that was
wrong.

**Root cause (located 2026-08-26 by both round-3 reviewer families,
independently, from source).** The remint fires after the successor has already
reached the live arm, and the client cannot recover:

1. `regenerateAndLoad` (`packages/snapback-cli/index.mjs`) writes the successor
   generated graph (`generateApp`) and activates it (`loadGenerated`) —
2. — and only then emits `generated-and-loaded`.
3. Metro HMRs the successor `app` into the live browser arm.
4. `SnapbackExpoProvider` (`packages/snapback-expo/provider.mjs`) disposes and
   re-boots on any `app` change: one bootstrap exchange, one admission attempt.
5. The exchange still carries the predecessor binding →
   `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`, terminal `fallback`.
6. `rotateBindingAfterLoad` (`packages/snapback-cli/expo-dev.mjs`) then remints.
   Too late — `app` does not change again, so the arm never re-exchanges.

Exposure precedes publication, and a pull-only exchange with a single-shot
admission has no way back.

**Coverage hole.** `packages/snapback-cli/expo-dev-loop.test.mjs` (label
*"supervised binding rotation after functions edit"*) does verify the rotated
binding in the next exchange and drives a **fresh** successor boot — more than
the r3 filing credited. What no test does is hold an **already-running** arm
across a successor. Note the rotation predicate is
`successor.identity.descriptor !== descriptor.identity.descriptor`, which a
functions edit changes just as a schema edit does, so "schema vs functions" was
never the discriminator.

**Not a regression.** The original filing claimed a regression versus Clique
explicit greens on 0.1.24 and 0.1.25. LLP 0310 r3 withdrew that: Diary 0096 did
not use supervised `--expo`, Diary 0113 used fixed-port external-client
topology and still needed clean Metro restarts after descriptor changes, and
Diary 0106 restarted the owner. This path has no earlier Clique green.

## Evidence

- `benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-explicit/`
  (`final-report.md`, `diary.md`, `run-log.md`)
- LLP 0310 F1 / P1 / P19; LLP 0310.000 Ruling 1 / Track A

## Not blocked

The r3 filing blocked this on the P19 reproduction
(`issues/20260826-probe-successor-binding-rotation-json-stream.md`). Round 3
refuted that: the fault is locatable from source and was located. P19 remains
worth running — it corroborates the mechanism and settles which side of the
predicate the lane observed as stale, since the run retained no `--json` stream
and no `mismatches[]` payload — but it gates nothing.

## Direction

LLP 0310.000 Track A, two invariants:

- **I1 — publication precedes exposure.** Publish the successor binding on the
  bootstrap exchange before `loadGenerated` flips serving identity and before
  the successor generated graph is visible to Metro's watch set. Evaluate the
  eligibility lineage at that earlier point; on failure refuse the successor
  and keep serving the predecessor
  (`recook-failed-successor-refused`).
- **I2 — a supervised-dev mismatch is retryable.** In `SnapbackExpoProvider`,
  re-exchange with bounded attempts and backoff on
  `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` against a `source: 'supervised-dev'`
  candidate, re-running the full predicate each time. Scoped strictly to
  `supervised-dev`: `declared-dev`, hosted, and release admissions keep today's
  terminal refusal, and retry never admits across a different backend.

Add a test that holds a browser arm live across a successor (schema and
functions). Do not weaken mismatch against a foreign backend. Do not bless
`pkill` or owner restart as the paved recovery. Do not rewrite the
`expo.extra` receipt. Do not build a supervisor→browser push plane — there is
none, and the earlier freeze/drain/ack design wrongly assumed one.
