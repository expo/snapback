# 0081: hosted Durable Object executor profile (deferred)

**Status:** Open — OQ7 answered 2026-07-26 (container-VM first, DO explicit second; both must reach production quality). Slice 1 (profile LLP) in flight; slices 2-3 gated on the LLP 0072 container-VM drill earning remote evidence.
**Severity:** P3
**Systems:** Migrations, Deployment, Cloudflare
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §1, LLP 0072, LLP 0014
**Marker:** step5-impl

Deferred: the resident alarm-resumed DO executor as a separately versioned
LLP 0072 conformance profile — durable enqueue in the write-owning object,
shared-dispatcher wakeups, eviction/contention fault hooks, hosted
control-plane approval. Not required for Step 5 (local SQLite is the
admission profile); unblocks when a hosted target is selected under 0072.
Status Deferred in spirit — kept Open with this boundary recorded. L-sized.

## Decision package (2026-07-26)

Scoped read-only against the corpus at origin/main (6aa857a8). The facts:

- **A first hosted adapter IS selected under LLP 0072 — and it is not the
  Durable Object.** The first-adapter author decision (LLP 0072, 2026-07-22,
  Charlie Cheever) selected `single-instance-container-vm.v1` as the first
  complete hosted adapter, and says explicitly: "The existing Cloudflare
  line remains a narrow proof until it satisfies this RFC's profile without
  semantic substitutions." This ticket as originally written (a resident
  alarm-resumed DO executor) presupposes the Cloudflare adapter, which is
  exactly the line the selection passed over.
- **No hosted substrate can truthfully run the 0081 conformance corpus
  today.** LLP 0072 is Draft; its own text records "No hosted adapter or
  gate is claimed", `activationEligible: false` with blocking GAPs for
  every unimplemented adapter/drill/migration fact, and a deterministic
  harness that records `remoteEvidence: false`. The 2026-07-26 Revised
  entry adds only a partial hosted-auth admission on an LLP 0098
  loopback-terminated target with "no control-plane adapter operations …
  for this target". LLP 0081's hosted items require hosted approval as an
  audited control-plane operation bound to LLP 0072's identities — machinery
  that has not yet earned remote evidence on any adapter.
- **LLP 0081 open question 7 is the actual gate:** "Which hosted adapter,
  if any, should be the first separately admitted migration-executor
  conformance profile?" The DO-specific acceptance items (eviction and
  alarm contention through LLP 0014's shared dispatcher) are conditional
  on a DO target by the RFC's own wording and travel with the Cloudflare
  line, whenever it qualifies.

**Recommendation:** align the first migration-executor conformance profile
with the already-selected `single-instance-container-vm.v1` adapter rather
than the Durable Object. Same substrate as every other first-profile hosted
claim, no new decision surface, and the DO-specific items stay honestly
parked with LLP 0014. Sequencing: this profile becomes buildable only after
the 0072 container-VM adapter passes its own drill corpus with remote
evidence — building the executor first would stack an audited-approval
consumer on an unqualified control plane.

**Scoped plan once unblocked** (sliced, roughly M+M+L):
1. Profile LLP (new number, Draft): the versioned conformance profile
   binding the 0081 corpus + fault-injection hooks to the container-VM
   adapter's identities, approval custody (closing the rehearsal-receipt
   custody residual in `20260726-0081-spec-amendment-frictions.md` item 4),
   and the resume/lease mapping.
2. Executor arm: durable enqueue + resume on the adapter's single-instance
   lifecycle (no shared-dispatcher work — that is DO-specific), driving the
   existing 13-state journal machine over the remote target; hosted
   approval via the 0072 control-plane operation.
3. Conformance corpus run on a real deployment with remote evidence;
   kill-point and downtime-ceiling fixtures re-run remotely; first passing
   corpus recorded in the profile LLP per LLP 0081's closing paragraph.

**What Charlie must decide:** answer LLP 0081 open question 7 — admit
`single-instance-container-vm.v1` as the first migration-executor
conformance profile (recommended), name the Cloudflare DO instead (keeps
this ticket's original shape but contradicts the recorded first-adapter
boundary), or leave the profile unassigned until the 0072 drill corpus
passes somewhere. No build starts before that answer plus a qualified
adapter.

## 0072-lane custody residuals (relocated 2026-07-26)

Relocated from `20260726-0081-spec-amendment-frictions.md` item 4 so that
ticket could close whole: on the local profile, rehearsal-receipt custody is
structural (an operator file). When this hosted profile lands, it owes the
control-plane pieces the local profile cannot express — authenticated
rehearsal-receipt custody as a control-plane record, and binding the
rehearsal's `source_backup_identity` to a verified LLP 0072 backup manifest
rather than an operator-asserted string.
