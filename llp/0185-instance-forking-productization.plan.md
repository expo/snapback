# LLP 0185: Instance forking productization

**Type:** Plan
**Status:** Review
**Systems:** Storage, Deployment, Runtime, Scheduling, Assets, Security, Agent
experience, Developer experience, CLI, MCP, Documentation, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-05
**Revised:** 2026-08-07 (LLP 0189 alignment sweep: verification-cadence/claim-gating clauses re-scoped or annotated to the LLP 0189 D-3/D-6 defaults). 2026-08-07 (v2 Phase 6 publication at qualification C `ad0ad58748981010204b61eb5002e35b887a5093`: all four contiguous 12-round histories end dual-family `READY`; Charlie's v2 acceptance binds their heads, the complete evidence set, and the recomputed v2 implementation digest; the anchor publishes only the local/partial contributor-source guide row for exactly `macos/aarch64` and `linux/x86_64`. Phase 6 item 2 and normal-installation remain open, while the target-manifest tuple, public package, hosted/Cloudflare/remote targets, promotion/merge-back, and process containment remain `Missing` or explicit nonclaims); 2026-08-06 (author-directed Phase 6 publication result: Charlie accepted LLPs 0163–0165, authorized the exact acceptance fixture, and confirmed exactly `macos/aarch64` plus `linux/x86_64` release profile; the nine-item receipt, final carrier, and source anchor publish only the local/partial contributor-source `operating.instance-forks` guide claim. Item 2 and the normal-installation exit remain open; the target-manifest tuple, public package, hosted targets, promotion/merge-back, process containment, and broader agent-safe-storage facts remain `Missing` or explicit nonclaims); 2026-08-06 (execution reconciliation — body dated to the landed implementation: Phase 1 automatic expiry and `fork recover`, Phase 3 renewal and resource limits, Phase 4's completeness upgrade, and Phase 5's live asset lifecycle are marked implemented; stale guide-absent/recovery-unwired/asset-refusal claims corrected. Phase 6 outcome recorded: qualification commit 0ee1fadc1, dual-family READY over three review rounds, dual-platform row-13 receipts and executable suites, a digest-bound nine-item witness chain — but NOT published. `operating.instance-forks` stays target `none` and the manifest tuple stays `Missing` on three author-gated items: 0163/0164/0165 acceptance, the author-acceptance artifact, and the claimed platform set. Released-binary/npm parity remains open Phase 6 work, not re-scoped. Phases 7 and 8 remain deferred.); 2026-08-05 (Phase 0 items 2/6 closed by author ruling: LLP
0158's local design is Accepted after its independent review; the Phase 6
publication mechanism is the LLP 0061 guide capability-index claim, so
Phase 6 item 1's gate set binds to the capability-index row rather than an
LLP 0113 manifest, and LLP 0134's registration act is not required for the
local claim. OQ6 is resolved by the same ruling — row 13 narrows to fork
lifecycle metrics for this claim, bounds pending 0162-author ratification
after measurement.); 2026-08-05 (execution status: Phases 0, 1, 2a, 2b, 3, and 5
are executed with dated evidence on main, plus Phase 4's first slice (the
retained-base substrate and oracle-verified `snapback.fork-net-diff.v1`,
under LLP 0164's explicit target-choice delegation). Author rulings
2026-08-05: Phase 3 limit constants ratified; creation shares the renewal
lifetime cap; the item-9 containment answer for v1 is documented OS-boundary
guidance with no built sandbox tier until demand names one. Open executable
tail: Phase 4 items 5-8 (filters, pagination, human projection, LLP 0163
attribution), Phase 5's live in-fork upload/GC leg, and LLP 0165's
authorizer-backed completeness upgrade. Phase 6 waits on its item-0
governance gate (LLP 0158/0163/0164/0165 acceptance, LLP 0162 rows incl.
row 13, independent review); Phase 7 waits on Phase 6; Phase 8 stays
demand-gated. OQ1 and OQ3 remain open pending Phase 2b fleet observation.);
2026-08-05 (LLP 0158 status reconciliation — its local design is now Accepted,
so Phase 0 preserves that settled contract rather than instructing a
Draft-to-Review transition; derived-capability qualification/publication
remains separate and Missing); 2026-08-05 (initial draft — turns the remaining LLP 0158 F1/F2
work and the agent-safe-storage acceptance tail into an ordered program without
reopening the implemented F0a/F0b safety and local CLI contracts; entered the
LLP 0010 super-refine loop, Draft → Review; round 1 revision — added LLP 0024
ownership and corrected the LLP 0164/0099 boundary, added an automatic
TTL-enforcement item and a `recover()` wiring item to Phase 1, split Phase 2
into a single-consumer 2a and a Phase-3-gated 2b, bound Phase 4 to LLP
0164/0165's diff-substrate and completeness choices, resolved Phase 5's
item-2/exit contradiction in favor of LLP 0158 OQ5's already-decided
fork-private posture, and added governing-document/LLP 0162 row-13 and
publication-authority-mechanism gates to Phases 0 and 6 — per
`llp/reviews/0185-instance-forking-productization.claude.md` and
`llp/reviews/0185-instance-forking-productization.gpt-5.md`; round 2 closing
pass, author-directed after the 2-round budget converged with only small,
mechanical concerns remaining — corrected the LLP 0024 ownership bullet
(readiness is LLP 0030's, projection parity is LLP 0184's, verified against
LLP 0024's own text) and added an LLP 0134 registration-act bullet, moved
the fork-per-worktree helper from Phase 2a to Phase 3-gated Phase 2b (its
"collision-free ports" requirement contradicted 2a's no-concurrency framing
and the Plan's own dated teardown-race evidence), added port-contention
coverage to Phase 3 item 5, added LLP 0163/0024/0030 and the LLP 0134
same-commit obligation to Phase 6 item 0's governing-document gate, made
Phase 6 item 1 carrier-shape-agnostic, added `recover` to Phase 7's
projected catalog, and fixed the Sequencing/Summary Phase-2b-vs-Phase-4
dependency-graph contradiction both families independently flagged — per
`llp/reviews/0185-instance-forking-productization.claude-round2.md` and
`llp/reviews/0185-instance-forking-productization.gpt-5-round2.md`; applied
directly per the author's explicit closing-pass authorization rather than a
further reviewed round)
**Related:** LLP 0000, LLP 0010 (vendored, `vendor/llp/llp/`), LLP 0024,
LLP 0030, LLP 0044, LLP 0061, LLP 0072, LLP 0081, LLP 0088, LLP 0097,
LLP 0099, LLP 0113, LLP 0134, LLP 0158, LLP 0162, LLP 0163, LLP 0164,
LLP 0165, LLP 0184; `issues/20260803-guide-gap-instance-forks.md`;
`issues/shelved/20260803-agent-safe-storage-acceptance-tail.md`

## Summary

Snapback already has the difficult core of local whole-instance forking. LLP
0158 F0a/F0b implements and dogfoods finite-TTL derived deployments with
consistent copy, scrub-and-mint identity, fresh sidecars, inert autonomous
workers, fail-closed egress, ready descriptors, lifecycle commands, and an
app-row diff receipt. The remaining problem is not whether forking can work.
It is turning that source-only substrate into a discoverable, trustworthy,
resource-bounded workflow for developers, test suites, and agents.

This Plan sequences that work. The order is intentionally local-first:

1. make the existing surface understandable and automatable;
2. put the lowest-risk, single-consumer workflow into routine use;
3. close the missing isolation and diff evidence;
4. integrate fork-per-worktree, fork-per-suite, and fork-per-agent workflows
   once that evidence exists;
5. publish the local capability only after its named gates pass; and
6. pursue hosted forks only after the local workflow demonstrates sustained
   value.

This Plan does not turn derived deployments into mergeable branches. LLP 0097
and LLP 0164 own the separate promotable in-app branch class. LLP 0158 forks
remain disposable, non-promotable environments whose schemas and function
bundles may diverge.

## Motivation

At this Plan's 2026-08-05 starting point the local substrate was implemented
but still required an expert to find and operate it: the capability index
labeled it a GAP with no operating guide, the acceptance harness could not
fork a prepared parent in place of repeated seeding, and the first fleet
consumer had to learn the workflow from LLP 0158 and CLI help. (Resolved
during execution: `guide/operating/instance-forks.md` and the fork-aware
harness landed with Phases 1-2a; the capability-index row remains a GAP row
until Phase 6 publication.) The underlying motivation stands: unpublished
safety work is underused work, and agents recreate lifecycle conventions
independently until the workflow is paved and published.

There is also an evidence gap between “safe enough for first dogfood” and
“honest published capability.” The remaining agent-safe-storage corpus calls
for stronger parent/fork isolation, credential and effect matrices, exact-diff
oracles, resource bounds, and identity lifecycle coverage. Those gaps should
be closed before expanding the surface or making a capability claim.

The useful program is therefore not a single large “finish forking” project.
It is a sequence of independently valuable slices with explicit stop points.
Local ergonomics and proof can ship without hosted support. Hosted research
can stop without weakening the local feature. Asset improvements can remain
refusal-safe until their same-cut custody proof exists.

## Authority and boundaries

- LLP 0158 owns whole-instance derived-deployment semantics, identity,
  lifecycle, threat model, F0/F1/F2 phasing, and the no-promotion boundary.
  Its same-`appId` derived-deployment identity model and any F2 asset/shared-
  store amendment take effect on LLP 0158's own acceptance; this Plan
  sequences work against that substrate but does not accept it on 0158's
  behalf.
- LLP 0097 and LLP 0164 own promotable in-app branches, `CaptureOnly`, strict
  promotion, and the distinction between promotable and non-promotable fork
  classes. LLP 0164 additionally owns the diff *surface* for both classes —
  attributed change sequence, net diff, folding rules, and substrate naming —
  including the non-promotable derived-deployment diff this Plan's Phase 4
  extends. LLP 0165 owns journal completeness, proof/digest domains, and
  checkpoints. Phase 4 work must adopt LLP 0164's chosen diff substrate (base/
  preimage policy) and LLP 0165's writer-authority completeness choke point
  rather than minting a competing definition; where either choice is still
  open, Phase 4 requests it from that owner instead of deciding unilaterally.
- LLP 0024 owns host-operation identities, DTOs, and the JSON result-envelope
  contract shared by CLI, HTTP, and MCP. LLP 0030 owns the out-of-band
  ready-file handshake and `schemas/host-ready.schema.json` — LLP 0024 itself
  defers readiness to LLP 0030 ("readiness is the `--ready-file` descriptor …
  per LLP 0030's out-of-band [handshake]"). LLP 0184 owns control-catalog
  completeness and cross-surface projection parity. Phase 0's artifact
  inventory and compatibility freeze cover the fork-specific fields carried
  inside those three contracts; it does not redefine any of them, and Phase
  7's cross-surface parity claim (item 5) is LLP 0184's obligation, not LLP
  0024's or a new one this Plan invents.
- LLP 0134 owns the `TargetCapabilityId` registration/promotion act itself —
  first registration, `MaturityIntroductionRecordV1`, and same-commit
  guide/program-board updates — if Phase 0 item 6 selects the LLP 0113 route.
  Phase 6 item 6 performs that act under LLP 0134's rules; it does not define
  new registration semantics.
- LLP 0162 owns the agent-safe-storage acceptance profile, including row 13
  (performance), which the profile makes a hard per-component gate. This Plan
  may sequence its remaining work but may not declare a row complete or treat
  partial aggregate progress as sufficient for a narrow capability claim.
- LLP 0061 owns guide structure, capability-index honesty, and guide checks.
- LLP 0184 owns a future agent-accessible control-plane catalog and typed
  MCP/control projections. This Plan may name fork operations as a consumer,
  but it does not define a parallel control-plane schema.
- LLP 0113 owns qualified `TargetCapabilityId` publication; LLP 0072 owns
  deployment-adapter binding; LLP 0099 owns the container-VM migration-
  executor profile and does not itself hold general fork or volume-
  materialization semantics. Phase 0 must decide, with the relevant owners,
  which of these (or an LLP 0061 Guide capability-index claim, or a new
  source/package publication carrier) actually governs
  `operating.instance-forks` before Phase 6 defines a gate set against it.

The following constraints apply to every phase:

- Every product-created fork has a finite TTL, and expiry is enforced by an
  automatic mechanism this Plan builds (Phase 1), not merely recorded as
  metadata for a human or script to sweep. Renewal may move the expiry but may
  not create an unbounded fork.
- Parent credentials, sessions, cursors, signing authority, and sidecars do
  not become valid fork authority. Secret inheritance remains explicit.
- Unknown custody or egress families fail closed.
- Derived-deployment forks remain non-promotable. “Diff” is review evidence,
  not a merge plan.
- Local runtime quarantine does not claim containment of arbitrary native
  processes. Process containment requires an OS or hosted isolation boundary.
- Asset custody must be same-cut-proven before an asset-bearing source may
  fork. (Satisfied 2026-08-05/06: fork-private digest-verified same-cut blob
  copy with torn-cut refusal landed, and the live in-fork
  upload/serve/delete/GC/reap lifecycle is proven at live-server level;
  refusal now applies only to non-local-fs stores and unclassified digest
  algorithms, which stay fail-closed.)
- Publication state is target-specific. Local proof cannot imply hosted proof.

## Current baseline

The Plan begins from the following implemented LLP 0158 F0a/F0b baseline:

- `snapback fork create`, `list`, `diff`, `drop`, and deterministic TTL `reap`;
- consistent cold-parent and live-parent database copy, both materialized
  through SQLite's backup API (not a filesystem clonefile/reflink path);
- same-`appId` derived-instance lineage with independent auth/data identities;
- transactional custody sweep and scrub-and-mint;
- fresh admin, auth, and resume sidecars;
- secrets scrubbed by default with explicit copy opt-in;
- cron, durable jobs, and the asset runner inert on fork boot;
- durable, bounded, payload-free `DenyAll` egress-attempt markers;
- crash-safe publication: the staged-cut/quarantine protocol fails closed and
  refuses to boot on any incomplete cut. Local-evidence recovery
  (`instance_fork::recover`) exists and is unit-tested (execution note: it is
  now wired product-facing as `fork recover` — `ForkCommand::Recover` in
  `crates/snapback/src/cli/fork.rs` — per Phase 1);
- a ready descriptor and app-row-only diff receipt;
- registry-bound exact drop and injected-clock reaping; and
- dated fleet evidence for two simultaneous function-divergent worktrees.

Execution has since extended that baseline with dated evidence on main:
`fork renew` with a shared creation/renewal maximum-lifetime cap, automatic
expiry enforcement in two independent places, resource-limit admission
(fork-count, per-fork bytes, total bytes, diff work) refusing with
`SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED`, per-fork cleanup locking, the opt-in
`--retain-base` retained-base substrate, and the exact net diff (v2 receipt,
LLP 0165 authorizer-backed app-row completeness class where the whole write
window is provably armed; see Phase 4).

This baseline is source-level implementation evidence, not a published
capability. LLP 0158 is Accepted, while the independently qualified derived-
deployment capability remains wholly `Missing` and the capability index
therefore intentionally has target `none`.

## Program

### Phase 0 — Reconcile and freeze the local contract

Before adding ergonomics, make the implemented contract easy to review and
stable enough for downstream automation.

1. Preserve LLP 0158's accepted local contract against the current
   implementation and dated evidence, keeping implemented F0a/F0b distinct
   from open F1/F2 productization work.
2. Route any material change to that accepted contract through the vendored
   LLP 0005 RFC-process path (`vendor/llp/llp/0005-rfc-process.guide.md`) and
   LLP 0010 §2. This Plan sequences downstream work; it does not reopen or
   silently widen LLP 0158.
3. Inventory and version the automation-facing artifacts:
   - CLI JSON envelopes (the fork-specific fields carried inside LLP 0024's
     envelope, not the envelope contract itself);
   - ready descriptors (the fork-specific fields carried inside LLP 0030's
     `schemas/host-ready.schema.json`, not the schema itself);
   - fork lineage and mint receipts;
   - registry entries;
   - diff and reap receipts; and
   - stable diagnostic codes.
4. Record compatibility expectations for those artifacts. Fields used by
   automation must not drift silently.
5. Reconcile the LLP 0162/0163/0164/0165 acceptance rows and focused
   filesystem tickets so each remaining proof has one owner.
6. Decide, with the LLP 0113 and LLP 0061 owners, which publication mechanism
   actually governs `operating.instance-forks`: a qualified LLP 0113
   `TargetCapabilityId`, an LLP 0061 Guide capability-index claim, or a new
   source/package publication carrier — the third option has no existing
   owner today and requires naming one and defining its own acceptance path
   before Phase 6 can consume it, not merely before Phase 6 can name it.
   Record the decision, including LLP 0134's registration/promotion
   obligations if the LLP 0113 route is chosen; Phase 6 consumes the
   decision rather than choosing it.

**Exit:** the implemented local contract and its nonclaims are unambiguous,
`ref-check --verbose` passes, downstream phases have named artifact versions
rather than parsing human output, and the publication mechanism for Phase 6
is decided and owner-confirmed rather than assumed.

### Phase 1 — Pave the operating workflow

Make the existing capability usable without reading implementation source.

1. *(Implemented — automatic expiry lands in two independent places:
   create-path reap/refuse and the boot/periodic sweep;
   `SNAPBACK_FORK_EXPIRED_REAP_FAILED` / `SNAPBACK_FORK_SERVER_EXPIRED`.)*
   Add automatic expiry enforcement so the finite-TTL constraint is
   self-enforcing rather than metadata a human or script must remember to
   sweep: `fork create` reaps or refuses against already-expired managed
   forks first, and a boot-time/periodic sweep reaps expired forks without
   requiring an external `--now-ms` invocation. This item gates Phase 2b and
   Phase 7 — neither may create forks on a path that still depends on someone
   remembering to run `snapback fork reap`.
2. *(Implemented — `ForkCommand::Recover` in `crates/snapback/src/cli/fork.rs`.)* Wire the tested
   local-evidence recovery primitive (`instance_fork::recover`) to an
   invocable surface (a `snapback fork recover` verb, or an equivalent host
   operation) so a quarantined fork can actually be repaired, not just
   inspected and re-created.
3. Add `guide/operating/instance-forks.md` with:
   - a complete fork-per-worktree example;
   - source selection for cold databases and live ready descriptors;
   - finite TTL, the automatic-reap mechanism from item 1, renewal posture,
     and exact drop;
   - ready-file and shell/JSON consumption;
   - secret opt-in and credential isolation;
   - inert cron/jobs/assets and `DenyAll` egress;
   - asset-bearing-source refusal;
   - the app-row diff’s inclusions and omissions;
   - crash/stale-process recovery through the item-2 recovery verb; and
   - explicit local-only, experimental, non-promotable, and
     non-process-contained labels.
4. Improve CLI help so `create → inspect/list → diff → drop/reap/recover`
   reads as one lifecycle, with runnable examples and stable JSON examples.
5. Add a status/inspection projection containing fork ID, parent identity,
   fork point, expiry, process health, database and ready paths, secret
   disposition, worker posture, egress posture, and bounded diff summary.
6. Add shell-friendly projections for URL, fork ID, database path, ready path,
   and admin-token path without weakening JSON as the automation contract.
7. Add actionable diagnostics for quarantine, lineage, missing or malformed
   sidecars, stale registry entries, unverifiable live PIDs, partial
   publication, and resource-limit refusal. Resource-limit diagnostics land
   as Phase 3 defines the limits they describe; this item reserves the
   surface, not the final wording.
8. Keep `guide/capabilities.md` at target `none` while the publication gates
   remain open; update its evidence and GAP text without overstating maturity.

**Exit:** `node scripts/check-guide.mjs` and `./ref-check --verbose` pass; a
fresh agent can create, use, inspect, diff, recover, and clean up a fork from
the guide alone; the guide-gap ticket can close only when Phase 2a's harness
work also lands.

### Phase 2a — Integrate a single-consumer harness workflow

Turn manual lifecycle primitives into repeatable consumers for the lowest-risk
shape first: one fork at a time, one owner, no concurrent contention. This
slice does not need Phase 3's parallel-isolation, credential-matrix, or
resource-limit evidence — F0a/F0b's single-fork guarantees already cover it —
so it can land immediately after Phase 1. The worktree helper is deliberately
*not* in this phase: fork-per-worktree is a multi-fork, often-concurrent shape
(the Plan's own baseline records dated evidence of two simultaneous
worktree-bound forks hitting a drop/reap teardown race), so it belongs with
Phase 2b's Phase-3-gated items, not here.

1. Add an opt-in acceptance-harness mode that:
   - prepares or identifies one parent fixture;
   - creates a finite-TTL fork instead of reseeding;
   - starts the fork and exports its validated connection descriptor;
   - runs the suite against only that derived instance;
   - captures status and diff receipts; and
   - drops the fork in normal and interrupted cleanup paths.
2. Add reusable fork templates for prepared demo and acceptance fixtures.
   Templates are named parents, not immortal forks.

**Exit:** at least one real demo or acceptance program uses the harness,
single-fork and single-owner, repeatedly; the guide-gap ticket closes.

### Phase 2b — Integrate worktree, parallel-suite, and fork-per-agent workflows

Gated on Phase 3 (gate discharged — both phases are executed with dated
evidence; the ordering constraint is retained here as the record of why 2b
waited). Multi-fork, multi-owner, and concurrent use are exactly
where the missing isolation, credential, cleanup-race, port-contention, and
resource-limit evidence would bite, so this slice only starts once Phase 3
has delivered it — it does not run on the strength of Phase 2a's
single-consumer proof.

1. Add a fork-per-worktree helper with deterministic ownership metadata,
   collision-free ports, environment export, status discovery, and cleanup
   tied to an exact worktree rather than a guessed directory.
2. Add a fork-per-agent wrapper over Phase 2a's helper. Every fork records its
   owner/run identifier, purpose, creation time, expiry, and parent without
   placing secrets in metadata or logs.
3. Add test-runner integration for parallel suites sharing an expensive
   prepared parent while receiving isolated derived instances.
4. Add interruption tests proving that failed agents and killed test runners
   leave one of three dispositions, each named explicitly rather than
   conflated: a fully cleaned state; an unexpired orphaned fork cleaned up by
   its owner/run metadata (item 2); or a quarantined incomplete-publication
   fork repaired via Phase 1's recovery verb. Automatic reap (Phase 1 item 1)
   handles the fourth case — an expired fork nobody swept — but that is not
   an "interruption" outcome by itself.
5. Record a second diary from routine use across both 2a and 2b, not a
   bespoke qualification run, and compare the workflow with reseeding and
   restore-derived rehearsal.

**Exit:** parallel consumers cannot trample data, ports, credentials, or
cleanup ownership — because Phase 3 already proved it (including item 5's
port-contention coverage), not because this phase asserts it; at least one
real fleet consumer uses the worktree helper, fork-per-agent, or
parallel-suite integration repeatedly.

### Phase 3 — Complete isolation and lifecycle evidence

Close the most important remaining safety gaps before publication.

1. Prove that writes committed to the parent after the fork point never appear
   in the existing fork.
2. Complete the parent/fork credential matrix for sessions, agent grants,
   admin tokens, resume tokens, signing keys, revoked authority, stale
   authority, and explicitly inherited configuration.
3. Complete the egress-family matrix across HTTP fetch, push delivery, action
   streams, jobs, cron/manual drains, maintenance polling, telemetry,
   provider adapters, and asset-provider I/O.
4. Prove the future-family rule: an unclassified Snapback-owned egress or
   custody surface fails closed and creates a useful diagnostic.
5. Test concurrent lifecycle operations: create/drop/reap races, duplicate
   cleanup, process-exit boundaries, dead servers, stale registries, missing
   ready files, partial cleanup, port allocation/collision across
   simultaneously running forks, and expiry boundaries.
6. *(Implemented — `fork renew` + `ForkRenewReceiptV1`, 7-cut crash matrix,
   creation shares `MANAGED_FORK_MAX_LIFETIME_MS` per the 2026-08-05 author
   ruling.)* Add bounded TTL renewal. Renewal requires exact fork identity
   and registry binding, has a configured maximum, and emits a receipt; it
   never clears the expiry.
7. *(Implemented — deterministic `SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED`
   refusals with observed usage; limit constants author-ratified
   2026-08-05.)* Add fork-count, total-byte, per-fork-byte, and diff-work
   limits with deterministic refusal and inspection.
8. Add disk-pressure and resource-exhaustion tests, including interrupted
   copy, oversized parents, excessive fork counts, and retained-history
   exhaustion.
9. Publish OS-isolation guidance for workloads containing arbitrary native
   code. If an optional sandbox/container integration is added, advertise it
   as a separate containment tier.

**Exit:** applicable LLP 0162 isolation, effect, identity, and resource rows
have dated evidence or an explicit author-approved rescope. No local
capability claim depends solely on unit tests of happy paths.

### Phase 4 — Make diffs exact and reviewable

The diff must become trustworthy evidence rather than merely convenient
output. At this Plan's start the receipt was an attributed post-image
sequence only; execution closed that gap in two dated slices under the owning
Specs (never inventing a competing base or completeness definition): the
2026-08-05 retained-base slice (`--retain-base`, digest-bound
`snapback.fork-base.v1`, oracle-verified net diff) and the 2026-08-06
completeness upgrade — v3 receipts with separate writer-coverage and
`attribution: "absent-v1"` facts, stream-qualified `(base, head]` boundaries
and canonical domain-separated digests, and the completeness class
`registered-connection-defensive-app-rows-v1`, claimed only when the fork's
whole write window is provably armed through LLP 0165's
generated-writer/SQLite-authorizer choke point on registered connections
under SQLite defensive mode, with unarmed, late-armed, partial-layout, and
retention-gap forks failing closed to `journal-enumerated-v1`. The class
name states its own boundary: it is an in-process, registered-connection
claim, not OS containment — a same-user external process with raw
filesystem access remains detectable but not preventable, as LLP 0165
records.

0. Adopt LLP 0164's chosen diff substrate (the immutable retained base or
   first-write preimage policy an exact net diff needs) and LLP 0165's
   writer-authority/SQLite-authorizer completeness choke point. Adopt a
   finite history-retention or immutable-base availability rule so the
   receipt's existing after-retention refusal has a named, bounded contract
   instead of an open-ended one. Where LLP 0164 or LLP 0165 has not yet made
   the needed choice, this item is a request to that owner, not a decision
   this Plan makes for them.
1. Compare the journal-derived attributed sequence and net app-row diff
   against an independent base/head state oracle.
2. Cover creates, updates, deletes, multiple commits, multiple tables,
   sequence allocation, system fields, schema changes, retention boundaries,
   sibling forks, and empty/no-op workloads.
3. Name the diff substrate and completeness domain on every receipt, following
   LLP 0164/0165 ownership.
4. Make omissions structured and machine-readable. At minimum distinguish
   app rows, schema, auth state, operational tables, configuration, assets,
   egress attempts/captured effects, telemetry, and sidecars.
5. Add table, operation, version-range, and provenance filters without
   allowing a filtered view to masquerade as a complete diff.
6. Add pagination or streaming with digest- and generation-bound continuation
   so large diffs remain bounded.
7. Add a concise human projection: totals, affected tables, representative
   changes, omissions, truncation, and the exact receipt digest.
8. Attribute changes to operations or agent/test steps where LLP 0163
   operation identity is available. Absence of attribution stays explicit.
9. Retain the reviewed receipt as a first-class test and code-review artifact.

**Exit:** independent-oracle fixtures pass against the item-0 substrate and
completeness choke point; LLP 0162 row 9 has dated evidence or an explicit
author-approved rescope, on the same terms as Phase 3's exit; every diff
declares its domain and omissions; large diffs are bounded; reviewers can
bind approval to an exact receipt without implying mergeability.

### Phase 5 — Improve asset custody

Asset work remains additive because refusal is already the safe behavior.
LLP 0158 OQ5 already decided the local posture — refusal now, fork-private
same-cut copying as the additive local path, with any shared/content-
addressed store deferred to F2/hosted under its own GC-barrier design. This
phase implements that decision; it does not reopen it. A shared or
content-addressed asset store is Phase 8/hosted scope, gated on an LLP
0158/0044 amendment, not a local-phase option.

1. Measure asset-bearing parent size and copy behavior on supported local
   filesystems.
2. *(Implemented 2026-08-05 — the private-copy path is proven, so the
   refusal now applies only to non-local-fs stores and unclassified digest
   algorithms.)* Implement a same-cut fork-private asset-tree copy. Shared
   or mutable custody, content-addressed or not, is out of scope for this
   phase.
3. Bind asset metadata, blob cut, signing authority, and lifecycle generation
   to the same consistent fork operation.
4. *(Implemented 2026-08-06 — the live-server lifecycle test
   `live_fork_asset_lifecycle_is_private_gc_safe_and_exactly_reaped` proves
   upload through the production attempt/TUS/finalize path, fork-local
   signing and serving, cross-instance delete/GC independence in both
   directions, and asset-bearing exact drop plus deterministic reap; the
   same slice fixed settled-Sessions fork boot to read the capability-aware
   schema through an owner-only cold-start carrier.)* Prove parent-signed
   URL refusal, fork-local URL validity, new fork uploads, deletion, garbage
   collection, parent cleanup, and fork reaping.
5. Inspect and estimate asset-copy cost before creation; refuse predictably
   when quotas or platform capabilities cannot satisfy fork-private copying.
6. Extend diff/status receipts, using Phase 4 item 4's structured omission
   domains, with explicit asset-domain facts while keeping app-row and asset
   completeness separate. This item runs after Phase 4 item 4 lands the
   domain format it extends.

**Exit:** an asset-bearing fork either succeeds with same-cut private custody
and independent signing authority or refuses before publication; there is no
metadata-only success naming missing or parent-controlled blobs; no shared or
content-addressed store has been introduced locally.

### Phase 6 — Publish the local capability

Publication is a separate decision from implementation.

0. Confirm the governing documents this publication depends on have reached
   their own acceptance, independent of this Plan: LLP 0158's same-`appId`
   derived-deployment identity model (and any amendment Phase 0/5 relied on)
   is accepted, not merely Draft or Review; LLP 0163, LLP 0164, and LLP 0165
   — the acceptance-tail ticket's named extracted Specs — have each completed
   their own review/acceptance loop; LLP 0024 and LLP 0030, which own the
   envelope and ready-file schema Phase 0 item 3 froze fork-specific fields
   inside of, are accepted or the fork-specific fields are re-verified
   stable against whatever they settle to; and every applicable LLP 0162 row
   for the narrow `operating.instance-forks` claim — including row 13, which
   the profile makes a hard per-component gate — is green or explicitly
   rescoped by the LLP 0162 author for this claim. If the LLP 0113 route was
   selected in Phase 0 item 6, LLP 0134's registration/promotion obligations
   are satisfied in the same commit as item 6 below. This Plan does not
   substitute for any of those owners' acceptance decisions.
1. Define the target-specific publication gate set using the mechanism Phase
   0 item 6 decided (an LLP 0113 `TargetCapabilityId` manifest, an LLP 0061
   Guide capability-index claim, or a new source/package carrier with its
   own owner-approved acceptance path) — this item implements that decision
   in whatever shape it takes; it does not assume a manifest where the
   chosen mechanism has none, and it does not choose the mechanism.
2. Verify released binaries and npm-distributed tooling expose the same
   lifecycle and artifact schemas qualified from source.
3. Run the local proof on every supported release platform and record copy
   strategy, live-parent behavior, size limits, and timing without generalizing
   across unmeasured platforms.
4. Complete an independent implementation/security review after the final
   contract bytes freeze.
5. Run the claim-scoped evidence for what this publication asserts (the
   fork acceptance suite and its defining checkers), referencing the most
   recent eligible complete battery for the broader set — LLP corpus audit,
   guide validation, generated-artifact drift checks, packaging tests — per
   LLP 0189 D-6 (2026-08-07 re-scope; unrelated reds ticketed and named).
6. Only then update `operating.instance-forks` from target `none` to the
   specifically proved local target and maturity.

**Exit:** item 0's governing-document and LLP 0162 row-13 gate is satisfied; a
normal installation, rather than a source checkout, can follow the guide and
pass the same acceptance workflow; capability metadata points to a dated,
digest-bound publication witness.

#### Phase 6 outcome — PUBLISHED 2026-08-07

**Superseded by the record below.** `operating.instance-forks` published at
qualification commit `ad0ad58748981010204b61eb5002e35b887a5093`, landed as
`7cada777b`; the anchor reads `published` and the oracle reports
`agent_safe_derived_deployment_fork_v1:published`. See "Phase 6 publication
— 2026-08-07" at the end of this section for the final state. The
intermediate record that follows is retained as the honest history of why
publication was withheld through 2026-08-06.

#### Phase 6 interim state — 2026-08-06 (not published; author-gated)

Qualification commit `0ee1fadc136e837f430556374a5842ac82069004`.
`operating.instance-forks` **remains target `none`** and the
`agent_safe_derived_deployment_fork_v1` manifest tuple remains wholly
`Missing`. The publication anchor is `withheld`.

Satisfied by this pass:

- **Item 0, partly.** LLP 0158 is Accepted (2026-08-06). LLP 0024/0030
  fork-field stability was re-verified against the Phase 0 freeze. LLP 0162
  row 13 is measurement-complete for the narrow claim: the author's
  2026-08-05 scoping and 2026-08-06 bound ratification are transcribed into
  LLP 0162 itself (v0.40, its named revision authority), and dated receipts
  for both supported release platforms bind the qualification commit with
  every ratified median bound passing. **Not satisfied:** LLPs 0163/0164/
  0165 remain `Draft`; three rounds of mutually blind dual-family review
  ended in `READY` from both families for all three Specs, but the status
  change is the documents' author's decision, not this Plan's.
- **Item 1.** The gate set binds the LLP 0061 capability-index row per the
  Phase 0 item 6 ruling. Its digest-bound witness chain is implemented as a
  closed nine-item fork-specific evidence vocabulary in
  `scripts/check-agent-safe-publication.mjs` with a published-state semantic
  validator (and a `deny_unknown_fields` Rust mirror) that re-derives bench
  bounds, commit ancestry, review provenance and distinct families, and the
  exact component/fact tuples. Storage evidence cannot substitute for it.
- **Item 3, for the two measured platforms only.** macOS aarch64 and Linux
  x86_64 run the executable fork suites green at the qualification commit
  (48 `instance_fork::`, 37 `fork_promotion::`, 15 live-server CLI, and the
  Hermes VM egress test on each). No third platform is claimed.
- **Item 4.** The independent implementation/security review ran to
  dual-family convergence over three rounds
  (`llp/reviews/0158-instance-forking.implementation-2026-08-06.{codex,fable}.md`,
  `…/0163-0165-derived-fork-implementation-2026-08-06.{codex,fable}.md`).
  Eight material defects were found and fixed, including a reviewer-
  reproduced exploit that re-earned the completeness class across a
  coverage disarm/rearm gap, an armed-fork `fork renew` wedge, and an
  intermittent (1-in-8) concurrent-create hang traced to inherited
  capture-pipe descriptors surviving into the detached server. Round 3
  found no new material findings.

Open at this Plan's Phase 6 exit, all author-gated:

1. Acceptance of LLPs 0163/0164/0165.
2. The author-acceptance evidence artifact (the ninth witness slot; its
   digest is the only one still zeroed).
3. Confirmation that macOS aarch64 + Linux x86_64 is the complete claimed
   platform set.

Item 2 (released-binary/npm parity) and the exit's "normal installation
rather than a source checkout" clause are **not** met: the guide still
teaches a source-checkout workflow. They are not re-scoped — they remain
Phase 6 work for whoever resumes after the author gate.
The ordered remaining procedure is recorded in
[`issues/20260806-derived-fork-publication-author-gate.md`](../issues/20260806-derived-fork-publication-author-gate.md).

#### Phase 6 publication result — 2026-08-06

The author supplied all three rulings that gated the outcome above. Charlie
Cheever accepted LLPs 0163/0164/0165 on the three-round mutually blind
dual-family `READY` convergence, directly authorized the agent-authored exact
acceptance fixture recording that act, and confirmed the complete claimed
release-platform set as exactly `macos/aarch64` plus `linux/x86_64`, release
profile. The fixture closes the ninth receipt binding. The final carrier and
anchor publish the LLP 0061 guide capability-index row as
`operating.instance-forks`, target `local`, maturity `partial`, with the dated
digest-bound receipt as witness.

The published candidate is exactly finite-TTL, fail-closed `DenyAll`,
`NotPromotable`, `currentHead`, and `HostMediated`. It claims no process or OS
containment, no hosted/Cloudflare/remote target, no promotion or merge-back,
and no public package. Per the Phase 0 ruling,
`agent_safe_derived_deployment_fork_v1` remains wholly `Missing` in every LLP
0113 target manifest; the guide row alone carries this narrow source claim.

This result does **not** complete all of Phase 6. Item 2 — released-binary and
npm-distributed tooling parity — remains open, as does the exit clause that a
normal installation rather than a source checkout can follow the guide and
pass the same workflow. Those conditions were not re-scoped by publication.

#### Phase 6 v2 publication result — 2026-08-07

Qualification C is
`ad0ad58748981010204b61eb5002e35b887a5093`, with implementation digest version
`snapback:agent-safe-implementation-tree:v2` and recomputed digest
`sha256:fc6e3e58453b4700ce06c647aaef87132879e0da336e560eca834d1d42c5459a`.
The pre-existing canonical lifecycle receipts bind C on exactly
`macos/aarch64` and `linux/x86_64`, both release profile. The four structured
Codex/Fable histories are contiguous through round 12 and every round-12 head
names C with Scope 1 and Scope 2 `READY`. The v2 named-author acceptance binds
those four heads, every non-self evidence digest, the v2 implementation
digest, candidate facts, and qualified component. The final receipt, carrier,
and anchor publish `operating.instance-forks` only as target `local`, maturity
`partial`, through the LLP 0061 guide row and its dated digest-bound witness.

The result is finite-TTL, fail-closed, non-promotable, and host-mediated; it
claims no process or OS containment, hosted/Cloudflare/remote target,
promotion or merge-back, public package, released-binary/npm parity, or normal
installation. Phase 6 item 2 and the normal-installation exit clause remain
OPEN. Per the Phase 0 ruling, `agent_safe_derived_deployment_fork_v1` stays
wholly `Missing` in every LLP 0113 target manifest. Publication artifacts are
unsigned and not transparency-logged; a commit-capable actor fabricating both
reviewer histories and the named-author acceptance is outside the guarantee.
The per-round prose-freezing weakness remains filed as
`issues/20260807-review-prose-history-not-frozen.md`.

#### Phase 6 publication — 2026-08-07 (final)

Qualification commit C = `ad0ad58748981010204b61eb5002e35b887a5093`,
implementation digest
`sha256:fc6e3e58453b4700ce06c647aaef87132879e0da336e560eca834d1d42c5459a`;
published in `7cada777b`. The oracle
(`node scripts/check-agent-safe-publication.mjs`) reports
`agent_safe_derived_deployment_fork_v1:published`, with
`agent_safe_storage_v1` still `withheld` and unweakened.

Gate disposition:

- **Item 0 — satisfied.** LLP 0158 Accepted; LLPs 0163/0164/0165 Accepted by
  the author 2026-08-06; LLP 0024/0030 fork fields re-verified stable; LLP
  0162 row 13 measurement-complete with the author's scoping and bound
  ratification transcribed into 0162 itself (v0.40) and dated dual-platform
  receipts bound to C.
- **Item 1 — satisfied.** The LLP 0061 capability-index row is the claim
  carrier per the Phase 0 ruling, behind a closed nine-item digest-bound
  evidence chain with a published-state semantic validator and a Rust mirror.
- **Item 3 — satisfied for exactly two platforms.** `macos/aarch64` and
  `linux/x86_64` each run the executable fork suites and the release
  row-13 bench green at C. No third platform is claimed or implied.
- **Item 4 — satisfied.** Twelve rounds of mutually blind dual-family review
  ended `READY` on Scope 1 (LLP 0163/0164/0165) and Scope 2 (publication)
  from both families, recorded in contiguous v2 hash-chained histories whose
  heads the author acceptance binds.
- **Item 5 — satisfied.** ref-check, guide validation, capability maturity,
  inventories, generated-artifact drift, the publication checker (66/66),
  and the fork suites (48 unit, 37 promotion, 15 live-server CLI) pass.
- **Item 6 — done.** The capability row moved from target `none` to `local`,
  naming the two proved platforms and pointing at the dated digest-bound
  receipt.

**Item 2 and the "normal installation rather than a source checkout" exit
clause remain OPEN and are not re-scoped.** The published row and the
operating guide both say so: released-binary and npm parity are unclaimed,
and the workflow is contributor-source.

Explicit nonclaims carried into the published row: no process or OS
containment, no hosted/Cloudflare/remote target, no promotion or merge-back,
no public package, no third platform, and no broader agent-safe-storage
facts. The `agent_safe_derived_deployment_fork_v1` target-manifest tuple
remains wholly `Missing` — the guide row is the carrier, by the author's
Phase 0 ruling.

Disclosed residuals: repository evidence is unsigned and not
transparency-logged, so an actor with commit access who fabricates both
reviewer histories and the named-author acceptance is outside the guarantee;
and the review prose history is a current-state binding rather than a frozen
per-round record
([`issues/20260807-review-prose-history-not-frozen.md`](../issues/20260807-review-prose-history-not-frozen.md)),
alongside the ungated codegen declaration
([`issues/20260807-codegen-declaration-has-no-drift-gate.md`](../issues/20260807-codegen-declaration-has-no-drift-gate.md)).

Process note for the next program of this shape: three review rounds' worth
of artifacts (4, 7, 9, and 11) were lost during this program by resetting
review worktrees before committing, and one "verbatim" restoration silently
reinstated a defence its reviewer had retracted. All were recovered and the
losses are recorded rather than papered over, but the lesson is mechanical —
commit review artifacts the moment a round returns.

#### Phase 6 publication withdrawal — 2026-08-07

The wave-drift integration changed nine proof/checker/metrology files inside
qualification C's v2 implementation digest. On the combined tree the actual
publication oracle refused C digest
`sha256:fc6e3e58453b4700ce06c647aaef87132879e0da336e560eca834d1d42c5459a`
versus P digest
`sha256:5e6ed9beda2067a7da8dbb6a3a133f91f532bb4323fd6b24805be18d0a74e9ab`.
This is a qualification invalidation, not a fork correctness regression.

The anchor is withheld and the capability-index row returns to target `none`.
Historical evidence remains byte-retained, but items 1 and 6 are reopened;
item 2 and normal installation were already open. Republication follows the
LLP 0189 §Consequences sequence: first re-scope the digest with drift gates
for the departing wave-shared files (landing the two deferred
checker-hardening tickets in the same cycle), then select one fresh
qualification C against the re-scoped digest, with fresh macOS/aarch64 and
Linux/x86_64 qualification receipts, fresh accepted review heads, and new
named-author acceptance — so future wave landings stop rotating the digest.
The work is tracked in
`issues/20260807-derived-fork-publication-wave-drift-requalification.md`.

### Phase 7 — Expose bounded agent-control operations

Once the local contract is published, make it available through LLP 0184’s
control plane rather than inventing one-off agent commands.

1. Project create, inspect/list, diff, renew, drop, reap, and recover as typed
   catalog operations over the stable CLI/runtime implementation. Recovery is
   as real a control as the others — Phase 1 item 2 makes it product-facing
   — so it gets a catalog disposition rather than being left implicit.
2. Require bounded defaults, exact target binding, finite TTL, idempotency,
   authority disclosure, and receipts.
3. Permit policy to constrain parent selection, maximum lifetime, fork count,
   byte budget, egress posture, and secret inheritance.
4. Add an operator-visible dashboard or admin projection showing active forks,
   owners, associated worktrees/agent runs, expiry, process health, resource
   use, and cleanup actions.
5. Prove projection parity: every surface that exists for a given operation
   (MCP, CLI, API, or UI — LLP 0184 permits `cliOnly`, `mcpOnly`, and
   `apiOnly` rows, not all four for every operation) resolves to the same
   semantic operation and receipt domain.

**Exit:** an agent can manage a fork without scraping prose or human CLI
output, and an operator can enumerate and terminate every agent-created fork.

### Phase 8 — Hosted research and implementation

Hosted forks begin only after the local workflow has repeated demand and the
local publication gate is green.

1. Run the Cloudflare spike named by LLP 0158: compare Durable Object/PITR
   bookmark restoration with explicit export/import for consistent fork
   materialization.
2. Separately assess container-VM volume snapshots as accelerator evidence,
   reusing LLP 0099's migration-executor infrastructure where applicable, but
   treat `ProcessContained`-tier fork semantics as LLP 0158 F2 scope bound
   through LLP 0072's adapter — LLP 0099 is a migration-executor profile and
   does not itself own general fork or volume-materialization semantics.
3. Define hosted derived-instance identity, deployment binding, fresh
   credentials, secret custody, and target-specific lineage proof.
4. Enumerate and quarantine hosted egress across Workers, queues, scheduled
   triggers, assets, telemetry, and third-party services.
5. Add finite leases, quotas, cost estimates, budgets, billing attribution,
   and automatic deletion before enabling agent creation.
6. Make create/delete/status operations idempotent and auditable with
   externally anchored receipts where the target requires them.
7. Decide hosted asset custody and garbage-collection barriers independently
   for each target.
8. Prove production-shaped sanitized-snapshot rehearsal without describing a
   fork as production or enabling merge-back.
9. Publish each hosted target separately; local maturity does not transfer.

**Exit:** one hosted target passes its own custody, isolation, lifecycle, cost,
and deletion corpus. A research result may instead decide not to build hosted
forks; that is a valid completion of the phase.

## Deferred ideas

The following are useful only after the earlier program demonstrates demand:

- reset a fork to its original fork point;
- checkpoint a prepared state as the named parent for new forks (if this
  touches checkpoint substrate, LLP 0165 owns it, not this Plan);
- richer fork templates and fixture catalogs beyond Phase 2a item 2's named,
  non-immortal demo/acceptance parents;
- automatic IDE integration;
- long-running preview environments with explicit graduation into an
  independently provisioned deployment; and
- `CaptureOnly` effect rehearsal, implemented once through LLP 0097/0164’s
  shared effect ledger rather than a fork-specific substitute.

None of these may erase TTL, custody, identity, or publication gates.

## Non-goals

- **General merge-back.** Derived-deployment forks may diverge schema and
  runtime behavior. Adding merge semantics would be a separate product with
  conflict, authorization, effect, schema, and custody contracts.
- **Replacing promotable in-app branches.** LLP 0097/0164 branches serve a
  different class with shared schema/bundle and strict promotion.
- **Production cloning by default.** Access to production-shaped data requires
  a separate sanitization and authority policy.
- **Indefinite environments.** Preview demand does not silently remove finite
  lifetime or cost bounds.
- **Native-process containment claims from runtime gates.** `DenyAll` covers
  Snapback-owned egress surfaces, not arbitrary host syscalls.
- **Capability-by-existence.** Landed source code and a passing unit test do
  not authorize guide or manifest claims.

## Sequencing and parallelism

The critical path is Phase 0 → Phase 1 → Phase 2a → Phase 3 → Phase 2b and
Phase 4 → Phase 6 → Phase 7. Phase 2b is gated on Phase 3, not merely
sequenced after it in name — Phase 2b's parallel/agent items may not start
until Phase 3's isolation, credential-matrix, cleanup-race, and resource-limit
evidence lands. Phase 5 can run after Phase 3 establishes the custody test
pattern and after Phase 4 item 4 lands the omission-domain format Phase 5
item 6 extends. Phase 8 is demand-gated by Phase 6 and repeated local use.

Within that path:

- guide and CLI projection work can proceed together after artifact versions
  freeze;
- the harness (Phase 2a) and the worktree/agent/parallel-suite consumers
  (Phase 2b) can share one lifecycle library, but only the harness is
  single-fork/single-owner enough to land before Phase 3 — Phase 2b's items
  cannot;
- Phase 3 gates Phase 2b, Phase 5, and publication; Phase 4 runs independently
  of Phase 3 and also gates Phase 5 (via its item 4 domain format) and
  publication, but nothing in Phase 2b consumes Phase 4 — the two are
  parallel after Phase 3, not sequential;
- asset custody must not block non-asset forks; and
- hosted research must not change local contracts speculatively.

## Acceptance

This Plan is complete when either:

1. Phases 0–7 are complete for the local target, the capability is published
   with an exact witness, and Phase 8 has either produced one independently
   qualified hosted target or a dated decision not to pursue one; or
2. a later LLP supersedes this Plan with an explicit disposition for every
   unfinished phase.

Intermediate success is intentionally meaningful. Completing Phases 0–2a
makes the existing experimental feature usable for single-fork, single-owner
consumers. Completing Phases 2b–4 and 6 (Phase 5 is off the critical path and
does not gate this) makes it honestly publishable locally. Hosted support is
not required to claim the local program succeeded.

## Open questions

1. Renewal already lands in Phase 3, after Phase 1's automatic-reap
   enforcement and after Phase 2a's single-consumer workflow, not in the
   first paved workflow. Given that placement, is Phase 1's automatic reap
   plus Phase 3's bounded renewal enough for Phase 2b's agent workflows, or
   does the default renewal maximum still need to move earlier once agent
   fleets are observed hitting it?
2. Which local platforms and filesystem copy strategies are required for the
   first publication claim?
3. Within Phase 2b, the worktree helper binds to exact worktree identity and
   the fork-per-agent wrapper binds to a generic owner/run identifier for its
   own consumers — is that dual binding the intended final answer, or should
   one surface unify onto the other once both are built?
4. What is the smallest independent diff oracle that remains trustworthy for
   large databases without becoming a second production diff engine?
5. Resolved by this revision: LLP 0158 OQ5 already decided the local asset
   posture (fork-private copying now, shared/content-addressed custody
   deferred to hosted/F2), so Phase 5 implements that decision rather than
   re-opening it.
6. Phase 6 item 0 now names LLP 0162 row 13 explicitly as a publication gate.
   Which of row 13's applicable submetrics apply to the narrow local
   `operating.instance-forks` claim specifically, as opposed to the broader
   agent-safe-storage profile, and does the LLP 0162 author agree with that
   scoping?
7. What sustained local-use threshold is sufficient to authorize the hosted
   Cloudflare/container research phase?
