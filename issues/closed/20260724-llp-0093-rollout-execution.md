# File and drive the LLP 0093 rollout (P-0..P-3), including the minimal-client recipe

**Status:** Resolved (2026-08-01; ratified Implemented)
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “File and drive the LLP 0093 rollout (P-0..P-3), including the minimal-client recipe” shows the issue reaches a security, correctness, release, or core product boundary; delay compounds an active rollout, reliability, or verification risk, while the repair crosses several runtime, host, protocol, or policy seams, with specific cited code, progress, or acceptance criteria.
**Severity:** P2
**Systems:** Wire Protocol, Client SDK, Guide
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** LLP 0093 (Rollout sketch, D1 Publication), expo-jam-allaboard diaries 0002/0006
**Marker:** all-aboard-external-review

LLP 0093 (Status: Review) scopes everything the All Aboard external
review asked for on the client side — the normative wire spec (P-0), the
conformance fixtures and lifecycle facts (P-1), the Swift proving client
(P-2), and auth profiles (P-3) — but nothing is ticketed and nothing is
implemented; four client stacks re-spelunked the HTTP wire from source
at roughly an hour each. The 2026-07-24 v0.8 amendment adds the two
deliverables the review named that 0093 lacked: a minimal-client recipe
on the guide surface (route set, the three `LiveEnvelope` kinds, the
`x-snapback-connection-token` carriage) and a named dev-mode posture
section in the protocol document (what a dev-mode server accepts without
an auth handshake).

This ticket tracks turning the rollout sketch into work once 0093 leaves
Review: one ticket (or Spec LLP, per the 0091/0092 pattern) per cluster,
in P-0 → P-3 order, with the recipe and dev-mode section riding P-0's
guide publication. Dart/Kotlin remain deferred per 0093 D4; if demand
evidence accumulates (the Flutter diary is one datapoint), record it
here rather than widening P-2.

**Done when:**

- LLP 0093's status question is resolved (ratified or explicitly
  parked) and, if ratified, P-0..P-3 tickets/Specs are filed with the
  recipe + dev-mode deliverables attached to P-0.
- The `guide/protocol/` page and recipe exist with CI-verified snippets,
  and `guide/capabilities.md` carries the rows/GAP entries 0093 D5
  requires (non-JS client gap, `poll/hosted` gap).

## Status note (2026-07-30 triage)

Every done-when item except the first is verifiably complete: LLP
0094/0095/0096 exist, the P-0..P-3 ticket program was filed and is
substantially closed, guide/protocol/client-protocol.md shipped (reviewed
2026-07-26), the dev-mode posture is LLP 0094 §0A.6, and
guide/capabilities.md carries clients.protocol plus the clients.non-js /
clients.poll-hosted GAP rows. The sole remaining item is the author
decision: ratify LLP 0093 (Review → Accepted/Implemented, ideally together
with 0094 and the 0095/0096 Drafts) or explicitly park it. Once recorded,
this ticket closes with a one-line resolution.

## Triage freshness note (2026-08-01 sweep)

Everything executable landed: guide/protocol/client-protocol.md
shipped, capability rows carry clients.protocol + the non-js/poll-hosted
GAPs, P-0..P-4 tickets closed, and the hosted-root /_snapback/*
migration landed (cloudflare/src/gateway.js §LLP 0094 0A.3; mirrored in
src/server.rs). Remaining: one author line ratifying or parking LLP 0093
(header still Review — the inline 'Status (2026-07-26): landed.' line is
about the guide, not ratification; ideally decided together with 0094,
also Review).

---

**Status:** Resolved (2026-08-01)

The sole remaining done-when item — the author decision — is recorded:
Charlie ratified LLP 0093 on 2026-08-01 and the document is now **Status:
Implemented** (v0.12 revision entry carries the tree-verified evidence).
Every other done-when item was already verified complete by the 2026-07-30
and 2026-08-01 triage notes above and re-confirmed at closure:

- P-0..P-3 filed as LLP 0094 (Review) / 0095 (Draft) / 0096 (Draft) plus
  ten closed execution tickets (`issues/closed/20260725-0093-p*`), with
  the recipe and dev-mode posture riding P-0 (LLP 0094 §0A.6).
- `guide/protocol/client-protocol.md` shipped with CI-verified snippets;
  `guide/capabilities.md` carries `clients.protocol` (shipped; witness
  `ClientStateMachine` in clients/swift/SnapbackClient) and the
  `clients.non-js` / `clients.poll-hosted` GAP rows 0093 D5 requires.

Residual work (`live/hosted` lane, iOS proving host, 0094/0095/0096's own
review loops, `issues/20260726-0093-mutation-wire-artifact-identity.md`)
is tracked by those documents and tickets, not this rollout ticket.
