# 0081: hosted Durable Object executor profile (deferred)

**Status:** Open — OQ7 answered 2026-07-26 (container-VM first, DO explicit second; both must reach production quality). Slice 1 done: LLP 0099 (`container-vm-migration-executor.v1`, Draft) specifies the profile, including the 0072-lane custody residuals below as spec. Slices 2-3 (executor arm, remote corpus) gated on LLP 0099 G1: the container-VM adapter passing the LLP 0072 drill corpus with remote evidence.
**Impact:** 3
**Urgency:** 1
**Ease:** 1
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “0081: hosted Durable Object executor profile (deferred)” shows the issue materially affects reliability, verification, or developer experience; the work is explicitly deferred behind prerequisites, while delivery is a dependency-heavy, multi-stage program, with specific cited code, progress, or acceptance criteria.
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


## Triage (2026-08-26 leftover sweep)

Still open. LLP 0099 is **Accepted** (2026-08-03); the container-VM executor profile is still not in any advertised manifest until G3. G1 is unmet: Fly still refuses lifecycle with `SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`. DO executor remains the explicit second profile, parked behind Cloudflare qualifying under LLP 0072.

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

## Slice 1 record (2026-07-26)

[LLP 0099](../../llp/0099-container-vm-migration-executor-profile.spec.md)
authored (Draft): identity binding (all nine audience fields required;
approval as an audited LLP 0072 control-plane operation), executor
placement on the single-instance lifecycle (supervisor-restart resume, no
dispatcher/alarm machinery), the interruption-class mapping for the 0081
fault matrix, control-plane custody for approvals and rehearsal receipts
(closing the custody residuals above as spec), the remote-vs-local corpus
split, and the G1→G2→G3 gate ladder. The custody residuals section above
stays as the historical record; its normative home is now LLP 0099.

## Triage freshness note (2026-08-01 sweep)

Still valid, header stale: LLP 0099 is now Review (not Draft),
revised 2026-07-28 with the 'First hosted executor decisions' section —
slice 1 is complete as this ticket's own record says. G1 remains unmet:
0099 §Gates still says 'none is claimed today', and the Fly driver still
declares the four control-plane capability gaps with every lifecycle-v2
op refusing SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE
(packages/snapback-cli/adapters/fly-machines-vm-driver.mjs). Commit
89d95cff staged the runtime artifact as release-manifest FACTS only —
staging, not the carrier.
