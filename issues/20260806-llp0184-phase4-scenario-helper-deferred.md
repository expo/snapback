# LLP 0184 Phase 4 real-connection scenario helper deferred

**Status:** Deferred
**Impact:** 2
**Urgency:** 1
**Ease:** 2
**Confidence:** 5
**Systems:** Acceptance testing, Ephemeral state, Agent experience
**Date:** 2026-08-06
**Related:** LLP 0184 §D and Phase 4; LLP 0146 D6

## Disposition — 2026-08-06

Do not build either a simulated-publish control or a one-off real-connection
ephemeral scenario helper in LLP 0184 Phase 4. The corpus shows real-client
ephemeral acceptance working today, but not repeated unresolved friction that
justifies a new product surface ahead of LLP 0146 D6's scenario carrier.

This is a demand deferral, not permission to weaken the semantic boundary. If
a helper is later justified, it must open a real connection, obtain the normal
persona or grant, publish through the normal app-data path, observe ordinary
frames, and tear down with a receipt. A privileged admin endpoint that writes
ephemeral state directly remains declined.

## Evidence checked

The audit searched all of `issues/` (including `issues/closed/`) and
`diaries/` for `simulated publish`, `scenario helper`, `scenario runner`,
`real connection`, `actor/observer`, `two browser`, `multi-principal`, and
ephemeral publish/acceptance/helper combinations, then read the matching
context.

- No filesystem issue asks for a simulated-publish operation or a reusable
  real-connection ephemeral scenario step. The one direct actor/observer
  issue match, `issues/20260804-0167-remaining-acceptance-corpus.md`, records
  its socket-level actor/observer witness as resolved by
  `crates/snapback/tests/network_profile_v1.rs` using real socket frames.
- `issues/20260727-hosted-ephemeral-parity.md` requires a substantial real
  hosted two-client corpus. Its blockers are hosted authority, adapter, and
  target qualification; it does not identify the absence of a local scenario
  helper as the blocker or ask for a semantics-bypassing publish seam.
- Diary 0006 records one still-open automated two-browser CDP check for the
  graffiti UI. The same diary also records 17 green headless checks against a
  real server, real WebSocket subscribe/publish acknowledgements, actor and
  observer connections, disconnect cleanup, and an end-to-end two-painter
  run through the browser's real provider path. That is a visual/browser
  acceptance gap, not evidence for a new control-plane operation.
- Diary 0028 recommends first-class multi-principal clients, but its later
  remediation entries say fresh connection labels directly subscribe and
  publish ephemeral state, browser personas pass, and the staged external
  package run passes native typing/presence, reconnect, logout, revocation,
  and exact cleanup. The recommendation supports client ergonomics, not a
  separate scenario-step API.
- LLP 0184 §D says a future helper is useful only if acceptance demand remains
  and explicitly rejects raw simulated publish. Phase 4 repeats that
  condition. The acceptance corpus above does not supply the missing demand.
- LLP 0146 D6 already owns the reusable carrier: scenario language,
  controlled-seam provenance, replay classification, bounded probabilistic
  evidence, and counterexample shrinking. D6 also concludes that separate
  headless actor/observer clients largely answer the earlier "two browsers"
  framing. A Phase 4-only helper would pre-empt that owner with a narrower,
  non-replayable spelling.

## What would trigger building it

Reconsider as an LLP 0146 D6 scenario step—not as a new admin mutation—when
all of these are true:

1. At least two independent acceptance tasks record unresolved, duplicated
   work to open a real ephemeral connection, establish a normal persona or
   grant, publish, observe frames, and prove teardown; ordinary headless
   clients cannot express the cases without bespoke protocol glue.
2. A named acceptance gate is blocked by the lack of that reusable step,
   rather than by visual browser assertions, hosted target qualification,
   missing product semantics, or an unrelated client-lifecycle defect.
3. LLP 0146 D6 has defined the scenario JSON and receipt/replay carrier needed
   to retain connection identity, authority, observed frame order, teardown,
   reproduction class, and cleanup evidence honestly.
4. The implementation is proven to use a real connection and the normal
   publish authority path. No trigger permits a raw `simulated publish`
   backdoor.

Until then, acceptance should keep using the shipped real headless/client
paths and file concrete friction where it occurs.
