# DECISION: long-lived program owner and the first container/VM remote drill target

**Status:** Resolved 2026-07-25 — Charlie Cheever confirmed the ownership
recording in-session ("let's try to do this now", directed at exactly this
residue): he is the long-lived competitive-program owner/operator and
ratifier, as amendment v0.6 recorded. The second half completed at first
provisioning as designed: protocol amendment v0.7 (2026-07-25) pins the
provisioned identities (app `snapback-drill`, machine `819701c927ee68`, sjc,
image, Tigris bucket `snapback-drill-backups`, flyctl and instrument
digests) with credential health `provisioned` and a live drill target
drilled 7/7. Both Resolved-when bullets are satisfied.

**Pre-resolution status:** Open — narrowed 2026-07-24 to a one-line owner-confirmation
residue. Both decision halves were made by Charlie Cheever on 2026-07-24
and recorded in LLP 0075 protocol amendment v0.6 (plus dated notes in LLP
0075 and LLP 0063): the drill tuple is fly.io / region sjc / Tigris
S3-compatible backup store / `FLY_API_TOKEN` via the machine-local
`.agent-local-secrets.md`, and Charlie Cheever is the named long-lived
program owner/operator and ratifier. Deliberately NOT closed, for two
honest reasons: (1) the owner half was recorded as a session-directed
default subject to Charlie's own amendment — the residue is exactly his
one-line confirmation (or substitution) of that recording; (2) the
Resolved-when bullet asks for pinned package identities, credential
health, and instrument version — the amendment records credential health
honestly as pending-not-provisioned and marks package identities and the
drill instrument version unpinned-blocks-drill (no Fly.io account or
credential exists, nothing was installed, no live drill target is
claimed), so those pins now live in the protocol's own
unpinned-blocks-drill machinery and complete at first provisioning, not
in this ticket. *(2026-07-25: reason (2) is complete — protocol amendment
v0.7 records first provisioning with credentials provisioned, flyctl
pinned, and the drill instruments pinned by content digest, and the first
drill receipts are retained. The residue is now exactly reason (1):
Charlie's one-line confirmation or substitution of the owner recording.)*

**Original status:** Open (author decision)
**Severity:** P2
**Systems:** Competitive evaluation, Deployment, Control plane
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0075 open questions, LLP 0072 (single-instance-container-vm.v1 profile), LLP 0063 (sequencing), issues/20260723-llp0075-checkpoint-program.md
**Marker:** llp-0075, competitive-checkpoint, decision, ownership

Two named-decision open questions LLP 0075 surfaces, both required before the
prospective `single-instance-container-vm.v1` tranche can run.

**Resolved when:**

- The long-lived competitive-program owner/operator after the current
  implementation session is named (the adjudication machinery assumes a named
  human ratifier persists across reruns).
- The concrete provider, region, backup object store, and credential backend
  that instantiate `single-instance-container-vm.v1` for its first remote drill
  are pinned in a versioned protocol amendment under LLP 0063 (exact provider,
  package identities, credential health, instrument version), without rewriting
  v0's cutoff or evidence.
