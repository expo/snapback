# Mutation settlement lifecycle: LLP 0043 acknowledgement, replay, recovery

**Status:** Shelved
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Mutation settlement lifecycle: LLP 0043 acknowledgement, replay, recovery” shows the issue reaches a security, correctness, release, or core product boundary; delay compounds an active rollout, reliability, or verification risk, while the repair crosses several runtime, host, protocol, or policy seams, with specific cited code, progress, or acceptance criteria.
**Severity:** P2
**Systems:** Client integration, API, Storage
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §2 (Review revision `14f54843…`), LLP 0043 (mutation acknowledgement), src/storage.rs (recorded mutations, retention caps), issues/20260717-app-cli-review-residue.md item 1
**Marker:** app-cli, sub-stage-b, contracts

The super-refine round-10 Codex review identified the biggest open
implementation contract: LLP 0062 pins durable `clientMutationId`
persistence "until settled" and `--mutation-id` replay, but the
settlement lifecycle must adopt **LLP 0043's acknowledgement
protocol** — the server bounds retention
(`SNAPBACK_CLIENT_MUTATION_RETENTION_FULL`) and reclaims only after
client acknowledgement, so never-acknowledging exhausts retention and
acknowledging before durable local consumption can destroy the only
settlement proof. This ticket: add LLP 0043 to the RFC's Related;
define the durable client state machine (pending →
settlement-received → durably consumed → acknowledgement-pending →
acknowledged/removed) with fsync and publication ordering; unknown
outcomes are never acknowledged; pin standalone vs. piggyback ACK
usage and retry; pin the terminal outcome for settlements whose
function was removed/renamed post-commit (where
`--accept-new-generation` cannot help); wire replay re-attestation to
the auth-fingerprint-keyed recorded-mutation store.

The contract must define what “durably consumed” means for a
process-per-command CLI and the ordering around publication: a complete
stdout write alone is not durable recovery state unless explicitly
chosen and justified. It must also decide, rather than merely test,
whether a removed/renamed function's committed settlement is recovered
through a non-executing authority-bound lookup or remains permanently
unknown under a pinned exit/outcome. This document half lands before
sub-stage (a)'s per-kind result mapping freezes; implementation follows
in sub-stage (b).

**Done when:**

- LLP 0062's Related names LLP 0043 and the state machine, durable
  consumption/publication boundary, ACK mode/retry ordering, and
  removed-function terminal outcome are pinned in the per-kind mapping
  deliverable (RFC `Revised:` updated).
- Crash-point tests at every state transition; ACK-loss retry;
  retention-pressure behavior; commit-then-deploy/removed-function
  terminal outcome — all green against a live memory server.
- Replay under changed profile/user/grant/authority/generation
  refuses with zero dispatch (already in the auth matrix; wired to
  this state machine's records).

## Shelved (2026-08-01, author decision) — ask re-filed

Temporarily shelved per Charlie's 2026-08-01 decision on the
triage-sweep recommendation: the app-cli program is paused. The
substantive ask outlives the program and is RE-FILED against its real
owner:
issues/20260801-llp0043-settlement-acknowledgement-lifecycle.md
(the LLP 0043 acknowledgement-lifecycle contract; the JS-arm M2 outbox
half has since landed and been re-verified against 0.1.8). This
original stays as the app-cli-era record. Reopening condition for the
program: LLP 0062 leaves Review or is recommissioned.
