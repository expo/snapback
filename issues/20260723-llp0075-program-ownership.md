# DECISION: long-lived program owner and the first container/VM remote drill target

**Status:** Open (author decision)
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
