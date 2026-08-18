# LLP 0158: Instance forking

**Type:** RFC
**Status:** Accepted
**Systems:** Storage, Deployment, Runtime, Scheduling, Assets, Security, Agent
experience, Developer experience, CLI, Documentation, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-03
**Revised:** 2026-08-09 (final v3 derived-fork publication at qualification C `04332ab8b73799bd3279b3150dbd8598df275530`: the seven-round frozen requalification chain ends dual-`READY` at exact C, both canonical platform receipts and Charlie's dated author acceptance bind the scoped implementation digest, and the guide republishes only the narrow contributor-source local claim. LLP 0189 D-3 honestly reports later scoped evolution as `PUBLISHED_REQUALIFICATION_DUE`; D-4 leaves sibling publication carriers under their own custody. The target-manifest tuple and all released-package, normal-installation, hosted, promotion, and process-containment claims remain absent); 2026-08-07 (LLP 0189 alignment sweep: verification-cadence/claim-gating clauses re-scoped or annotated to the LLP 0189 D-3/D-6 defaults). 2026-08-07 (v2 derived-fork publication at qualification C `ad0ad58748981010204b61eb5002e35b887a5093`: the recomputed v2 implementation digest, canonical dual-platform receipts, all four contiguous 12-round dual-family `READY` histories, their accepted heads, and Charlie's exact 2026-08-06 author line close the dated receipt/carrier/anchor chain. The guide row publishes only a partial contributor-source local claim for exactly `macos/aarch64` and `linux/x86_64`; the target-manifest tuple stays wholly `Missing`, and released-binary/npm parity, normal installation, public packages, hosted/Cloudflare/remote targets, promotion/merge-back, and process containment remain open or unclaimed); 2026-08-06 (author-directed narrow local publication: LLPs 0163–0165 accepted after three mutually blind dual-family `READY` rounds; Charlie's exact two-platform release set and authorized acceptance fixture close the nine-item witness; `operating.instance-forks` publishes at local/partial through the guide row for contributor source only. The target-manifest tuple, broader agent-safe-storage aggregate, released-binary/npm parity, normal-installation exit, hosted targets, promotion/merge-back, and process containment remain `Missing` or explicit nonclaims); 2026-08-06 (row-13 concurrent-create hang repair: root admission
now uses a 30-second monotonic nonblocking-acquisition deadline with stable
`SNAPBACK_FORK_ADMISSION_TIMEOUT`, while detached server exec marks every
non-stdio inherited descriptor close-on-exec. This closes the macOS concurrent
`Command::output` pipe-creation race in which a sibling create inherited a
capture writer before Rust applied `FD_CLOEXEC`, then passed it to the
five-minute fork server and withheld EOF from the completed CLI.); 2026-08-06
(round-2 derived-fork review closure: registered writer
construction now reconstructs the fork receipt/stream/manifest plus a monotonic
coverage-continuity carrier before issuing authority, protects those carriers
from arbitrary armed DML, and records any observed gap in both the database and
`fork-app-row-coverage-gap.v1.json`, so exact manifest restoration cannot
re-earn the upgraded net-diff class. Armed renewal admits its lifecycle
checkpoint before lineage mutation and compensates ordinary later failures to
the previous consistent carrier cut; recover is proven on the same armed
complete-pair path. Armed journal pruning owns a dedicated registered writer
lane, and net scans preflight borrowed SQLite text/blob/vector lengths plus
decode/serialization expansion before owned row construction. Adds
`SNAPBACK_FORK_WRITER_COVERAGE_GAP` and clarifies the app-root re-pin and
legacy cleanup procedures.); 2026-08-06 (never-launched managed-fork app binding: the public
`publish_managed` / `publish_managed_with_base` library APIs now require the
opaque `ExpectedForkAppV1` established from the invoking canonical app root
and logical app id, revalidate its durable app-root identity at mint, and
publish the registry plus fork-local digest-bound binding before the S4
rename. Runtime readiness only validates and attaches that same binding; it
does not create authority. Library-minted forks can therefore be diffed before
launch from their owning root, while same-`appId` sibling roots and genuinely
legacy/unmanaged evidence still refuse fail-closed.); 2026-08-06 (fork-specific publication witness authorization:
the withheld derived-fork receipt now reserves a closed nine-artifact evidence
chain and the publication checker has the corresponding semantic validator;
the LLP 0061 capability-index row remains the ruled claim carrier, the receipt
is only its dated digest-bound witness, and the LLP 0113 manifest tuple remains
Missing.); 2026-08-06 (derived-fork writer-completeness integration: when
the generated schema/function pair is complete, `fork create` supplies it
through the owner-only fork-local cold-start carrier, then arms the LLP 0165
generated-writer/SQLite-authorizer manifest on registered, defensive writable
connections after schema activation and before listener bind. The digest-bound
fork-point receipt upgrades `snapback.fork-net-diff.v3` to
`registered-connection-defensive-app-rows-v1` only with a verified journal cross-check;
the historical partial dev-manifest post-bind loader remains deliberately
unarmed and therefore `journal-enumerated-v1`. Attribution remains
`absent-v1`; no capability is published.); 2026-08-06 (LLP 0185 Phase 5 live asset-lifecycle evidence:
`live_fork_asset_lifecycle_is_private_gc_safe_and_exactly_reaped` starts a
Sessions parent and derived server, uploads through the production attempt /
TUS PATCH / finalize path, serves copied and fork-uploaded assets through
fresh signed URLs, proves cross-instance delete/GC independence in both
directions, and proves asset-bearing exact drop and deterministic reap remove
the fork-private blob tree without touching the parent. Fork launch now reads
the capability-aware active schema rather than the permanently poisoned
Sessions predecessor slot and supplies a complete generated schema/function
pair through an owner-only fork-local cold-start carrier. Shared or
content-addressed custody remains F2/hosted scope.); 2026-08-06 (**Accepted** by the author after the LLP 0005
loop converged: round-2 independent GPT-family review returned NOT-READY
with eight verified findings — including two code blockers (recover's
staging-reap widening; the missing `assets/` fsync link) — all fixed and
landed, and the round-3 delta re-review returned READY with every finding
independently confirmed resolved and no new findings
(`llp/reviews/0158-instance-forking.codex.md`). Acceptance covers the
same-`appId` derived-deployment identity model and the local F0/F1
contract this document records; it is not a capability publication —
`operating.instance-forks` stays at target `none` until LLP 0185 Phase 6
completes its remaining gates, and
`agent_safe_derived_deployment_fork_v1` remains wholly `Missing` behind its
distinct qualification chain.); 2026-08-05 (post-acceptance review repairs:
the fork-private asset durability chain now fsyncs both `assets/blobs` and its
`assets` parent, the crash-cut matrix includes asset-bearing publication, and
recovery deletes only UUID-suffixed, sentinel-proved staging directories while
preserving same-prefix bystanders. These corrections retain Accepted design
status and publish no capability.); 2026-08-05 (author decisions, LLP 0185
Phase 0 items 2 and 6, ratified by Charlie 2026-08-05: the earlier Draft →
Review transition and LLP 0005 review loop were completed by the 2026-08-06
Accepted transition; and the publication mechanism
governing `operating.instance-forks` is the **LLP 0061 guide
capability-index claim** — the existing index row, currently target `none`,
is the claim surface Phase 6 item 6 will move, gated on Phase 6 item 0's
governing-document checklist; the LLP 0113 `TargetCapabilityId` route and
its LLP 0134 registration obligations are deliberately not taken for the
local claim. LLP 0185 OQ6 row-13 scoping, same ruling: the narrow local
claim is gated on fork lifecycle metrics — cold- and live-parent create
latency by parent size, journal-sequence and net diff latency at the diff-work
bound, drop/reap latency, and concurrent-create contention — not the
broader agent-safe-storage storage-engine submetrics, which stay with the
full profile. Absolute bounds were measured 2026-08-05 and **ratified by
the 0162 author 2026-08-06**; the bench asserts them, and the dated
receipts live under `tests/acceptance/instance-fork-lifecycle-bench.*`.); 2026-08-05 (LLP 0185 Phase 5: implemented OQ5's decided
same-cut fork-private asset custody — durable asset metadata now copies with
a digest- and length-verified private blob-tree copy taken from the staged
metadata cut, in-flight attempts/work-ledger claims scrub, signing keys keep
rotating; torn cuts (missing or digest-mismatched blobs) and unclassified
stores/digest algorithms refuse before publication with
`SNAPBACK_FORK_ASSET_CUT_INCOMPLETE` / `SNAPBACK_FORK_ASSET_CUT_UNSUPPORTED`;
admission byte-accounts the blob tree; `assetCustody` reports
`fork-private-same-cut` / `no-assets`. The live upload/GC proof landed
2026-08-06; shared/content-addressed stores remain F2/hosted scope.); 2026-08-05 (LLP 0185 Phase 4 first slice: opt-in
`--retain-base` retained post-mint base snapshot (digest-bound
`snapback.fork-base.v1` evidence, byte-accounted at admission) and the exact
net base-to-head receipt `snapback.fork-net-diff.v1` via `fork diff --net`
(superseded by v2's explicit writer-coverage and attribution facts on
2026-08-06) —
computed from the base/head oracle independently of the journal, journal
cross-checked within retention (a net change the journal cannot explain
refuses with `SNAPBACK_FORK_DIFF_ORACLE_MISMATCH`), substrate and
completeness named on every receipt per LLP 0164's target-choice delegation
and LLP 0165's enumerated — not authorizer-proven — completeness class.
Filters, pagination, human projection, and LLP 0163 attribution remain the
open Phase 4 tail.); 2026-08-05 (v0.19 — author acceptance after independent
implementation review: the same-`appId` derived-deployment identity decision
and its in-document LLP 0018/0012 amendment are now normative. F0a, F0b, and F1
remain the accepted local design and landed substrate; this status transition
does not publish `agent_safe_derived_deployment_fork_v1`, whose distinct
qualification and publication gates remain unsatisfied and whose public tuple
therefore remains wholly `Missing`.); 2026-08-05 (v0.18 — LLP 0162 implementation-review correction:
OQ9's proposed-normative LLP 0018/0012 amendment now explicitly makes every
independently mutable deployment concern instance-owned — schema and migration
state, function bundle, database/storage, sync/realtime state, auth/provider
state, secrets, admin/diagnostics, and lifecycle operations — rather than
mentioning only client namespaces and commit streams. The shared `appId` is a
generated compatibility identity, never authority to infer or reuse another
instance's state. This documentation correction does not publish the derived-
deployment capability, which remains Missing behind its distinct F0b gate.);
2026-08-05 (LLP 0185 Phase 3 isolation/lifecycle evidence:
bounded intent-journaled `fork renew` with a max-lifetime cap and
`SNAPBACK_FORK_RENEW_EXPIRED`; create-admission and diff-work resource limits
wiring `SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED`; per-fork cleanup locking,
stale-registry completion, and dated concurrent-lifecycle/port evidence;
parent-write-after-fork invisibility fixtures at module and live-server
level; credential/egress matrix extensions and the named-op unclassified
host-op diagnostic.); 2026-08-05 (author rulings: the Phase 3 limit
constants are ratified as shipped; `fork create`'s TTL now shares the same
maximum total lifetime that bounds renewal, refusing with
`SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` resource `fork-lifetime`; and the
Phase 3 item 9 containment answer for v1 is the documented
bring-your-own-OS-boundary guidance — no integrated sandbox/container tier
is built until a real native-code consumer or Phase 8 hosted work names the
requirement.);
2026-08-05 (LLP 0185 Phase 1 operating workflow: made finite TTL
self-enforcing through create-time reap plus boot/periodic server refusal,
wired local-evidence recovery to `fork recover`, added `fork inspect` and
opt-in scalar projections, expanded stable lifecycle diagnostics, and updated
the guide/capability evidence without publishing the capability.);
2026-08-05 (LLP 0185 Phase 0 contract reconciliation: corrected
the current F0b copy, quarantine, manual-worker, TTL, recovery, registry, and
no-promotion claims against `crates/snapback/src/instance_fork.rs` / `crates/snapback/src/cli.rs`; recorded the
landed guide plus single-consumer fork-aware harness as the first F1 slice
without claiming the remaining F1 or any F2 work; froze the v1 automation
artifact inventory and compatibility rules; and pointed the remaining LLP 0162
row-5/row-9 proofs at LLP 0164/0165 ownership. The later author acceptance
supersedes this revision's Draft-only transition note.);
2026-08-05 (LLP 0167 OQ3 boundary note: network-profile
authority now consumes the existing boot-validated local fork lineage as a
derived-instance fact; the Cloudflare arm reserves the deployment binding
`SNAPBACK_DERIVED_INSTANCE_ID` as its fork-id carrier. This does not implement
F2's Cloudflare fork mint/materialization mechanics or relax any LLP 0158
containment gate.); 2026-08-04 (v0.17 — managed in-app branches now apply the same
executable-head custody boundary before canonical publication: inherited
protected-detail ciphertext is scrubbed, a branch-private owner-only sidecar
is minted and boot-checked, and exact drop/reap includes that sidecar. The
immutable comparison base remains non-executable proof material and receives
no parent key. A well-formed swapped sidecar also refuses at database boot;
no capability status changes.)
2026-08-04 (v0.16 — LLP 0163 protected operation-detail custody
is now a closed scrub/rotate class: derived forks discard inherited ciphertext,
mint a distinct owner-only key sidecar, and refuse boot evidence when that
sidecar is absent; no capability status changes.)
2026-08-04 (v0.15 — F1 implementation record: the local-only
partial guide now teaches fork-per-worktree creation, quarantine, bounded diff
receipts, exact disposal, and explicit nonclaims; the shared headless harness
has an opt-in fork-instead-of-seed path that preserves parent rows and loads
the current worktree's manifests; and the maintained Todo acceptance journey
proves parent-state preservation, fork-only diff attribution, and parent-write
isolation. The capability-index row remains target `none` and GAP-gated on
author acceptance/publication; this implementation record does not change
Draft status or advertise the capability.)
2026-08-03 (v0.14 — F0b implementation and first-consumer
record: the finite-TTL local `fork create/list/diff/drop/reap` surface now
packages the green F0a substrate, boots a same-`appId` derived server with
cron/jobs/assets inert and fail-closed egress, emits a ready descriptor and
app-row-only diff receipt with explicit omissions, defaults secrets to scrub,
and permits only explicit config-secret inheritance. Diary 0054 and its dated
acceptance record prove two simultaneous function-divergent Todo worktrees
against one live parent, isolated writes, exact drop, and injected-clock reap.
Graduation criteria 1 and 2 are empirically complete and criterion 3 remains
green; status stays Draft pending the author-controlled transition. F1 guide
and harness ergonomics remain a separately tracked GAP, and no capability is
advertised by this implementation landing.)
2026-08-03 (v0.13 — F0a implementation record: the closed
custody manifest and unknown-schema gate, transactional scrub-and-mint,
fresh admin/auth/resume/protected-operation-detail sidecars, rotated auth/data/signing authority,
S0-S5 local-evidence publication and recovery with minted-sidecar boot
validation and the 20-point intra-state crash-cut matrix, and fail-loud
`DenyAll` marker wiring landed together.
Local F0 chooses asset option (a): an asset-bearing source refuses until
the fork-private tree copy exists; this prevents copied metadata from
silently naming absent blobs. Capture-ledger integration remains deferred
to the shared LLP 0097 prerequisite. The F0a corpus is green; F0b packaging
and fleet dogfood remain open.)
2026-08-03 (v0.12 — author decisions applied after the
converged loop: **OQ9 decided** — same-`appId` derived deployment, with
the proposed-normative LLP 0018/0012 amendment recorded in-doc per the
LLP 0097 pattern, effective on acceptance; **first consumer pinned** —
this repository's agent fleet, fork-per-worktree on demo apps, with
criterion 2 folded into its first real use; **F0a green-lit** with the
deny-all-egress scope cut (capture-ledger integration deferred and
coordinated with LLP 0097's mediation prerequisite); F0a ticket program
opened under `issues/20260803-0158-*`.)
2026-08-03 (loop CONVERGED dual-family READY at v0.11 —
Codex round 6 on frozen bytes: all round-5 majors resolved at RFC
altitude, implementation proof correctly assigned to F0a, residuals
explicitly delegated; combined with Fable READY rounds 2–4. Reviewers'
shared next step: decide OQ9, then begin F0a with the intra-state
crash-cut matrix as controlling scope.)
2026-08-03 (v0.11 — Codex round-5 fixes (round-4 blocker
RESOLVED; four durability-depth majors): S2's durability set completed
(WAL/journal set + every minted sidecar's contents — a lineage stamp
must never outlive a truncated mint artifact); the durable commit
defined as rename **plus** both-parent directory fsync (or same-parent
staging); F0a upgraded from boundary sampling to an intra-state
crash-cut matrix; recovery made **local-evidence-only** — the published
directory is self-evident (lineage stamp + mint receipt + sentinel), the
registry demoted to advisory bookkeeping, and OQ10 correspondingly
narrowed from safety to bookkeeping.)
2026-08-03 (v0.10 — Codex round-4 fixes (NOT READY: the v0.8
protocol never specified how a published fork becomes bootable — sentinel
and stamp both persisted with no transition): the publication protocol
rewritten as an explicit six-state machine (S0 staged-empty … S5 live)
with the quarantine stamp **converted to a permanent lineage stamp
inside the mint transaction** (no separate clear step to crash around),
fsync points named per state, recovery rules resolving every crash
toward the rename's verdict, a post-recovery boot assertion, and all
refusal behavior explicitly framed as F0 work to build. Codex round 4
and Fable round 4 independently converged on the sentinel-clear ordering
and same-filesystem pins — the second convergent cross-family finding of
the loop.)
2026-08-03 (v0.9 — Fable round-4 protocol pins (READY on
the hardened publication protocol via an explicit crash-window walk):
staging same-filesystem for `rename(2)` atomicity; the sentinel travels
with the renamed directory and clears only after the rename as the
reconciliation step — the one fail-closed ordering. Fable's recorded
round-3 lesson: it had verified the v0.6 protocol's constituent facts
but not walked its crash windows; protocol claims need the
step-by-step walk, not fact-checks alone.)
2026-08-03 (v0.8 — Codex round-3 fixes (NOT READY on two
items; four of six round-2 findings resolved): the mint-publication
protocol hardened — refusal authority now precedes the clone (staging
sentinel checked by startup closes the clone-before-stamp bootable
window; the in-DB stamp demoted to defense-in-depth), publication is
two-phase with the directory rename as the single authoritative commit
point (no atomic rename-plus-registry pretense), and the protocol's
scope stated honestly (it governs the verb's products, not hand-made
`cp` copies); the last identity-neutral residue in §Non-goals fixed.
Codex round 3 independently converged with Fable round 3 on the OQ9
version-stream widening, already fixed in v0.7.)
2026-08-03 (v0.7 — Fable round-3 consistency residue fixed
(READY; all v0.6 additions verified sound against source): the OQ9
amendment scope widened to include LLP 0018's one-stream-per-logical-app
clause (the derived-deployment branch contradicts it); graduation
criterion 3 now defers to the F0a corpus in full instead of the stale
v0.4 test list; the fold sentence made identity-neutral; the
resume-keyring citation upgraded from tests to the production path; the
lifecycle-generation bump (`crates/snapback/src/assets_cut.rs` restore-epoch fence)
recorded as a tested alternative/complement to signing-key rotation.)
2026-08-03 (v0.6 — Codex round-2 fixes (NOT READY, 1
blocker + 4 majors, all fix-quality): crash-safe mint **publication
protocol** added — clone quarantine-stamped before anything else,
DB-side scrub transactional, sidecars minted into the fork's own
directory (the resume keyring is *directory*-scoped, so same-directory
forks would share the parent's), atomic publication, and `snapback
start` refuses quarantine-stamped databases; custody-manifest authority
changed from `app.reset` precedent (provably incomplete — omits
durable-jobs tables; a fix-introduced error this loop caught) to a
mechanically enforced schema sweep; S3/provider asset I/O added to the
quarantine matrix (request-path HTTP under `SNAPBACK_ASSET_S3_*` env
credentials, untouched by worker switches); asset option (b) gains
same-cut consistency and signing-key rotation obligations (signed-URL
MACs bind no instance identity — parent-signed URLs are an F0a negative
test); pre-OQ9 "new logical app" language made identity-neutral;
Summary and diff-fallback copy claims scoped (live path unmeasured;
retained base is an explicit extra copy).) 2026-08-03 (v0.5 — round-2 editorial residue fixed per the
Fable round-2 review (READY, four minors, all consistency residue):
Summary's copy claim scoped cold-vs-live; §Lifecycle's asset-GC coupling
conditioned on the §Asset plane custody option; the
numbering-continuation-is-not-cursor-validity split stated in the
version-stream bullet and 0097 matrix row; the maintenance
receipt-polling quarantine row marked mechanism-NET-NEW (no existing
switch); non-credential operational residue added to the custody
manifest with `app.reset`'s deletion list as the checklist.)
2026-08-03 (v0.4 — round-1 cross-family review fixes applied:
Fable and Codex both NOT READY, convergent on four defects, artifacts in
`llp/reviews/0158-instance-forking.{claude,codex}.md`. Corrections: the
identity mint is now a transactional **scrub-and-mint** (incarnation
rotation alone provably does not invalidate copied sessions/agent
credentials — they resolve by unkeyed token-hash lookup against cloned
rows; resume tokens never consult the auth incarnation at all) with a
custody manifest over every DB-resident credential and sidecar; the
"one host seam" egress claim replaced by the enumerated op families
(`host.fetch`, `push.send`, `action.streamOpen/Read/Cancel`,
`jobs.enqueue` deferral, maintenance receipt-polling) — OQ2 reopened,
capture wiring re-priced as net-new (LLP 0097's ledger is landed but
unwired, per `crates/snapback/src/server.rs`'s own annotation, and its keying needs
adaptation); the asset plane rewritten against the real layout (sibling
`assets/` directory, opaque UUIDv7 physical keys — LLP 0044's digest is
metadata, not the physical key; asset-bearing forks need a custody
decision in F0, plus the third worker switch
`SNAPBACK_ASSET_RUNNER_DISABLED`); an explicit §Threat model added
(DataIsolated / HostEgressMediated / ProcessContained — rogue-agent
*process* containment requires OS isolation, out of local F0); the
live-parent copy respecified over the SQLite backup primitive
`MaterializedBase` already implements; identity-model question (same
appId derived deployment vs new appId) opened as OQ9 with the 0018/0012
amendment consequence; diff-receipt claims scoped to app-row changes;
"days, not weeks" withdrawn pending the bypass corpus. Earlier Revised
entries below record claims this revision corrects — they are history,
not current statements.) Prior entries: 2026-08-03 (local-only spike executed same day; §Spike evidence
added. One draft claim corrected against evidence: fresh fork identity does
**not** fall out of the file copy — a raw clone shares the parent's `appId`
and auth-stream incarnation, so the fork operation must actively mint new
identity. OQ1's version-stream question partially answered: continuation
from the fork point is native substrate behavior.) Same day, third
revision: author demand statement recorded (agent-parallel development,
rogue-agent containment, production-shaped test data) and author directed
exploration of the implementation path; §Implementation path added from a
verified seam inventory — cron/jobs pause switches and 0097's capture
ledger exist, secrets and admin tokens are sibling-file-external so
non-inheritance is free, identity mint = incarnation rotation keeping the
manifest-bound `appId`; F0/F1/F2 phasing sketched. Exploration is not an
implementation commitment; Status remains Draft/experimental. Same day,
second revision: reconciled against **LLP 0097**, which the initial draft
failed to cite — 0097's ephemeral in-app branches are Accepted *and implemented*
(registry/lifecycle through COW overlay, capture-don't-fire effect ledger,
staged promotion), and they already serve several use cases this draft
claimed. §Relationship to LLP 0097 added; use cases narrowed to the
residual set; the effect-quarantine design now reuses 0097's contract
instead of inventing one; OQ2 resolved by inspection (all handler egress
crosses the action-only `ctx.fetch` → `host.fetch` host seam, LLP 0049);
explicit graduation criteria added to §Status.
**Related:** LLP 0007, LLP 0008, LLP 0018, LLP 0024, LLP 0027, LLP 0028,
LLP 0030, LLP 0036, LLP 0037, LLP 0044, LLP 0049, LLP 0070, LLP 0081,
LLP 0083, LLP 0088, LLP 0097 (ephemeral data branches — the implemented
in-app sibling this RFC must position against), LLP 0099, LLP 0139, LLP 0146,
LLP 0162, LLP 0163, LLP 0164, LLP 0165, LLP 0185

> **Accepted but unpublished.** The local F0a/F0b/F1 design, including the
> same-`appId` derived-deployment amendment below, was Accepted on 2026-08-06
> after a converged LLP 0005 loop. The local program through LLP 0185 Phase 5
> is implemented in source. Acceptance records the contract and landed
> substrate; it commits no schedule or priority and is not a capability
> advertisement. `operating.instance-forks` stays at target `none`, and
> `agent_safe_derived_deployment_fork_v1` remains wholly `Missing`, until
> their distinct LLP 0185 qualification and publication gates pass.

## Summary

Snapback's source-local F0b now supports **forking a logical app** — producing
a same-`appId`, non-promotable derived deployment whose data starts as a
consistent snapshot of an existing one. The managed product path currently
materializes both cold and live parents through SQLite's backup API; the
earlier APFS `clonefile` result remains spike evidence, not the implementation
used by `snapback fork create`. This RFC argues the capability is distinct from, and far
cheaper than, the record-level branching that
[LLP 0088](./0088-record-history-and-branching.rfc.md) deferred: a fork is a
whole-instance operation that lands exactly on the logical-app boundary
[LLP 0018](./0018-app-instance-boundaries.rfc.md) already defines, so none of
the sync-core invariants (single per-app gap-free version stream, LLP 0007
DK-2) acquire a branch dimension. Current F0b deliberately pays for a full
SQLite-backup materialization for both cold and live sources; the historical
CoW spike is not a product latency claim. The differentiated design work is
still the **runtime plane**:
what a fork does about scheduled work, outbound side effects, secrets,
sessions, and the asset store. Because Snapback owns the runtime as well as
the data, a Snapback fork can be a whole-*backend* fork, which is both the
hard part and the reason it would be more valuable than what
database-only vendors ship.

The implemented local posture is **throwaway-first**.
Forks are quarantined, disposable rehearsal environments with a
machine-readable "what changed" diff surface — not long-lived branches and
not merge targets. Merge stays app-level per LLP 0088 §4.

## Motivation

### The demand pattern

The strongest 2026 demand signal for database forking is not "git for
data" — it is **agents**. Every serious fork/branch vendor repositioned
around agent workflows: agents create environments at a rate humans never
did, and they need a place to try destructive operations where being wrong
is free. Snapback's thesis is agent-first (LLP 0000, LLP 0010, LLP 0024),
which makes this the rare capability where the market's current story and
this project's founding story are the same story.

**The author's articulated ask (2026-08-03, recorded verbatim in
substance):** if it worked well, a lot of people — especially agents —
would use forking. Ten agents should be able to work on your product at
the same time without stepping on each other; a rogue agent should not
be able to destroy the database; and it is a huge deal for test data to
be very, very close to production data. This is the strongest demand
statement in the document, and it lands squarely in the residual set
(§Relationship to LLP 0097): **agents developing a product change schema
and functions**, which a 0097 branch cannot diverge; and per-agent
isolation wants separate processes. One precision the reviews forced:
the fork addresses the *accidental-and-through-the-runtime* half of the
rogue-agent worry (no parent credentials, disposable data, denied
effects); containing a rogue agent *process* additionally requires OS or
container isolation (§Threat model). It is also the git-worktree
analogy made literal — agent fleets already fork the *code* per worktree
(this repository's own development runs that way); the fork gives each
worktree a matching backend.

Concrete workflows a fork would serve, in rough order of conviction:

0. **Agent-parallel product development** (the primary case, per the
   ask above). Each agent gets `fork → own port, own database, own
   admin token, no secrets, paused scheduled work, denied egress`,
   loads its own modified schema/functions into *its* fork, and tests
   against production-shaped data. What the fork contains: everything
   the agent does *through its fork's runtime* — destructive writes,
   bad migrations, handler bugs — lands in a disposable clone, and the
   agent never needs parent credentials. What the fork does **not**
   contain: the agent's own process (§Threat model) — a truly rogue
   same-host process can bypass Snapback entirely. The diff receipt
   shows what the agent's app-data changes were (scoped precisely in
   §Diff surface).

1. **Migration and mutation rehearsal at workflow granularity.**
   [LLP 0081](./0081-reviewed-storage-evolution-and-migrations.rfc.md)
   already ships restore-derived rehearsal for reviewed migrations
   (`snapback migrate rehearse` → receipt → `apply --rehearsal-receipt`),
   and [LLP 0146](./0146-agentic-authoring-affordances.rfc.md) ships
   single-mutation dry-run through the real buffered path. A fork
   generalizes both: an agent forks, runs an arbitrary multi-step change
   — a migration plus backfill plus the new handler exercising it —
   inspects the result, and throws the fork away. Rehearsal today answers
   "does this one migration admit"; a fork answers "does this whole plan
   land."
2. **Acceptance and demo runs against production-shaped data.** Today's
   suites seed from scratch. Fork-instead-of-seed gets realistic
   cardinalities, realistic nulls, and realistic weirdness for free.
3. **Preview environments.** Branch-per-PR with real data shapes, the
   flagship Neon use case. LLP 0018 already names "isolated production,
   staging, and preview apps under one account" as a case its vocabulary
   must serve; a fork is the cheapest way to mint the preview member of
   that set.
4. **Operator undo / "snap back."** A pre-operation fork lets the operator
   rehearse the risky operation and inspect the diff before running it for
   real — but a derived fork is **never promoted**: `promotable: false` is
   stamped at mint and rejected at boot. Actual undo remains backup/restore
   (LLP 0007's byte-level snapshot). This is the weakest independent
   justification, kept only as a rehearsal story.

### The competitive read

Convex — the parity reference for the LLP 0116–0127 program — has preview
deployments that start *empty* (plus an optional seed function) and
snapshot import/export; it has no copy-on-write data fork of a running
deployment *(author knowledge as of 2026-08; not established by the
LLP 0116–0126 research batch, which did not examine this axis — verify
before citing competitively)*. Instance forking would therefore be
differentiation, not parity work. §Prior art surveys who does ship it.

### Relationship to LLP 0097 — the implemented in-app sibling

The initial draft of this RFC positioned itself only against LLP 0088's
deferral and missed that the deferral had already been answered:
[LLP 0097](./0097-ephemeral-data-branches-and-effect-isolation.rfc.md)
(Accepted 2026-07-25 after a five-round loop) *is* 0088's named revisit
trigger, normatively amended LLP 0007/0018 (one canonical commit-version
stream plus typed ephemeral child streams), and has its **substrate
implemented but product-unwired**: branch registry/lifecycle, materialized
branch base, COW overlay, and the capture-don't-fire effect ledger landed in
`crates/snapback/src/branches.rs`; strict `DenyAll` replay promotion now lives in
`crates/snapback/src/fork_promotion.rs`, while `CaptureOnly` product mediation remains unbuilt.
No server, CLI, or client path consumes the in-app branch surface yet
(`crates/snapback/src/server.rs` annotates its diagnostic code "Not yet wired into any
request path"), and 0097's own claim boundary keeps the capability
`Missing` until its acceptance corpus passes. The distinction the round-1
reviews forced: **accepted design** and **landed substrate** are both
real, but neither is a **product-wired capability** — which matters for
both what 0097 serves today (nothing yet) and what this RFC can claim to
reuse (designs and library primitives, not working mediation).

The two capabilities are different points on one isolation axis:

| | LLP 0097 branch (substrate landed, unwired) | LLP 0158 fork (this RFC) |
| --- | --- | --- |
| Boundary | Ephemeral child *inside* one logical app's trust boundary | A same-`appId` derived deployment with its own fork/stream/sidecar identity and an independent ownership/mutation boundary (accepted OQ9 amendment to LLP 0018/0012) |
| Schema / function bundle | **Shared with parent** — a branch cannot diverge them | Fully divergent — fork can run a different app version |
| Version stream | Typed child stream, never numerically comparable to canonical (0097's 0007/0018 amendment) | The fork's own canonical stream: same numbering space continuing from the fork point, **new stream identity** minted so cursors cannot cross (§Design sketch; §Spike evidence 5) |
| External effects | `DenyAll` marker substrate and strict promotion are landed; `CaptureOnly` mediation remains unbuilt | No promotion — F0b denies and durably marks every classified attempt; `CaptureOnly` remains deferred (§Runtime plane) |
| Merge-back | Staged promotion by re-execution, one canonical transaction | **None** (non-goal) |
| Placement | Lives inside the parent server process | Independent local process in F0b; cross-host/hosted placement remains F2 |
| Cost per instance | Overlay + child stream — cheap, many-at-once (N live futures) | One SQLite-backup materialization + a boot in current F0b; CoW copy remains an unproductized optimization; hosted is heavier |
| Trust posture | Cooperating-not-adversarial (0018) | Separate instance and minted authority; same-user local process containment is explicitly absent |

Consequences for this RFC:

- **Use cases 0097's accepted design owns are struck from this RFC's
  motivation.** Live side-by-side futures, agent sandboxes for
  cooperating code over real-shaped data, safe tests without schema
  changes, and promotable drafts are 0097's by design ownership —
  though nothing serves them *today*, since the substrate is unwired.
  The **residual set** that only a whole-instance fork serves:
  (1) **schema/function-divergent rehearsal** — "run the migrated app
  against real data" — because a 0097 branch shares the parent's schema
  and bundle by design; (2) **environments that outlive or leave the
  parent process** — preview/staging on another host, clone-to-local;
  (3) **stronger-than-cooperating isolation** — handing a copy across a
  trust boundary; (4) **operator checkpoint/undo** at the whole-app
  grain. Motivation items 1–4 above should be read through this filter:
  the fork case for each is the schema-divergent or cross-host variant.
- **The F0 quarantine implements the narrow `DenyAll` slice; the richer
  0097 contract remains shared follow-on work.** F0a/F0b classify current
  host-operation and autonomous egress families, refuse before initiation,
  and record bounded payload-free markers. They do not use 0097's
  `CaptureOnly` effect ledger. Wiring live egress into that ledger, adapting
  its child-stream keying for an out-of-process fork, and defining simulated
  results remain the shared prerequisite for either class to claim
  `CaptureOnly`.
- **The version-stream stories are compatible, not competing.** 0097's
  amendment governs child streams *within an instance*. A fork is a
  same-`appId` separate instance owning an ordinary canonical stream;
  continuation from the fork point (observed native in §Spike evidence)
  violates nothing in either amendment. Versions and cursors remain opaque
  and non-comparable across the two instance identities.
- **The accepted result is a standalone derived-deployment design, not a
  fold into 0097.** The RFC considered a fold while the residual demand was
  uncertain. The completed first-consumer criterion established the distinct
  schema/function-divergent and out-of-process workflow. The two designs still
  share a snapshot/materialization engine: 0097's `MaterializedBase` is the
  storage half, while 0158 owns instance-identity scrub/mint and quarantine.

### Why this is still not LLP 0088 reopened

LLP 0088 §3's deferral of *record-level* branching was answered by
LLP 0097 for the in-app case under 0088's own revisit trigger. This RFC
introduces no branch identity inside any data model. Its accepted OQ9
amendment narrows the necessary 0018/0012 contract change: the fork is a
same-`appId` **derived deployment** with a separate instance identity — its
own schema and function custody, canonical stream, storage, auth/provider
state, secrets, diagnostics, and lifecycle authority after scrub-and-mint.
Parent and fork share history
before the fork point and nothing after. LLP 0088's remaining postures (no
semantic merge in the sync core; independent retention clocks) are
inherited here unchanged.

## Non-goals

- **Record-level branching and per-type merge.** Deferred and declined
  respectively by LLP 0088; unchanged here.
- **Merge-back as core machinery.** LLP 0088 §4 ratified merge as
  app-level code over ordinary reads and writes, if ever. A fork in this
  RFC is a *source of information* (diffs, receipts, confidence), not a
  merge source. Dolt demonstrates that merge is a whole company, not a
  feature.
- **Provider PITR as application API.** LLP 0083's ruling stands: DO
  point-in-time bookmarks are an ops-level recovery property preserved on
  the wire, not product surface. §Mechanics uses provider capabilities as
  *accelerators behind* a portable fork contract, never as the contract.
- **Long-lived divergent forks as a paved path.** Every managed fork's
  total lifetime is bounded — creation and renewal share one configured
  maximum (`MANAGED_FORK_MAX_LIFETIME_MS`, 7d, author-ratified 2026-08-05)
  and renewal never clears an expiry — so an indefinite fork is not merely
  unsmoothed, it is refused. A permanent copied environment is a separate
  provisioning product.

## Design sketch

### The fork operation

`fork(parent_app, options) → same-app derived deployment` with a fresh
instance identity and independent ownership/mutation boundary, with at minimum:

- **A consistent snapshot boundary.** The fork captures the parent at a
  single committed version — the same consistency class as LLP 0007's
  byte-level snapshot for backup/restore. The parent's commit version at
  the snapshot becomes the fork's recorded **fork point**. Current F0b stamps
  lineage in the fork and writes an advisory entry in the selected fork-root
  registry; it does **not** mutate the parent database with a reverse pointer.
  The current `parentInstanceId` carrier is source-shaped rather than one
  uniform durable identifier: a live ready-file source records its
  per-process `startupId`, while a cold database records its data-stream
  identity (falling back to its canonical path only for older state without
  that identity). Automation must therefore treat the field as recorded source
  provenance, not a cross-restart parent primary key.
- **A transactional scrub-and-mint — not a rotation.** The spike showed
  identity is inherited through the clone; the round-1 reviews showed
  the initially proposed fix (rotate the auth-stream incarnation) is
  **insufficient**: sessions and agent credentials resolve by unkeyed
  token-hash lookup against rows *inside the cloned database*
  (`crates/snapback/src/auth/crypto.rs` `hash_bearer`; `crates/snapback/src/auth/session_projection.rs`),
  a rebooting fork re-projects those rows under the new incarnation and
  admits parent tokens; resume tokens never consult the auth incarnation
  at all (they bind `appId`, manifest generation, data-stream identity,
  and a separate resume keyring, LLP 0091). The codebase's own precedent
  is `app.reset`, which rotates the incarnation *in the same transaction
  that deletes auth state*. The fork mint is therefore one transactional
  operation over a **custody manifest** — every DB-resident credential
  class and every sidecar family the fork consumes gets an explicit rule
  (`copy`, `scrub`, `rotate`, `share`, or `refuse`): terminate/delete copied sessions and token families, revoke
  copied agent credentials/grants/verification codes, rotate the auth
  incarnation *and* the data-stream identity (so copied search/resume
  cursors cannot cross instances), give the fork a fresh resume keyring
  and admin token (the keyring and token sidecars are not cloned — that
  non-inheritance is load-bearing, not incidental). LLP 0163's encrypted
  `_snapback_operation_protected_detail_v1` ciphertext is scrubbed with its
  parent-stream envelopes and the fork mints a fresh owner-only
  `*.operation-detail-keyring.json`; neither parent ciphertext nor its key
  crosses the publication boundary. Managed in-app branches enforce the same
  boundary on their executable writable head before canonical custody moves
  from `creating` to `active`; their byte-stable immutable comparison base is
  non-executable and receives no key. Branch drop/reap owns the private
  sidecar in its exact file inventory. The mint then stamps the fork
  id + fork point. User *records* (`_auth_identities`) stay, as data to
  test against. Beyond credentials, the custody manifest also sweeps
  **non-credential operational residue** the clone carries — search
  journal leases and generations, claimed job rows, stream attempts,
  cron claim state — each getting a carry/reset/inert decision. The
  F0b mechanically sweeps every `_snapback_*` and `_auth_*` table and fails
  when a new system table lacks custody classification. The sidecar boundary
  is enforced differently: the copy path inherits **no** parent sidecar except
  the explicitly opted-in config file, mints the three authority sidecars into
  empty staging, scrubs ready/lock/telemetry companions by non-copy, and records
  the known sidecar-family dispositions in the receipt. `SIDECAR_CUSTODY` is a
  static closed inventory, not a filesystem discovery mechanism; a future
  sidecar must be added deliberately before fork code may copy or consume it.
  (`app.reset`'s deletion sequence is a useful precedent but provably
  incomplete — it omits the durable-jobs tables — so it cannot be the
  authority; round-2 review caught this document briefly claiming
  otherwise.) The F0a negative corpus now presents parent session, agent,
  resume/search, and admin authority to the minted fork and proves refusal.
  The logical `appId` is kept in v1 (manifest-bound); the minted fork is the
  accepted OQ9 same-app **derived deployment**, with fresh instance identity
  and independent custody.
- **Crash-safe mint publication — a fork is never bootable unminted.**
  The scrub-and-mint cannot be "the clone, then some fixes": between
  clone and scrub, the copy is a bootable database that accepts copied
  credentials, and a crash in that window leaves it lying around
  permanently dangerous. And sidecar placement compounds it: the resume
  keyring is **directory-scoped** — the production path is
  `database_path.with_file_name("resume-keyring.json")`
  (`crates/snapback/src/local.rs`; `RESUME_KEYRING_FILE_NAME`, `crates/snapback/src/rqs.rs`), one
  keyring per directory — so a fork cloned into the parent's directory
  would *share the parent's live resume keyring*.
  The publication protocol is an explicit **state machine** (rounds 3–4
  of review each caught an ordering hole in looser prose versions —
  first a clone-before-stamp bootable window, then an unspecified
  transition to bootability. The states and transitions below are now the
  implemented F0a publication protocol; `snapback start` calls the local
  evidence inspection and refuses sentinel-bearing, quarantined, incomplete,
  or mismatched fork evidence before serving:

  - **S0 staged-empty.** The verb creates a staging directory *on the
    same filesystem as its destination* (`rename(2)` atomicity requires
    it) and writes a **staging sentinel** into it, fsyncing the sentinel
    and the parent directory, *before any clone byte lands*. Startup
    refuses to serve any database whose directory carries the sentinel
    — the refusal authority predates the data.
  - **S1 staged-cloned.** The clone lands in staging. Bootable as
    bytes; refused by the sentinel.
  - **S2 staged-minted.** The scrub-and-mint commits as one DB
    transaction whose final act **converts the quarantine stamp into
    the fork's permanent lineage stamp** (parent id, fork point, mint
    receipt) — there is no separate "clear the stamp" step to forget or
    crash around; startup refuses *quarantine*, accepts *lineage*.
    Fresh sidecars mint into the staging directory (never the
    parent's). The S2 durability set is complete, not gestural: the
    database's full SQLite WAL/journal durability set, **each minted
    sidecar's file contents**, and the staging directory — a durable
    lineage stamp must never outlive a missing or truncated mint
    artifact.
  - **S3 publish-intent.** A registry *intent* row commits.
  - **S4 published-unreconciled.** The directory renames out of staging
    — the **single authoritative commit point** (nothing pretends the
    registry row and the rename are jointly atomic). The *durable*
    commit is rename **plus directory fsync**: both source and
    destination parent directories, or staging pinned inside the same
    parent so one fsync covers both. The sentinel *travels with the
    directory*, so the fork still refuses to boot.
  - **S5 live.** Reconciliation attempts to finalize the advisory registry,
    then removes the sentinel and fsyncs the published directory. Registry
    failure does not keep locally complete evidence quarantined: the row may
    remain `intent` (or require later best-effort reconstruction), while boot
    safety still follows the clear-after-rename local ordering.

  **Recovery resolves every crash toward the rename's verdict, from
  local evidence alone:** the published directory is self-evident — it
  carries the lineage stamp, the mint receipt, and the sentinel — so
  repair completes or reaps **without consulting the registry**:
  staging present in S0–S3 → reap (staging is disposable; an intent row
  without a published directory means not-committed); published
  directory still sentinel-bearing (S4) → verify the lineage stamp,
  attempt to reconcile the registry, remove the sentinel. A live directory
  may retain an `intent` or missing advisory row after registry failure; the
  library has no autonomous "when next available" repair loop. The tested
  `recover(parent, destination)` primitive performs the best-effort local-
  evidence reconciliation. LLP 0185 Phase 1 wires it to `snapback fork
  recover <destination>`; the product command accepts only an exact
  direct-child destination and refuses to recover unbounded lineage. The
  registry row is **advisory bookkeeping** (listing,
  TTL scheduling) — boot safety and repair never depend on registry
  availability, which scopes OQ10's custody question to bookkeeping,
  not safety. **Post-recovery boot assertion:** a fork serves iff no
  sentinel is present *and* the lineage stamp is present *and* no
  quarantine stamp is — anything else refuses. Scope honesty: this
  governs what the *fork verb* produces; an operator who hand-copies a
  database with `cp` has made an unmanaged copy no verb-side protocol
  can stamp. F0a's corpus is an **intra-state crash-cut matrix**, not
  boundary sampling: cuts around each sidecar write, each DB/WAL flush,
  the rename vs its directory fsyncs, registry finalization, and the
  sentinel unlink — with the post-recovery boot assertion after every
  cut.
- **A version-stream decision.** The implemented fork stream **continues the
  parent's numbering from the fork point** rather than restart at zero:
  it keeps `_version` values in copied rows meaningful, keeps the
  journal's retained window usable for post-fork diffs, and costs
  nothing mechanically (the counter is in the file). One OQ9 consequence
  the round-3 review surfaced is now normative: parent and fork are two
  instances of one logical app with independent streams, so the amendment
  widens LLP 0018's one-stream-per-app clause to per-instance, not just the
  identifier scoping. Restart-from-zero would
  require rewriting `_version` on every copied row or breaking the
  monotonic-stream contract. The spike confirmed continuation is what
  the substrate does natively — the version counter lives inside the
  database (`_snapback_version`), so a cloned file continues from the
  fork point without any code (§Spike evidence). One split to state
  precisely: numbering continuation is **not** cursor validity — the
  scrub-and-mint rotates the *data-stream identity* (resume tokens MAC
  the stream identity, `crates/snapback/src/rqs.rs`; `rotate_data_version_stream_in`
  exists in `crates/snapback/src/storage/auth_invalidation.rs`), so parent resume and
  search cursors die at the fork even though the numbers keep counting
  in the same space. The sharpened corollary:
  parent and fork advance through the **same numbering space**
  independently (both minted a version 5322 with different contents in
  the spike), so version numbers alone never identify provenance —
  fork-point stamping is mandatory, and any diff is keyed by the fork
  point, never by version equality across instances.
- **A quarantine posture** (§Runtime plane) chosen at fork time, with the
  quarantined defaults below.

### The copy, per target

The portable contract is **fork = consistent snapshot materialized as a
same-`appId` derived deployment with independent instance ownership**, with per-target
implementation quality — the same
capability-contract pattern LLP 0007 uses for snapshot/restore. Speed is a
quality-of-implementation property; correctness (consistent boundary,
independent streams) is the contract.

- **Local SQLite (the shipped default).** Current F0b uses one path for both
  cold database inputs and live ready-file inputs: `rusqlite::backup::Backup`
  materializes a transactionally consistent destination in private staging,
  then the scrub-and-mint and S0–S5 publication protocol run. This is a full
  logical copy, not the O(1) `clonefile`/reflink path the earliest spike
  measured, and the product code does not acquire the cold parent's instance
  lock or use `VACUUM INTO`. A future CoW fast path must independently prove
  lock/write-gate custody, WAL handling, partial-destination cleanup, and every
  crash boundary before it can replace the common backup path. No diff
  machinery is needed to *create* a fork; diffs earn their keep elsewhere
  (§Diff surface).
- **Cloudflare DO.** No file to clone. Candidate accelerator: instantiate
  a new coordinator DO from a PITR bookmark (LLP 0083) — whole-database
  and fixed-window, which is exactly the granularity a whole-instance
  fork wants, unlike the record-granularity mismatch LLP 0088 noted.
  Fallback: streamed snapshot export/import through the existing
  backup path. Either way the *contract* stays provider-neutral.
- **Container-VM / Fly (LLP 0099 lane).** Volume forks are a first-class
  Fly primitive; Tigris-side asset objects follow the §Asset plane
  custody decision (opaque physical keys mean sharing is a policy over
  the store seam, not automatic). The hosted executor profile is also
  where fork-based migration rehearsal would naturally run — and where
  the *process-containment* tier of the threat model (§Threat model)
  becomes available.
- **Postgres graduation (future).** Where the platform is Neon-class,
  fork maps to a storage-level branch (fast); on vanilla Postgres it maps
  to snapshot-and-restore (slow but correct). This is the strongest
  argument for keeping the contract semantic rather than operational:
  "you get a consistent independent copy," not "you get it in 50ms."

### The runtime plane — where the real design is

A database fork that boots the app runtime is a loaded gun: handlers send
email, call external APIs, and charge credit cards. The value of a
Snapback fork over a bare database fork is that Snapback owns enough of
the runtime to make the fork **safe by default**. The governing rule the
round-1 reviews forced: the quarantine is an **exhaustive matrix over a
closed set of egress and effect classes, failing closed** — any outbound
initiation point or custody class not explicitly classified refuses in a
fork (the `EffectClass::classify` posture in `crates/snapback/src/branches.rs` is the
pattern), and new outbound adapters must declare fork behavior to land.
Implemented defaults (2026-08-05 correction: on a derived fork these
gates are **unconditional** — there is no per-row override switch — and the
child process inherits the parent environment except `SNAPBACK_ADMIN_TOKEN`,
which fork launch removes; ambient provider env is neutralized by the
denial gates below, not by env scrubbing):

| Concern | Default in a fork | Rationale / mechanism |
| --- | --- | --- |
| Cron (LLP 0028) | Copied but **paused** — autonomous claiming off (`SNAPBACK_CRON_DISABLED`); manual tick also refuses with a durable `cron_tick` marker | Never double-execute the parent's schedule, including through an admin override. |
| Durable background work (LLP 0070) | Copied but **paused** (`SNAPBACK_JOBS_DISABLED`); enqueue and forced drain refuse with durable `jobs_enqueue` / `jobs_drain` markers | Pending `runAfter` work remains visible but inert; no admin bypass silently executes it. |
| Asset maintenance worker | **Off** (`SNAPBACK_ASSET_RUNNER_DISABLED`) — the third autonomous worker, easy to miss | An asset-bearing fork must not run ledger work or GC sweeps against a store it may share or lack (§Asset plane). |
| Maintenance egress (push-receipt polling) | **Denied and durably marked** as `push_receipt` before provider polling | The general maintenance loop still runs for local housekeeping, so this explicit guard — not a worker-disable assumption — closes its autonomous network lane. |
| Handler egress — buffered `ctx.fetch` (`host.fetch`), `push.send`, `action.streamOpen/Read/Cancel` (`ctx.fetchStream`), and effects deferred via `jobs.enqueue` | **Denied, never fired, and durably marked** by closed family; an unknown future host operation maps to `unclassified_host_operation` and refuses | This is `DenyAll`, not `CaptureOnly`: markers contain family/count/timestamps only, never request payloads or simulated results. LLP 0097 ledger integration remains open. |
| Asset-provider I/O (`SNAPBACK_ASSET_STORE=s3`) | **Refused unconditionally in a fork** — the provider-adapter selection point (`asset_store_obj`) denies with family `asset_provider` before any store is constructed, so inherited `SNAPBACK_ASSET_S3_*` env can never be exercised; even the experimental S3 acknowledgment switch is evaluated only after that denial | Provider asset I/O is egress the worker-pause rows do not touch; the guard is the deny gate at the selection point, not env scrubbing — the env vars remain present but unusable (behaviorally proven in `manual_cron_and_asset_provider_paths_deny_on_a_fork`). |
| Webhook / callback ingress | Fork endpoints **receive nothing by default** — no parent-registered callback routes to a fork; ingress-triggered handlers follow the egress rules above if invoked deliberately | Ingress is a separate class from egress and needs its own deny-by-default statement. |
| Secrets (LLP 0036 config values) | **Not copied — free by construction**: values live in a 0600 sibling `*.config.json`, never inside the database; copying is the explicit `--with-secrets` opt-in | LLP 0036's file placement makes the safe default zero-cost. The *broader* credential custody (DB-resident validators, push device tokens, asset signing material, keyring sidecars, `SNAPBACK_ADMIN_TOKEN` env inheritance) is governed by the custody manifest (§Design sketch), not by this row. |
| Auth sessions / tokens / agent credentials | **Terminated by the scrub-and-mint** (§Design sketch) — not by incarnation rotation alone; user *records* are copied as data | The F0a negative corpus presents parent session, agent, resume, search, and admin authority and proves refusal in the minted fork. |
| Telemetry / export surfaces | Local telemetry remains local; export attempts refuse and record `telemetry_export` | Telemetry export is a data-export path and is guarded explicitly rather than inferred from target placement. |
| Admin access | Forker gets a **fresh minted** admin token on the fork (never the parent's, and never an inherited `SNAPBACK_ADMIN_TOKEN` env) | The fork is their sandbox; admin on the fork grants nothing on the parent. |
| Live clients | None; the fork starts with zero subscribers; rotated data-stream identity keeps copied resume/search cursors from crossing | Clients must connect explicitly and distinguish instances by endpoint + stream identity, not `appId` (OQ9). |

This matrix is the substance of the capability. Neon, Turso, and
postgres.ai stop at the database because they *have to*; their users
rebuild the side-effect quarantine by hand per app. Snapback shipping the
`DenyAll` quarantine as the default is the differentiated F0 work. The richer
`CaptureOnly` seam remains the one LLP 0097 names as its unbuilt prerequisite.

### Threat model — what a fork does and does not contain

The round-1 reviews converged on this needing to be explicit. Three
capability tiers, none implying the next:

1. **DataIsolated** (local F0 delivers this): the fork's writes,
   migrations, and resets land in a disposable copy; the agent holds no
   parent credentials; parent data is untouched *by anything routed
   through the fork*. This is protection against **accidents and bugs**,
   and it is what the cooperating-not-adversarial posture of LLP 0018 /
   LLP 0097 already assumes.
2. **HostEgressMediated** (local F0 delivers the `DenyAll` form): handler,
   manual-drain, provider, maintenance, and telemetry egress from the fork's
   runtime is refused with bounded payload-free evidence, so rehearsals cannot
   fire real external effects. `CaptureOnly` remains a strictly richer,
   unbuilt tier.
3. **ProcessContained** (explicitly **out of scope for local F0**): a
   truly rogue agent *process* on the same host as the same UNIX user
   can ignore the fork entirely — open the parent's SQLite file, read
   the parent's 0600 sidecars (same owner), call the parent's endpoint,
   or make its own network connections. Containing that requires an OS
   boundary: separate user, container, or VM with the parent's files and
   endpoint unreachable and network policy enforced — LLP 0009's
   territory and the hosted F2 lane's opportunity, not a property a
   same-user local fork can offer.

The honest local-F0 claim for the author's rogue-agent ask is therefore:
the fork makes the *safe path the default path* (an agent given only a
fork's endpoint and token can harm nothing else through Snapback), and
removes the reason agents are ever handed parent credentials — it does
not sandbox a malicious process. Fork-per-agent composes with, rather
than replaces, OS-level agent sandboxing.

### The asset plane

The initial draft claimed blob sharing was "nearly free by construction"
via content addressing. The round-1 reviews falsified that at the
physical layer: [LLP 0044](./0044-asset-storage-pipeline.rfc.md)'s
verified content digest is **metadata** — physical keys are deliberately
opaque UUIDv7, "never derived from app data, filenames, or digests"
(`crates/snapback/src/assets.rs`), and the local blob store is rooted in an `assets/`
directory **beside the database** (`crates/snapback/src/local.rs`). Consequences for a
fork, by placement:

- **Different directory** (the natural F0 shape): the cloned metadata
  points at blobs that are not there — asset serving breaks silently.
- **Same directory**: parent and fork share a store with no
  cross-instance awareness — the fork's `app.reset` or GC can destroy
  bytes the parent still references, and vice versa.

So asset custody is an **F0 decision, not an F1 refinement**. Options,
cheapest-honest first: (a) **refuse to fork asset-bearing apps in F0**
(detectable from the asset tables at fork time) — the agent-development
primary case mostly tolerates this; (b) **fork-private asset tree** —
reflink/clonefile the `assets/` directory next to the fork (cheap on
CoW filesystems, a real copy elsewhere), giving full isolation and no
cross-instance GC question at the cost of not sharing bytes; (c) a
**fork-aware shared store** — store-root indirection plus a GC barrier
("no blob deleted while any live fork's metadata references it") — the
eventual right answer for hosted/S3 targets, and the only option that
needs new LLP 0044 machinery. F0 should ship (a) or (b); (c) is F2
territory alongside the hosted store seam. LLP 0139's
bytes-vs-metadata thesis still applies — but as a design *direction*
for (c), not a property the shipped layout already has.

Two option-(b) obligations the round-2 review added: **consistency** —
the assets tree must come from the *same cut* as the database (a
separately-timed reflink of a live parent's `assets/` races blob
writes; the existing asset-export path's pattern — capture referenced
rows, verify immutable blobs — is the model), and **bearer custody** —
asset signing material is DB-resident and the signed-URL MAC input does
not bind an instance identity (`crates/snapback/src/assets.rs`), so the mint must
invalidate parent-signed URLs — by rotating the fork's signing keys,
by the **lifecycle-generation bump** the asset-cut import already
implements and tests (its restore-epoch fence bumps every generation
past the manifest's so old-epoch signed URLs cannot validate,
`crates/snapback/src/assets_cut.rs`), or both — and F0a's corpus includes the negative
test: a parent-signed asset URL presented to the fork is refused.

### The diff surface — where "diff" actually belongs

The forking mechanism should *not* be diff-based (CoW is simpler and
faster). Diffs are the **inspection layer** — the answer to "what did
this fork change relative to its parent," which is the artifact an agent
or reviewer wants before promoting any conclusion from a rehearsal:

- **Journal-derived (preferred), scoped honestly.** Because the fork
  continues the parent's version stream from a recorded fork point, the
  fork's own `_snapback_changes` journal *is* the diff: every post-fork
  changeset, in commit order, with post-images (LLP 0008). Rendering
  "rows added/changed/deleted per table since the fork point" is a read
  over machinery both shipped targets already have. **Coverage limit
  (review-forced):** this is an *app-row* diff only. Auth state
  deliberately bypasses the app journal (protected lane, `crates/snapback/src/local.rs`);
  sidecar files, asset blob operations, telemetry, captured-effect
  attempts, and privileged/raw-SQL changes are all outside it. The
  receipt must carry explicit coverage/omission metadata — "shows what
  the agent's app-data changes were," never "shows everything the agent
  did." Retention caveats: the fork's own maintenance worker prunes the
  journal on the normal schedule, and whether a per-instance retention
  pin exists at creation time is unverified — a knob F0 may need to add
  for the receipt to hold over a fork's whole TTL.
- **State-comparison fallback.** SQLite's `sqldiff` and the session
  extension (changesets/patchsets) compare two database states directly
  — target-specific but useful for local tooling and as a cross-check
  that journal-derived diffs are honest. Caveat: comparing the fork
  against the *current* parent conflates the parent's own post-fork
  changes; a whole-database comparison needs an immutable base snapshot
  **explicitly retained** — the live-path backup destination itself
  becomes the writable fork, so keeping a base is a separate copy the
  fork operation must choose to make (round-2 correction).
- **Receipt form.** The natural output shape already exists: LLP 0081's
  rehearsal receipts. A fork-rehearsal receipt — fork point, operations
  run, diff summary, gate results — is the same genre of evidence, and
  agents are the same consumers.

Fork + diff-receipt is the honest generalization of LLP 0146's shipped
mutation dry-run: dry-run rehearses one buffered mutation; a fork
rehearses an arbitrary workflow, and the diff receipt is its captured
effect set.

### Lifecycle and GC

Cheap creation without cheap deletion recreates the unbounded-history trap
LLP 0088 §5 guarded against, one level up. Current F0b stamps every managed
fork with a finite TTL (two hours by default), lists it through a UUID-bound
advisory registry under the selected fork root, and provides exact `drop` plus
deterministic `reap --now-ms`. Lifecycle operations re-bind the registry entry
to the invoking canonical app root and logical `appId`, then to the direct-child
directory, fork-local app-binding receipt, database lineage, mint receipt, and
ready file before projecting credentials, reading, signalling, recovering, or
deleting. A shared explicit fork root is therefore a storage pool, not an
authority selector. A legacy entry without an app-root binding fails closed.
**No un-TTL'd product fork exists in v1.**

Expiry is now automatic in two independent places. Every `fork create` first
sweeps already-expired registry-bound forks at its real injected wall clock
and refuses with `SNAPBACK_FORK_EXPIRED_REAP_FAILED` if a possibly-live target
cannot be proved and removed. A derived server separately refuses boot after
its recorded expiry and checks the wall clock while serving, then shuts down
with `SNAPBACK_FORK_SERVER_EXPIRED`; it retains its non-secret ready descriptor
so the next reaper can prove the recorded PID is gone before deleting state.
Explicit `reap --now-ms` remains as the deterministic operator/test surface.

Creation resource admission is root-wide atomic. A fork-root `flock` remains
held across the observed count/byte snapshot, registry intent, and permanent
directory publication, so concurrent creates at either the count or total-byte
boundary cannot both admit against the same stale observation. The lock does
not broaden authority: each create and any automatic reap performed before it
still sees only the invoking app-root-bound lifecycle set. Acquisition polls
`LOCK_NB` against a 30-second monotonic deadline and refuses with
`SNAPBACK_FORK_ADMISSION_TIMEOUT` rather than sleeping without bound. After
publication releases the lock and before the detached server exec, every
non-stdio descriptor inherited from the create caller is marked close-on-exec;
the server therefore cannot retain a caller capture pipe, lifecycle lock, or
other accidental descriptor for its TTL.

Bounded renewal is built (LLP 0185 Phase 3, 2026-08-05): `fork renew` extends
a finite expiry under the per-fork cleanup lock, refuses an already-expired
fork (`SNAPBACK_FORK_RENEW_EXPIRED`), is capped by a configured maximum total
lifetime from creation (`MANAGED_FORK_MAX_LIFETIME_MS`, 7d, author-ratified
2026-08-05; creation shares the same cap), emits a durable
`ForkRenewReceiptV1`, and carries all
three expiry carriers (database lineage, mint receipt, registry entry)
through a sentinel-plus-intent protocol that `fork recover` completes after a
crash at any cut. On an armed fork, the lifecycle registered-writer token
admits the exact non-mutating `wal_checkpoint(FULL)` and runs it before the
lineage transaction. The mint receipt and advisory registry are then replaced
durably; any ordinary failure after the database change compensates all three
carriers to the previous expiry and removes the intent/sentinel before
refusing. Only the explicit crash-cut path preserves the intent for idempotent
recovery, which re-enters this same sequence. The serving watchdog re-reads
the database lineage at its deadline, so renewing a live fork extends the
running server. Renewal may
move a finite expiry but may not clear it. Independently,
derived-deployment forks never promote or clear their TTL. A permanent copied
environment, if ever added, is a different provisioning product rather than a
lifecycle transition of this fork class. If the F2-era shared asset store
(§Asset plane option c) ever exists, reap must additionally release its GC
barrier; F0's refusal posture has no cross-instance asset coupling.

## Spike evidence (2026-08-03, local-only)

The Status section's cheapest next step was executed the same day this
document was drafted: a clonefile fork of the All Aboard demo database
(LLP 0027; 9.4 MB, journal versions 1–5321), booted under the real
`target/debug/snapback` binary, mutated through the real Ibex handler
path on both parent and fork, with a journal-derived diff receipt at the
end. Scope limits: local SQLite target only; **no runtime quarantine was
built or tested** (§Runtime plane remains design, not evidence); no DO or
container-VM leg. Artifacts (databases, server logs, receipt) lived in a
session scratchpad and are reproducible from the recipe below rather than
checked in.

**What was demonstrated:**

1. **The copy is effectively free.** `cp -c` (APFS `clonefile`) forked
   the checkpointed 9.4 MB database in under 10 ms, and a 2 GB file in
   under 10 ms (a plain byte copy of the same file took 0.35 s) — O(1)
   in file size, with no new blocks consumed until divergence.
2. **A forked file boots as a complete backend — minus one load step.**
   `snapback start --db <fork>` came up healthy with schema manifest,
   cron state, and auth mode all carried inside the cloned file. But the
   *served function manifest* is not established from the database alone
   when the server starts with no app root (`appRoot: null`): function
   runs fail with "not in the loaded function manifest" until an
   explicit `snapback load --functions` replays the generated manifest.
   A product fork operation must therefore either replay the load or
   start the fork with startup artifacts. Current F0b supplies a complete
   generated pair through the owner-only cold-start carrier, then arms LLP 0165
   writer coverage on the serving connection after schema activation and
   before listener bind. A historical partial dev-manifest layout still loads
   after readiness and remains explicitly unarmed.
3. **Post-fork commits flow through the real path on both sides.**
   `applyFeedTick` ×2 on the fork and `claimFeedPoll` on the parent all
   committed (admin-token-gated `function.run`; each server minted its
   own local admin token, a sibling file that is *not* inherited through
   the clone).
4. **The journal-derived diff works as designed.** With fork point 5321
   recorded, `SELECT … FROM _snapback_changes WHERE version > 5321` on
   each side yielded exactly the post-fork changesets with post-images —
   fork: versions 5322–5323 (12 `trainStatus` updates over 6 rows, 2
   `feedRefreshState` updates); parent: version 5322 (1
   `feedRefreshState` update). Rendered as a
   `forkDiffReceipt`-shaped JSON summary with no new machinery.
5. **Version streams continue and collide — as predicted, now observed.**
   Both sides continued from 5321 natively (the counter is in
   `_snapback_version`, inside the file) and both minted a version 5322
   with different contents. Continuation-from-fork-point costs nothing;
   provenance requires the fork-point stamp.
6. **Identity is inherited, not fresh — the draft's first corrected
   claim.** The clone carried the parent's `appId` (`all-aboard`) and
   `auth_stream_incarnation_v1` verbatim into the fork. The draft
   originally asserted fresh identity "falls out" of the new-logical-app
   framing; the spike showed it must be an explicit step. The round-1
   reviews then corrected the *fix*: rotation alone is not that step —
   the mint must be the transactional scrub-and-mint of §Design sketch,
   and its effectiveness is unproven until the negative-test spike
   (parent session, agent, and resume credentials presented to a minted
   fork; all refused) runs. Nothing in *this* spike tested any
   credential against the fork.

**Reproduction recipe** (from a repo with a bootstrapped runtime and a
populated `.snapback/all-aboard.sqlite3`):

```
cp .snapback/all-aboard.sqlite3 $WORK/parent/   # then checkpoint
sqlite3 $WORK/parent/all-aboard.sqlite3 "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 $WORK/parent/all-aboard.sqlite3 "SELECT MAX(version) FROM _snapback_changes"  # fork point
cp -c $WORK/parent/all-aboard.sqlite3 $WORK/fork/all-aboard.sqlite3    # the fork
target/debug/snapback start --db $WORK/fork/all-aboard.sqlite3 --ready-file $WORK/fork.ready.json &
target/debug/snapback load --ready-file $WORK/fork.ready.json --token <minted> \
    --functions demos/all-aboard/snapback/generated/functions.manifest.json
target/debug/snapback run applyFeedTick --ready-file $WORK/fork.ready.json --token <minted> \
    --args '{"trigger":"fork-spike-1"}'
sqlite3 $WORK/fork/all-aboard.sqlite3 \
    "SELECT version, table_name, row_id, op FROM _snapback_changes WHERE version > <forkpoint>"
```

## Implementation path (local v1, explored 2026-08-03)

**Current-state reconciliation — 2026-08-05.** The original code-level seam inventory identified the work F0a/F0b then
implemented. This table now distinguishes the current product path from the
historical spike and the remaining follow-ons:

| Piece of the fork | Status | Where |
| --- | --- | --- |
| Consistent copy (cold or live parent) | **Built** — every managed creation uses SQLite's backup API into private staging; full copy | `crates/snapback/src/instance_fork.rs::publish_with_options` |
| O(1) cold-parent copy optimization | **Spike only, not product-wired** — APFS `clonefile` was measured; reflink/`VACUUM INTO` are design candidates, not F0b fallbacks | §Spike evidence; no `crates/snapback/src/instance_fork.rs` path |
| Boot a clone as a working backend | **Built** — `fork create` launches a detached child, waits for and validates its ready descriptor, then records the runtime in the registry | `crates/snapback/src/cli/fork.rs::fork_command` |
| Schema/function manifests into the fork | **Built when generated files exist** — with a complete generated pair, `fork create --app-root` admits schema/functions through an owner-only fork-local cold-start carrier, arms writer coverage after schema activation and before listener bind, and returns the verified receipt. Malformed pair input refuses before spawn; a child-side pair refusal never binds and returns `SNAPBACK_FORK_LOAD_FAILED`. The historical partial dev-manifest layout loads whichever halves exist after bind, stops the child on either load failure with the same code, returns `writerCoverageReceipt: null`, and remains `journal-enumerated-v1`. | `crates/snapback/src/cli/fork.rs::fork_command` |
| Scheduled-work pause: cron | **Built** — boot switch idles autonomy and the derived-runtime gate denies manual tick | `crates/snapback/src/cli.rs`, `crates/snapback/src/local.rs` |
| Scheduled-work pause: durable jobs | **Built** — boot switch idles autonomy and the derived-runtime gate denies enqueue/forced drain | `crates/snapback/src/cli.rs`, `crates/snapback/src/storage.rs`, `crates/snapback/src/local.rs` |
| Asset-runner pause | **Built** — derived boot disables the third autonomous worker | `crates/snapback/src/cli.rs`, `crates/snapback/src/server.rs` |
| Config-secret non-inheritance | **Free by construction** — values in a 0600 sibling `*.config.json`, never in the database (LLP 0036 D1/D2) | `crates/snapback/src/config.rs` |
| Admin-token isolation | **Built** — per-database minted sibling; fork launch removes inherited `SNAPBACK_ADMIN_TOKEN` and start reloads fork-local authority | `crates/snapback/src/instance_fork.rs`, `crates/snapback/src/cli.rs`, `crates/snapback/src/admin.rs` |
| `DenyAll` egress quarantine | **Built** — closed host-op classification plus manual cron/job, provider, maintenance, and telemetry guards; bounded payload-free markers; unknown future host ops refuse | `crates/snapback/src/instance_fork.rs`, `crates/snapback/src/local.rs`, `crates/snapback/src/runtime.rs`, `crates/snapback/src/server.rs`, `crates/snapback/src/storage.rs`, `crates/snapback/src/admin.rs` |
| `CaptureOnly` effect capture | **Open shared follow-on** — 0097 ledger/keying and simulated-result mediation remain unwired for derived deployments | `crates/snapback/src/branches.rs`; LLP 0097/0164 |
| Identity scrub-and-mint | **Built** — transactional custody scrub, auth/data-stream rotation, fork stamp, fresh admin/auth/resume sidecars, negative credential corpus | `crates/snapback/src/instance_fork.rs` |
| Asset custody | **Built as same-cut fork-private copy** (2026-08-05) and live-lifecycle-proved (2026-08-06) — the staged metadata cut enumerates its blobs, each copies digest-verified into the fork's own tree or publication refuses (no metadata-only success); attempts/work-ledger scrub, signing keys rotate; the production upload/TUS/finalize, signed serving, delete, GC, parent-cleanup independence, and exact drop/reap path is exercised against live parent/fork servers; shared-store indirection stays F2 | `crates/snapback/src/instance_fork.rs::copy_fork_private_assets`; `crates/snapback/tests/instance_fork_cli_v1.rs::live_fork_asset_lifecycle_is_private_gc_safe_and_exactly_reaped` |
| Fork registry, TTL, reaping | **Built** — advisory UUID registry, finite timestamps, exact drop, caller-clock deterministic reap, create-time automatic reap, boot/periodic server self-expiry, bounded intent-journaled renewal with a max-lifetime cap, per-fork cleanup locking, and stale-registry completion | `crates/snapback/src/instance_fork.rs`, `crates/snapback/src/cli/fork.rs` |
| Recovery and inspection | **Built** — exact-destination local-evidence recovery, bounded status/diff summary, process health, isolation posture, and JSON-first shell scalar overlays | `crates/snapback/src/instance_fork.rs::recover`, `crates/snapback/src/cli/fork.rs::fork_command` |
| Diff receipt | **Built** for an app-row journal sequence with explicit `attribution: absent-v1`, coverage/omissions, stream-qualified `(base, head]` identities, a canonical domain-separated receipt digest, and same-snapshot floor/head/row capture; it refuses after a retention gap and is not an exact net diff | `crates/snapback/src/instance_fork.rs::diff_receipt` |
| Port/endpoint isolation | **Built** — the OS selects an ephemeral port via `--port 0`, returned in an LLP 0030 ready file; dated 2026-08-05 evidence covers simultaneous creates binding distinct ports, concurrent drops settling one-winner/`NOT_FOUND`, SIGKILLed servers, and deleted ready descriptors | `crates/snapback/src/cli.rs`, `crates/snapback/tests/instance_fork_cli_v1.rs` |

Two design points the inventory surfaces:

- **Identity, precisely — OQ9 decided.** The `appId` is baked into the
  generated schema/functions manifest pair and validated on load
  (`pair.schema.appId`), so a v1 fork keeps the logical `appId` — like a
  git clone keeps the project name — and gains instance-level identity:
  fork id, rotated auth *and data-stream* identities, fresh sidecars,
  fresh endpoints, fork-point stamp. The Codex review is right that this
  required an explicit LLP 0018/0012 amendment because 0018 made `appId`
  *the* identifier scoping local-store keys, diagnostics, and telemetry.
  OQ9 decides the fork is a **derived deployment** of the same logical app:
  instance identity is threaded through credentials, cursors, local-store
  keys, telemetry, and every other independently mutable concern named in
  the normative amendment. The shared `appId` is compatibility identity,
  never authority to select or reuse a sibling instance's state.
- **Forking a *live* parent.** `clonefile` of a database mid-write, with a
  separate WAL, is not a consistent pair, and `crates/snapback/src/instance_lock.rs` provides
  ownership metadata rather than a checkpoint primitive. F0b therefore uses
  the same SQLite backup path for cold and live sources. A live ready file is
  validated against the live process before its database path is accepted;
  creation remains CLI-only rather than a public handler/HTTP fork operation.

**Phasing** (deliberately re-ordered by the reviews — the bypass corpus
comes before the CLI verb, and no duration estimates until it exists):

- **F0a — the safety corpus first** (green-lit by the author
  2026-08-03, with one scope cut): the identity scrub-and-mint with
  negative tests (parent session, agent credential, resume token, search
  cursor, admin token, parent-signed asset URL — all refused by a minted
  fork), the publication state machine with its intra-state crash-cut
  matrix, the mechanical custody schema sweep as the first gate, and —
  the scope cut — **deny-all egress, fail-loud, as the v1 posture**:
  every enumerated op family plus manual cron tick, forced drain,
  provider adapters, and S3/provider asset I/O under inherited env
  credentials *refuses* in a fork, with refusal tests for each. The
  capture *ledger* integration (captured intents instead of bare
  refusal) is deliberately deferred out of F0a and built once,
  coordinated with LLP 0097's own mediation prerequisite, so F0a does
  not silently become the 0097 wiring project. A fork that cannot fetch
  is still safe and still serves the agent-development case.
  This corpus *is* the feature; the verb is packaging. Tickets:
  `issues/closed/20260803-0158-f0a-*.md`.
  **Implementation record — 2026-08-03:** landed in the dedicated
  non-promotable `instance_fork` module and shared runtime gates without
  modifying LLP 0097 branch/promotion paths. The standing custody audit
  classifies the live SQLite schema and refuses unknown tables; the negative
  corpus presents parent session/agent residue, resume/search/admin bearers,
  and a parent-signed asset URL to a minted fork; the publication corpus cuts
  every S0-S5 durability edge and recovers with absent, stale, and unavailable
  registry state; the deny corpus records one bounded payload-free row per
  family and refuses unknown future host operations. Local asset-bearing
  sources originally took option (a), refusal; LLP 0185 Phase 5 (2026-08-05)
  replaced that with the same-cut fork-private copy recorded in the custody
  inventory. F0a is complete; F0b subsequently landed the
  first consumer surface recorded below.
- **F0b — the local fork verb:** `snapback fork create
  [--from <db|ready-file>] [--ttl 2h] [--with-secrets] [--app-root <dir>]`
  → copy (cold or live path), scrub-and-mint, registry row with TTL,
  boot with all three worker switches + `DenyAll` egress, LLP 0030 ready
  descriptor plus LLP 0024 result envelope; `fork list`, `fork diff` (the receipt),
  `fork drop`, and caller-clock deterministic TTL reaping; asset-bearing
  sources originally refused per the F0 decision (superseded 2026-08-05 by
  the Phase 5 same-cut private copy).
  **Implementation record — 2026-08-03:** implemented as the source CLI over
  the F0a `instance_fork` module. Every managed fork has a finite expiry,
  same-`appId` lineage and independent auth/data-stream identities; default
  secret custody scrubs the config sibling and `--with-secrets` is the only
  copy opt-in. The child runtime publishes an LLP 0030 ready file; the parent
  CLI returns its path inside an LLP 0024 `hostOpsResult`, disables
  cron/jobs/assets, and inherits the F0a `DenyAll` gate.
  Asset-bearing parents refused under OQ5 option (a) at this record's date
  (superseded 2026-08-05 by the Phase 5 same-cut private copy). List/drop/reap use
  UUID-bound advisory registry entries that must re-bind to the exact regular
  direct-child destination, mint receipt, database lineage, and ready file
  before read/signal/delete; an unverified possibly-live PID refuses. Reaping
  takes a portable-range injected clock. The app-row diff pins floor/head/rows
  in one read transaction and refuses if retention passed the fork point.
  Copied history drops parent-only operation ids when their ledger is scrubbed.
  The automated managed-lifecycle and executable CLI tests plus the dated fleet
  record at
  `tests/acceptance/instance-fork-fleet-dogfood.2026-08-03.v1.json` are green.
- **F1 — agent ergonomics, operating slice landed 2026-08-05:**
  `guide/operating/instance-forks.md`, the target-`none` capability-index GAP,
  `demos/_kit/instance-fork.mjs`, and Todo's maintained fork-instead-of-seed
  acceptance fixture cover a single fork/single owner; create-time reap,
  boot/periodic self-expiry, product-facing recovery, coherent lifecycle help,
  bounded status, shell scalars, and actionable diagnostics now complete the
  Phase-1 operating slice. The Phase-3-gated concurrent worktree/agent
  workflow remains open. The capability row deliberately remains an
  unpublished target-`none` GAP because the derived-deployment capability's
  distinct qualification and publication gates have not passed.
- **F2 — hosted:** the OQ4 DO-bookmark spike decides bookmark-fork vs
  export/import on Cloudflare; container-VM rides Fly volume forks
  (LLP 0099) and adds the ProcessContained tier (§Threat model);
  fork-aware shared asset store. Only after F0/F1 demonstrate use.

  **Boundary note — 2026-08-05:** LLP 0167 now recognizes derived identity
  solely for network-profile activation. Rust obtains it from the existing
  `inspect_boot` proof (matching permanent lineage, mint receipt, non-promotable
  identity, database filename, and fresh sidecars). The Cloudflare coordinator
  reserves `SNAPBACK_DERIVED_INSTANCE_ID` as a deployment-level canonical
  fork-id binding; only the future F2 deployment/mint path may stamp the real
  value. This binding does not claim that Cloudflare fork materialization,
  lifecycle, custody, or egress containment is built.

### Automation-facing artifact inventory (F0b v1, frozen 2026-08-05)

This inventory freezes the fork-specific bytes an automation consumer can
target. LLP 0024 still owns the outer `hostOpsResult`, LLP 0030 still owns
`HostReadyDescriptor` and `schemas/host-ready.schema.json`, and LLP 0037 still
owns Rust-first schema custody. `fork-cli-projection-v1` and
`fork-diagnostics-v1` below are inventory labels in this document, **not
currently emitted discriminator fields**. The lineage, mint, registry, diff,
and reap artifacts do emit the versions named below. Except for the generic
ready descriptor, the fork DTOs are Rust serde types but do not yet have
committed generated JSON Schemas; this freeze is the review target for later
schema/compatibility tests, not a claim that those tests already exist.

**CLI JSON projection — `fork-cli-projection-v1` inside
`hostOpsResult(schemaVersion = "snapback.v0")`.** All eight operations
(`create`, `list`, `inspect`, `diff`, `renew`, `drop`, `reap`, `recover`) emit
`resultKind: "hostOpsResult"`, their exact `operation`, and the usual LLP 0024
outer fields. The fork-owned `data` shapes are:

| Operation | Fork-owned `data` fields |
| --- | --- |
| `fork.create` | `receipt` (`ForkMintReceiptV1`), `registry` (`ForkRegistryEntryV1`), `writerCoverageReceipt` (`ForkAppRowCoverageReceiptV1` on the complete-pair cold-start path, otherwise `null`), `database`, `readyFile`, `runtimeLog` (paths); `workerPolicy` with `cron`, `jobs`, and `assets`, each currently `"disabled"`; `egressPolicy: "deny-all-v1"`; `assetCustody`: `"fork-private-same-cut"` or `"no-assets"` (2026-08-05; formerly the constant `"refuse-asset-bearing-source"`); `secrets` = `"scrubbed"`, `"copied-explicitly"`, or `"copy-requested-source-absent"`; additive `automaticReap.{observedAtMs,reapedForkIds,clearedStaleRegistryIds}` and `resourceAdmission.{usage,limits}` (2026-08-05) |
| `fork.list` | `forkRoot` path; `forks` array of entries bound to the invoking canonical app root and logical app id, sorted by `lineage.forkId`; entries validly bound to another root are not projected, while a legacy/missing binding fails closed; additive `unboundRegistry` (same-root entries that failed evidence re-binding, with their codes) and `resourceUsage.{forkCount,totalBytes,defaultLimits}` (2026-08-05) |
| `fork.inspect` | `status` with `schemaVersion: "snapback.fork-status.v1"`, lineage identity/fork point/expiry, `processHealth`, database/ready/admin-token paths, `secretDisposition`, inert `workerPosture`, `egressPosture: "deny-all-v1"`, and bounded `diffSummary` (`snapback.fork-diff-summary.v1`; counts/coverage/omissions, never full rows) |
| `fork.diff` | `receipt` (`ForkDiffReceiptV3`, or `ForkNetDiffReceiptV3` under `--net`); `writtenTo` path or `null` |
| `fork.renew` | `receipt` (`ForkRenewReceiptV1`, `snapback.fork-renew.v1`: `forkId`, `renewedAtMs`, `previousExpiresAtMs`, `expiresAtMs`, `createdAtMs`, `maxLifetimeMs`); `registry` (the re-bound entry carrying the moved expiry). Durable siblings: `fork-renew-receipt.json` (latest receipt) and the transient `fork-renew-intent.json` behind the staging sentinel, consumed by `fork recover` (2026-08-05) |
| `fork.drop` | `forkId`; `stoppedPid` (`u32` or `null`); `dropped: true` |
| `fork.reap` | `receipt` (`ForkReapReceiptV1`); additive `clearedStaleRegistryIds` (stale bookkeeping completed, reported separately from real reaps; 2026-08-05) |
| `fork.recover` | `forkRoot`, exact `destination`, `disposition`, optional `forkId`, and optional reconciled `registry`; recovery remains valid when advisory registry repair is unavailable |

For `create`, `target.appId` is the shared logical app, `target.appRoot` is the
canonical worktree root, and `target.serverUrl` is the child URL. `list` and
`reap` use that same invoking, root-identity-bound `appId`; neither derives
identity from an arbitrary first registry entry. CLI failures can occur before
an LLP 0024 envelope is available;
the stable code vocabulary below remains the classification surface.

`fork create` and `fork inspect` additionally accept `--format url|fork-id|
database-path|ready-path|admin-token-path`. Those modes print exactly one
non-secret scalar plus a newline. They are opt-in shell conveniences, not a
second automation contract: omitted `--format` remains the JSON envelope, and
an unavailable scalar refuses with `SNAPBACK_FORK_PROJECTION_UNAVAILABLE`.

**Ready descriptor — generic `snapback.v0` / `snapbackHostReady`, fork
consumer subset.** There is deliberately no fork-only field and no `forkId` or
parent lineage in `HostReadyDescriptor`. Fork automation consumes the generic
`schemaVersion`, `descriptorKind`, `startupId`, `ready`, `serverUrl`, `host`,
`port`, `pid`, `startupNonce`, `startedAtMs`, `target.{appId,appRoot,
targetProfile,serverUrl}`, `database.{mode,path}`, `adminGated`, `adminTokenFile`, and
`diagnostics`. For a managed fork, `target.appId` remains the parent logical
app, `target.appRoot` is `null`, `targetProfile` is
`local-dev-sqlite-ibex`, `database.mode` is `file`,
`database.path` is the exact fork database, and `adminTokenFile` is its freshly
minted sibling. Optional `secretReadRootFile` and
`impersonationCapabilityFile` retain their generic LLP 0030 meanings; they are
not lineage evidence. A consumer joins the ready file to
`fork.create.data.receipt` / `registry` through the exact recorded paths and
live startup identity, never through `appId` alone.

**Derived lineage — `DerivedForkLineageV1`, `formatVersion: 1`.** This closed
object is stored in `_snapback_meta.instance_fork_lineage_v1` and embedded in
the mint receipt and registry entry. Its fields are `formatVersion`, `forkId`,
`parentInstanceId`, `appId`, `createdAtMs`, `forkPointVersion`,
`expiresAtMs`, and `promotable`. Managed forks always carry a finite
`expiresAtMs` and `promotable: false`; only the lower-level crash corpus may
omit expiry. `parentInstanceId` has the source-shaped semantics documented in
§Design sketch and is not a stable cross-restart primary key.

**Mint receipt — `ForkMintReceiptV1`, `formatVersion: 1`.** The fork-local
`fork-mint-receipt.json` contains `formatVersion`, `lineage`, `databaseFile`,
`authorizationStreamIncarnation`, `dataVersionStream`, and `custody`. `custody`
is a map from every classified source table and known sidecar convention to one of
`copy`, `scrub`, `rotate`, `share`, or `refuse`; boot and lifecycle validation
bind this receipt to the permanent database lineage and fresh sidecars.

**Registry entry — `ForkRegistryEntryV1`, `formatVersion: 1`.** Each
`.snapback-fork-registry/<forkId>.json` contains `formatVersion`, `state`,
`destination`, `lineage`, `databaseFile`, and optional `readyFile` / `appRoot`.
Accepted states are `intent`, `published`, and `ready`; ordinary successful
`fork create` returns `ready`. `destination` and `databaseFile` are validated
direct-child names, while the optional runtime paths are recorded only after
ready publication. The entry is advisory: every lifecycle operation re-binds
it to local receipt/database evidence before acting. For every product-created
managed fork, `appRoot` is required from the `intent` state onward and is the
canonical invoking root; its optional wire type exists only so old rows decode
and can be refused with `SNAPBACK_FORK_APP_BINDING_REQUIRED` rather than being
silently selected.

Legacy/unbound entries remain counted in the fork root's byte admission even
though managed reap cannot prove authority to delete them. The v1 manual
cleanup path is intentionally out of band: an operator first stops and
identifies the exact legacy process/directory from independent provenance,
then removes that exact UUID registry row and direct-child directory. Snapback
does not offer a wildcard or recursive `--unbound` deletion mode.

**App binding — `snapback.fork-app-binding.v1`.** The invoking root first owns
`.snapback/instance-fork-app-identity.v1.json`, binding its canonical path to
the logical `appId`. Publication copies that identity into the staging intent,
the registry intent, and the fork-local `fork-app-binding-receipt.json` before
the authoritative rename. The receipt binds `forkId`, `appId`, and
`canonicalAppRoot` with a domain-separated canonical SHA-256 digest. Every
selecting command (`list`, `inspect`, `diff`, `renew`, `drop`, `reap`, and
`recover`) compares its canonical expected identity against both registry and
receipt evidence before it can project a path or credential or mutate state.
The managed library APIs accept that identity only as an opaque
`ExpectedForkAppV1` returned by `ensure_expected_app` or `load_expected_app`;
callers cannot construct free-form root/app-id fields, and mint re-loads the
canonical app-root receipt before S0 so a stale or replaced identity refuses.
The destination's parent is only the fork storage root and is never inferred
as lifecycle authority. `record_managed_runtime` re-binds the already-minted
registry and fork-local receipt before recording readiness, so a launch-time
disagreement refuses instead of rebinding the fork. The lower-level crash-
corpus `publish` entry point remains unmanaged: it emits no app binding and
cannot later pass a managed lifecycle selector. Consequently, lack of launch
is not legacy evidence; lack of a mint-time binding is. The app-root identity
is deliberately one logical app id per canonical root. To re-pin a worktree,
first use the current identity to drop or reap every managed fork it owns;
then remove only
`.snapback/instance-fork-app-identity.v1.json`. The next `fork create` /
`ensure_expected_app` establishes the new app id. Removing the identity while
owned forks remain makes those forks unselectable through managed commands and
does not authorize rebinding them.

**Journal diff receipt — `ForkDiffReceiptV3`,
`schemaVersion: "snapback.fork-journal-diff.v3"`** (incompatible replacement
for the misleadingly named v1 surface). Top-level fields are
`schemaVersion`, `forkId`, `appId`, `parentInstanceId`, `forkPointVersion`,
`observedHeadVersion`, stream-qualified `base` / `head`, `attribution`, `rows`,
`tableCounts`, `coverage`, `omissions`, and `receiptDigest`. `base` and `head`
each carry `dataVersionStream`, `commitVersion`, and `versionBoundary`; the
emitted journal range is precisely `(base, head]` (`exclusive`, `inclusive`).
Each ordered `ForkDiffRowV1` has `version`, `table`, `rowId`, `operation`, and
`postImage` (object/value or `null` for a journal entry without a post-image).
`attribution` is the required machine-readable constant `absent-v1`: row
`operation` means SQL insert/update/delete, not LLP 0163 operation/principal
attribution. The current omissions are asset blob operations, auth and
credential state, captured or refused egress payloads, privileged/raw-SQL
writes outside the app journal, and sidecars/telemetry. This is a journal
post-image sequence, not LLP 0164's exact net diff. `receiptDigest` is SHA-256
over JCS-canonical serialization of every other emitted field, domain-separated
by `snapback:fork-journal-diff-receipt:v3\n`.

**Base evidence — `ForkBaseReceiptV1`,
`schemaVersion: "snapback.fork-base.v1"`** (additive, 2026-08-05). Written
only for `--retain-base` forks beside `fork-base.sqlite3`: fields are
`schemaVersion`, `forkId`, `databaseFile`, `sha256`, and `retainedAtMs`. The
digest binds the immutable base to the exact fork; a mismatch refuses net
diffing rather than serving a rewritten history.

**Fork-point writer coverage — `ForkAppRowCoverageReceiptV1`,
`schemaVersion: "snapback.fork-app-row-coverage.v1"`** (additive,
2026-08-06). On the complete-pair path, cold-start composition applies the
worktree schema/function pair, verifies the fork head still equals the fork
point, arms the exact LLP 0165 fork-local journal-authority manifest on the
serving connection, and persists the identical self-digesting object in
`_snapback_meta.instance_fork_app_row_coverage_v1` and
`fork-app-row-coverage-receipt.json` before listener bind. A partial generated
layout takes the historical post-bind loader and writes no coverage receipt.
Fields are
`schemaVersion`, `profile` (`derived-fork-app-rows-v1`), `forkId`,
`dataVersionStream`, `forkPointVersion`, `activationHeadVersion`,
`activatedAtMs`, `manifestVersion`, `manifestDigest`, `coveredLanes`,
`uncoveredLanes`, `writerChokePoints`, and `receiptDigest`. `uncoveredLanes`
is the closed set of app-effective writer families that the armed profile
refuses rather than silently admitting outside the journal seam. The two exact
covered lane names are `derivedForkOrdinaryAppRowJournal` and
`derivedForkHostChildAppRowJournal`; they map to the four generated physical
app-row writer adapters and are deliberately distinct from LLP 0163's
operation-envelope lanes. Thus this receipt does not imply operation
attribution. Activation also creates
`_snapback_operation_coverage_continuity_v1`, keyed by data-version stream and
binding the expected manifest version/digest. Its state is monotonic from
`continuous` to `broken`. Every process-owned primary or secondary writable
connection reconstructs the two receipts, active stream, manifest, and this
continuity row before it can receive a token. Arbitrary armed DML cannot alter
the manifest or continuity carriers. If reconstruction observes a missing or
contradictory active boundary, it marks the row `broken` and creates the
append-only sibling `fork-app-row-coverage-gap.v1.json` with
`schemaVersion: "snapback.fork-app-row-coverage-gap.v1"`, `streamId`, expected
manifest version/digest, detection time, and reason. Either broken carrier
permanently excludes this fork from the whole-window class; the recovery action
is recreation, not manifest restoration or re-arm.

**Net diff receipt — `ForkNetDiffReceiptV3`,
`schemaVersion: "snapback.fork-net-diff.v3"`** (incompatible replacement,
2026-08-06, for the closed v2 receipt). Existing identity,
`substrate`, ordered row/pre/post-image, `tableCounts`, and `domains` facts
retain their meanings. The required stream-qualified `base` / `head` fields
carry the same `(base, head]` boundary contract as the journal receipt. The
independent base/head scan decodes physical
SQLite values through each side's stored schema before comparison and receipt
emission, so Boolean, JSON, and vector fields retain their logical JSON
representations. `completeness` is
`registered-connection-defensive-app-rows-v1` only when the matching fork-point coverage
receipt and active manifest verify for the whole post-fork window and
`journalConsistency` is `journal-cross-check-verified`; otherwise it is
`journal-enumerated-v1`. `writerCoverage` separately carries
`coverageWindow` (`fork-point-to-observed-head-verified` or `unverified`),
`manifestDigest` (string or `null`), `coveredLanes`, and `uncoveredLanes`.
`attribution` is the machine-readable constant `absent-v1`; LLP 0163 operation
attribution remains deferred. A retention gap cannot upgrade completeness; an
unexplained net row, a final covered-journal post-image that disagrees with the
head oracle, or contradictory coverage evidence refuses rather than emitting
an upgraded or silently partial receipt. `domains` still names only
app rows `net-covered` and schema/auth/operational/configuration/assets/egress/
telemetry/sidecars `omitted`.
`receiptDigest` binds every other emitted fact with JCS-canonical SHA-256 under
the distinct domain `snapback:fork-net-diff-receipt:v3\n`.

The upgraded completeness name is deliberately the LLP 0165
registered-connection class. It covers Snapback-constructed writable
connections with verified defensive mode and the same deny-by-default policy
installed in a connection-local authorizer; it is not OS/file containment.
Uncoordinated raw/WAL/page mutation is detected or
refused by the oracle and evidence checks, while a same-user out-of-class
writer that forges both app data and matching journal/version evidence remains
outside the claim and requires an OS/container/filesystem authority boundary.

Net-diff work is bounded before map growth: journal rows, base/head scanned
rows, WAL validation bytes, and bytes observed during streaming each refuse with
`SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` plus `phase`, `limitKind`, limits, and
observed usage. A revert-heavy journal or oversized unchanged database cannot
fold/compare first and pass after consuming unbounded memory. Before a scanned
SQLite row becomes an owned document, borrowed text/blob lengths are charged
for JSON escaping, hex expansion, JSON parse overhead, vector decoding, and
bounded serialization; a single value larger than the byte budget therefore
refuses before proportional Rust allocation. The default journal-sequence
receipt has a different bound: it pre-counts rows but does not have a byte-work
budget.

Creation byte limits are an atomic admission-time estimate, not a live
filesystem quota. Fork-local database writes and asset uploads may grow the
private tree after publication; finite TTL/reap is the built-in runtime
backstop, and deployments that need a hard growth ceiling must place the fork
tree under an OS/container/filesystem quota.

**Reap receipt — `ForkReapReceiptV1`,
`schemaVersion: "snapback.fork-reap.v1"`.** Fields are `schemaVersion`,
`nowMs`, and `reapedForkIds`; IDs are sorted. This receipt proves only what the
invoked caller-clock sweep removed. Create-time automatic reaping is recorded
instead in `fork.create.data.automaticReap`; server self-expiry is a runtime
diagnostic and shutdown disposition, not a fabricated reap receipt.

**Stable diagnostics — `fork-diagnostics-v1`.** These are every
`SNAPBACK_FORK_*` spelling present in `crates/snapback/src/instance_fork.rs` or `crates/snapback/src/cli/fork.rs` at
the freeze:

| Code | Meaning |
| --- | --- |
| `SNAPBACK_FORK_APP_ID_REQUIRED` | The source database has no stored schema from which to obtain its logical app id. |
| `SNAPBACK_FORK_APP_BINDING_MISMATCH` | The invoking opaque identity no longer matches its canonical app-root receipt, or the selected registry, staging intent, fork-local receipt, or runtime attachment is bound to a different canonical app root and/or logical app id. |
| `SNAPBACK_FORK_APP_BINDING_REQUIRED` | A legacy, lower-level unmanaged, or malformed entry lacks the mint-time app-root identity required for fail-closed lifecycle selection. Never-launched managed forks are not in this class because mint publishes their binding. |
| `SNAPBACK_FORK_APP_ROOT_INVALID` | The requested app-root path cannot be canonicalized. |
| `SNAPBACK_FORK_ADMISSION_TIMEOUT` | Root-wide create admission remained contended through its 30-second monotonic acquisition deadline; no count/byte observation or publication began. |
| `SNAPBACK_FORK_BOOT_FAILED` | The child server could not spawn or exited before readiness. |
| `SNAPBACK_FORK_BOOT_TIMEOUT` | The child did not publish its ready descriptor within the creation deadline. |
| `SNAPBACK_FORK_CUSTODY_REFUSED` | An occupied source table belongs to a subsystem whose fork disposition is refusal (in-app branch/promotion/migration state; since 2026-08-05 supported local asset tables are `Copy` custody, not this class). |
| `SNAPBACK_FORK_ASSET_CUT_INCOMPLETE` | A blob named by the staged metadata cut is missing from, or digest/length-mismatched in, the parent store; publication refuses rather than producing a metadata-only fork. |
| `SNAPBACK_FORK_ASSET_CUT_UNSUPPORTED` | An asset blob names a non-`local-fs` store or an unclassified digest algorithm; the future-family rule fails the cut closed. |
| `SNAPBACK_FORK_NET_DIFF_UNAVAILABLE` | `fork diff --net` was invoked on a fork created without `--retain-base`. |
| `SNAPBACK_FORK_DIFF_ORACLE_MISMATCH` | The base/head net oracle found a change the journal cannot explain; the journal receipt cannot be trusted for that span. |
| `SNAPBACK_FORK_WRITER_COVERAGE_INVALID` | Derived-fork writer-coverage evidence is partial, malformed, late, fork-point-mismatched, or disagrees with the active stream/manifest; the completeness claim refuses. |
| `SNAPBACK_FORK_WRITER_COVERAGE_GAP` | A registered writer observed that a previously armed fork's active manifest/stream/continuity boundary was absent or contradictory. The discontinuity is durably irreversible for this fork; recreate it rather than restoring carriers or re-arming. |
| `SNAPBACK_FORK_CUSTODY_UNCLASSIFIED` | A Snapback-owned source table has no closed custody-manifest rule. |
| `SNAPBACK_FORK_DESTINATION_EXISTS` | Publication would overwrite an existing destination. |
| `SNAPBACK_FORK_DIFF_INVALID` | A selected journal row cannot be decoded into the diff receipt (currently a malformed post-image). |
| `SNAPBACK_FORK_DIFF_RETENTION_GAP` | The journal floor has advanced past the fork point, so the journal-sequence receipt would be incomplete. |
| `SNAPBACK_FORK_EGRESS_DENIED` | A classified or future-unclassified outbound initiation was refused under `DenyAll`. |
| `SNAPBACK_FORK_EGRESS_MARKER_FAILED` | Egress was refused, but its required durable payload-free marker could not be recorded. |
| `SNAPBACK_FORK_EVIDENCE_INCOMPLETE` | Required local lineage, receipt, or database evidence is missing. |
| `SNAPBACK_FORK_EVIDENCE_MISMATCH` | Registry, path, database lineage, and/or mint-receipt identities disagree. |
| `SNAPBACK_FORK_EXPIRED_REAP_FAILED` | Create found a known count of expired forks, but at least one could not be safely stopped/proved/deleted; creation refuses. |
| `SNAPBACK_FORK_ID_INVALID` | A lifecycle target id is not a UUID. |
| `SNAPBACK_FORK_IO_FAILED` | A fork filesystem durability, publication, inspection, or cleanup operation failed. |
| `SNAPBACK_FORK_KEYRING_MINT_FAILED` | A fresh auth or resume keyring could not be minted and durably validated. |
| `SNAPBACK_FORK_LINEAGE_INVALID` | Lineage cannot be encoded or decoded as the v1 object. |
| `SNAPBACK_FORK_LOAD_FAILED` | Loading the worktree's generated schema or functions into the child failed. |
| `SNAPBACK_FORK_NESTED_REFUSED` | The source is already a derived deployment; nested forks are outside v1. |
| `SNAPBACK_FORK_NOT_FOUND` | The UUID is absent from the selected lifecycle registry. |
| `SNAPBACK_FORK_PATH_INVALID` | A source/destination/database path violates the UTF-8, direct-child, or resolved-path rules. |
| `SNAPBACK_FORK_PROJECTION_UNAVAILABLE` | The requested opt-in scalar has no verified value for this fork. |
| `SNAPBACK_FORK_PUBLICATION_PARTIAL` | A sentinel-bearing publication is incomplete and must be repaired with `fork recover` before boot. |
| `SNAPBACK_FORK_QUARANTINED` | The transactional database quarantine stamp still prevents boot. |
| `SNAPBACK_FORK_READY_INVALID` | The ready path/descriptor, child PID, database binding, or minted admin-token path fails validation. |
| `SNAPBACK_FORK_REAP_CLOCK_INVALID` | The supplied reap clock exceeds the portable timestamp range. |
| `SNAPBACK_FORK_RECEIPT_INVALID` | Fork evidence cannot be encoded or a mint/recovery receipt is malformed. |
| `SNAPBACK_FORK_REGISTRY_INVALID` | The registry directory/entry, format, state, identity, or recorded path shape is invalid. |
| `SNAPBACK_FORK_REGISTRY_STALE` | A registry entry names a missing destination/database/ready process fact and cannot be treated as live state. |
| `SNAPBACK_FORK_RENEW_EXPIRED` | Renewal targeted a fork already past its finite expiry; expiry is authority and renewal never resurrects. |
| `SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` | A configured bound refused the operation deterministically: root-atomic create admission (fork-count, per-fork bytes, total bytes), journal/scanned-row/byte diff work, or the renewal max-lifetime cap; details carry the observed usage. |
| `SNAPBACK_FORK_SERVER_EXPIRED` | A derived server observed its finite expiry at boot or during serving and refuses/shuts down. |
| `SNAPBACK_FORK_SIDECAR_COLLISION` | Private staging already contains a sidecar that scrub-and-mint must create fresh. |
| `SNAPBACK_FORK_SIDECAR_MALFORMED` | A required minted sidecar exists but fails regular-file, custody, encoding, token, or key validation. |
| `SNAPBACK_FORK_SIDECAR_MISSING` | A required minted admin/auth/resume sidecar is absent. |
| `SNAPBACK_FORK_SOURCE_INVALID` | The requested source cannot resolve to a file-backed SQLite database (including an in-memory ready target). |
| `SNAPBACK_FORK_STOP_FAILED` | The verified child did not accept the termination signal. |
| `SNAPBACK_FORK_STOP_TIMEOUT` | The signalled child did not become provably gone within the stop deadline. |
| `SNAPBACK_FORK_STOP_UNVERIFIED` | Missing/stale readiness or an unverifiable PID prevents a safe signal/delete decision. |
| `SNAPBACK_FORK_TEST_CRASH_CUT` | Test-only injected S0–S5 crash boundary; never a product-runtime disposition. |
| `SNAPBACK_FORK_TTL_INVALID` | The duration/expiry is zero, malformed, overflowing, non-future, or outside the portable range. |

### Automation compatibility rules

- **CLI JSON projection.** Within `fork-cli-projection-v1`, the fields, types,
  enum spellings, and operation-to-`data` mapping above do not change or
  disappear; new optional `data` fields or new operations may be additive.
  Any incompatible change requires a new projection version and, because the
  current label is documentation-only, an emitted discriminator before two
  incompatible shapes coexist. The outer envelope evolves only under LLP
  0024.
- **Ready descriptor.** Compatibility follows LLP 0030's `snapback.v0`
  descriptor and committed schema: the fork path may consume additive optional
  fields but cannot remove, retype, or give fork-specific meanings to the
  existing subset. Adding required lineage to readiness requires the LLP 0030
  owner to version that contract; until then, automation joins through the
  create receipt and registry rather than inferring from `appId`.
- **Lineage and mint receipt.** Both v1 objects are closed
  (`deny_unknown_fields`); fields may not be added, removed, retyped, or
  repurposed under `formatVersion: 1`. A custody disposition may be added for a
  newly classified table/sidecar because `custody` is a map, but existing keys
  may not silently change meaning; an incompatible object change bumps
  `formatVersion` and keeps old-reader refusal explicit.
- **Registry entries.** The v1 object and the `intent` / `published` / `ready`
  state vocabulary are closed. Optional `readyFile` may remain absent in
  earlier publication states. `appRoot` retains its optional v1 wire type for
  decode compatibility, but product selection now requires it in every state;
  its absence is a stable fail-closed diagnostic, never a wildcard. Changing
  field types, path semantics, or adding a state requires a format bump and
  lifecycle-consumer update; registry evolution never promotes it above
  advisory evidence.
- **Diff and reap receipts.** Their closed receipt/row fields and semantics do
  not change under the current `schemaVersion`; incompatible coverage,
  ordering, identity, or type changes bump the relevant receipt version. New
  omission entries may be appended to disclose less coverage, but an omission
  is removed only when a versioned receipt replaces it with an explicit
  coverage fact. The two current v3 schemas follow this rule:
  `snapback.fork-journal-diff.v3` replaces the v1 sequence with honest
  attribution absence, boundaries, and digest, while
  `snapback.fork-net-diff.v3` replaces v2 with boundaries and digest. They
  remain distinct artifacts with distinct digest domains.
- **Diagnostics.** Existing codes are never renamed, removed, or reused for a
  different class within `fork-diagnostics-v1`; new codes are additive and
  unknown codes remain preservable per LLP 0024's diagnostic conventions.
  `SNAPBACK_FORK_TEST_CRASH_CUT` is enumerated for source completeness but is
  excluded from product compatibility promises.

What F0 deliberately does *not* include: promotion/graduation of a fork,
schema-migration tooling inside the fork (agents just load their changed
manifests), hosted targets, process containment, and any 0007/0008
contract change (still none needed — the 0018/0012 amendment of OQ9 is
the one contract touch).

## Prior art

| System | Shape | Lesson for Snapback |
| --- | --- | --- |
| **Neon** | Copy-on-write Postgres branches at the storage-page level; branch-per-PR, latterly branch-per-agent; acquired by Databricks 2025 | The demand narrative (agents mint environments) and the API ergonomics; also the ceiling for hosted-Postgres fork quality |
| **Turso** | Fork/branch a hosted SQLite database as a platform feature | Closest substrate analog: SQLite files on CoW storage make forks a product feature, not an ops project |
| **postgres.ai / Database Lab Engine** | ZFS thin clones; multi-TB Postgres copies in seconds for dev/test | The ops-world ancestor; proves the rehearsal use case predates the agent narrative |
| **PlanetScale** | Schema branches with deploy-request workflow; data via backup-restore, not CoW | Branch workflow can be valuable even without cheap data copy — but the data copy is what agents need |
| **Dolt** | Full git semantics including merge | The existence proof that merge is a whole product; reinforces the merge non-goal |
| **Xata** | Branches with data copying | Mid-market validation of data-carrying branches |
| **Supabase** | Preview branches run migrations + seed; production-data branching long-requested *(state as of author's last check; re-verify before citing competitively)* | The gap Snapback would be filling is felt in the closest-competitor segment |
| **Cloudflare D1/DO** | 30-day PITR bookmarks; restore-grade (LLP 0083) | The provider accelerator for the DO target; not the contract |
| **Fly.io** | Volume forks as a platform primitive | The accelerator for the LLP 0099 container-VM lane |
| **Convex** | Preview deployments start empty + optional seed; snapshot import/export; no CoW data fork *(author knowledge, unverified against current docs)* | Differentiation, not parity |

None of the external systems fork the *runtime posture* — scheduled work,
egress, secrets — because none of them own it. Snapback's local F0b now wires
the narrower `DenyAll` posture end to end. The remaining differentiation
argument is the richer `CaptureOnly` mediation LLP 0097 specifies for both
fork classes; it remains honest follow-on work, not a toggle over the landed
deny path.
(The Turso row above, like Convex and Supabase, is author knowledge —
its branch/fork feature has shifted between product generations;
re-verify before citing competitively.)

## Cost shape and remaining work

The original implementation estimate is retained as a shape-of-work record.
F0a/F0b/F1 and LLP 0185's Phase-1/Phase-3 lifecycle increments landed the
local scrub/mint, `DenyAll` mediation, backup materialization, bookkeeping,
bounded lifecycle, and journal app-row receipt legs. LLP 0185 owns the
remaining program, roughly:

1. **Paved lifecycle and bounded resources** — landed 2026-08-05 (LLP 0185
   Phases 1/3): automatic expiry enforcement, product-facing recovery,
   inspection, bounded renewal, fork/byte/diff/lifetime limits, and
   concurrent cleanup/port evidence all exist with dated tests. The limit
   constants are author-ratified (2026-08-05) and the v1 containment answer
   is the documented OS-boundary guidance; an integrated sandbox/container
   tier is deliberately deferred until demand names it.
2. **Acceptance closure** — the LLP 0162 row-5 parent-write isolation
   fixture, the per-class credential/egress matrices, the VM-level and
   push-receipt bypass negatives, resource-exhaustion negatives, and a real
   macOS disk-pressure fixture all landed 2026-08-05; independent review is
   the main open leg. LLP 0164 owns the fork/diff surface legs and LLP 0165
   the journal-completeness leg.
3. **Exact diff** — adopt LLP 0164's immutable-base/first-preimage substrate and
   LLP 0165's writer-authority choke point, then add an independent net-diff
   oracle, structured domains, and bounded continuation.
4. **Richer effect mediation** — adapt LLP 0097's `CaptureOnly` ledger and
   simulated-result contract after exhaustive `DenyAll` bypass evidence.
5. **Assets and hosted targets** — prove a same-cut fork-private local asset
   tree before lifting refusal; separately research DO export/bookmark and
   container-VM implementations in F2.

Notably absent from the bill: any change to LLP 0007/0008 core mechanics.
Like LLP 0088's phase 1, this consumes existing snapshot and journal
machinery. The accepted OQ9 decision does make the dated LLP 0018/0012
ownership amendment below: canonical stream and all independently mutable
runtime/durable concerns are scoped per instance, not merely per `appId`.

## Open questions

- **OQ1 — Is the version-stream continuation decision right?**
  *Partially answered by the spike*: continuation from the fork point is
  native substrate behavior (the counter is inside the file), and
  parent/fork provably mint colliding version numbers with different
  contents, so fork-point stamping is mandatory (§Spike evidence 5).
  Residual question: an adversarial sweep for any consumer that assumes
  version numbers identify commits *across* instances — explicitly
  including the packaged comparator fixtures and backup tooling this
  repository's own workflow history names as version-number consumers —
  plus the LLP 0148 interaction (believed none — ids copy verbatim).
- **OQ2 — Egress mediation (REOPENED by round-1 review; previously
  marked resolved in error).** The initiation points are now enumerated
  (§Runtime plane) and the capture substrate exists unwired. Open: the
  wiring design itself — how an isolation policy reaches each family,
  how captured calls obtain simulated results (fail the action? return
  a capture receipt?), how the ledger is keyed for an out-of-process
  fork, and the completeness proof that no adapter initiates egress
  outside the closed set. Shared prerequisite with LLP 0097's own
  acceptance corpus.
- **OQ3 — Fork-of-fork. DECIDED for local v1 F0b 2026-08-03:** nested forks
  refuse. Keeping the registry and GC graph flat is the honest first surface;
  composition can be reconsidered with an explicit lineage/retention design.
- **OQ4 — DO fork mechanics.** Can a new coordinator DO actually be
  instantiated from another DO's PITR bookmark, or is export/import the
  only real path? Needs a spike, not an assumption.
- **OQ5 — Asset custody in F0. DECIDED 2026-08-03 (refusal), IMPLEMENTED
  as the additive path 2026-08-05:** F0 refused asset-bearing forks; LLP
  0185 Phase 5 then landed the decided additive path — a same-cut,
  digest-verified fork-private blob-tree copy, with torn cuts and
  unclassified stores/digest algorithms refusing before publication. The
  invariant survives both stages: metadata is never published while its
  physical blob tree is absent or unproven. The fork-aware shared store
  with its GC barrier remains F2. **LIVE LIFECYCLE PROVED 2026-08-06:**
  `live_fork_asset_lifecycle_is_private_gc_safe_and_exactly_reaped` uses a
  Sessions parent and derived server plus the production asset attempt, TUS
  upload, finalize, signing, serving, delete, and GC surfaces. It proves a
  fork-uploaded blob is fork-private and parent-invisible; copied and new
  assets serve from the fork; fork delete/GC leaves the parent copy intact;
  parent delete/GC leaves the fork copy intact; and both exact drop and
  deterministic reap remove the complete asset-bearing fork tree while
  preserving parent blobs.
- **OQ6 — Where does `fork` live in the surface? DECIDED for local v1 F0b
  2026-08-03:** CLI-only. The source `snapback fork` verb emits LLP 0024
  host-operation results and returns/consumes paths to LLP 0030 ready
  descriptors; no handler or public app API may fork.
- **OQ7 — The promotion path. DECIDED for this fork class by LLP 0185's
  authority boundary:** v1 derived deployments are strictly disposable and
  never promote, merge back, or clear their TTL. A copy-as-template or
  independently provisioned permanent environment would be a separate future
  product, not a lifecycle transition hidden inside `fork`.
- **OQ8 — Relationship to backup/restore.** Should fork and restore
  share one snapshot/materialize engine internally (probably yes — a
  restore is a fork that replaces its parent, and 0097's
  `MaterializedBase` is a third consumer of the same primitive), and
  does that refactor pay for itself?
- **OQ9 — The identity model. DECIDED 2026-08-03 (author): same-`appId`
  derived deployment.** Rationale: the `appId` is baked into the
  generated manifest pair, function ids, and client codegen, so a
  fork-specific `appId` would make an agent's worktree code differ from
  shipping code by an identity string — polluting exactly the diffs and
  conclusions the fork exists to produce; and the mint already mints
  the instance identity this model needs (fork id, rotated auth
  incarnation, rotated data-stream identity, fresh endpoints and
  sidecars). Fork-as-new-product remains a distinct future feature (an
  explicit copy-as-template rename op), not foreclosed. The required
  amendment follows LLP 0097's in-doc amendment pattern and is normative as
  of this RFC's 2026-08-05 acceptance:

  > **Normative amendment (effective 2026-08-05).** LLP 0018's Terms gain
  > **derived deployment**: a physically
  > separate instance of one logical app, minted from a consistent
  > snapshot by the LLP 0158 fork operation, carrying its own instance
  > identity — fork id, auth-stream incarnation, data-version-stream
  > identity, endpoints, and sidecars — while sharing the logical
  > `appId`. LLP 0018's paved-path statement that one logical app owns
  > one backend state remains the single-instance default, but its
  > ownership clauses are amended for a derived-deployment family as
  > follows:
  >
  > 1. Each derived deployment is a distinct ownership and mutation
  >    boundary. It independently owns its accepted schema manifest and
  >    migration history/receipts/locks; function manifest, handler bundle,
  >    bundle hash, and loaded generation; durable database and asset-store
  >    namespace; commit-version stream, changesets, tombstones, cursors,
  >    outboxes, subscriptions, and ephemeral rooms; auth users, sessions,
  >    providers, authorization epochs, and auth-stream incarnation; secrets
  >    and capability grants; admin authority, audit/diagnostic state, and
  >    resource limits; and backup, restore, export, import, reset, seed, and
  >    disposal operations. The fork begins from a consistent snapshot of
  >    the parent's applicable state, then any of these concerns may diverge.
  >    A schema load, function load, migration, write, credential change, or
  >    lifecycle operation in one instance must neither mutate nor satisfy a
  >    precondition for another instance.
  > 2. Every lookup, cache, lock, receipt, cursor, provider binding, local-
  >    store key, offline mutation queue, diagnostic, telemetry stream, and
  >    admin operation that could address more than one instance is scoped by
  >    `(appId, instance identity)` (or by an equivalent endpoint-plus-stream
  >    binding that resolves to exactly one such pair). The shared `appId`
  >    identifies generated schema/function compatibility; it is never
  >    sufficient authority to infer, select, reuse, or compare another
  >    instance's runtime or durable state.
  > 3. The one-canonical-commit-version-stream-per-logical-app rule (as
  >    already amended by LLP 0097 for child streams) becomes one canonical
  >    stream per *instance*; LLP 0097's child-stream amendment continues to
  >    govern within each instance. Versions and cursors from different
  >    instances are opaque and non-comparable even when their numeric
  >    counters share a fork point.
  >
  > LLP 0012's headless integration contract inherits all three clauses:
  > generated-artifact consumers may reuse the same manifest `appId` and
  > function identifiers, but treat instance identity as part of connection,
  > artifact-attestation, cache, auth, and migration identity. This is an
  > instance/runtime ownership dimension, not a new author-authored schema
  > surface. No adapter may collapse two endpoints to one deployment merely
  > because their `appId`, schema hash, or bundle hash is equal. In a context
  > where multiple instances may exist, admission or control input that names
  > only `appId` and cannot resolve exactly one instance must refuse as
  > ambiguous. Before any derived-deployment capability is published, its
  > distinct acceptance corpus must prove that schema/function loads, storage
  > writes, auth/provider transitions, migrations, and lifecycle operations in
  > either side of a same-`appId` parent/fork pair cannot select, mutate, or
  > satisfy the sibling's state.

  Residual sub-question, still open: should copied user records retain
  their identities for re-sign-in in the fork (useful for testing,
  plausible since F0b egress is refused), or be scrubbed with
  the credentials? Default assumption: retained (they are data), per
  §Design sketch.
- **OQ10 — Registry custody (partially implemented; scope narrowed by the
  round-5 fix).** The
  publication state machine now makes the fork directory self-evident
  and the registry advisory — boot safety and repair never consult it —
  so this question governs *bookkeeping* (listing, TTL scheduling,
  orphan discovery when a parent is deleted), not safety. F0b defaults the
  registry and fork directories to `<appRoot>/.snapback/forks`, while
  `--fork-root` permits an explicit shared root. Still open under LLP 0185
  Phase 2b are owner/run metadata, exact worktree binding, and orphan
  discovery across worktree or parent replacement.

## Capability registry record

On 2026-08-04, `agent_safe_derived_deployment_fork_v1` entered the closed
target-capability registry at `Experimental` maturity. Registration reserves
the additive derived-deployment fork tuple independently from LLP 0162's
storage extension and from in-app branches; it does not publish support. This
RFC's acceptance makes the identity/ownership amendment effective, but the
capability's positive predicate remains false on every target, the public tuple
remains wholly `Missing`, and the guide keeps the GAP until the capability's
distinct qualification and publication gates pass.

**2026-08-06 — fork-specific publication witness chain.** The stable receipt
at
`tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json`
now reserves, in exact order, the macOS/aarch64 lifecycle receipt, the
Linux/x86_64 lifecycle receipt, the author-ratified original bounds record,
the local asset-lifecycle evidence map, Codex- and Fable-family reviews of LLPs
0163–0165 each followed by its structured verdict history, Codex- and
Fable-family final implementation reviews of LLP 0158 each followed by its
structured verdict history, and Charlie's author-acceptance fixture. This is
the dated, digest-bound
**witness** LLP 0185 Phase 6 says the `operating.instance-forks` capability
row must point at. It is not an LLP 0113/0134 manifest publication act: the
author's Phase 0 item-6 ruling makes the LLP 0061 guide capability-index row
the local claim carrier, so `agent_safe_derived_deployment_fork_v1` remains
wholly `Missing` in every target manifest even after that guide row eventually
publishes the local claim.

Before author sign-off, the anchor stayed `withheld`, with a zero source
commit/tree/facts digest, empty `qualifiedComponents`, zero evidence digests,
and no requirement that the four future review files, four verdict histories,
or author fixture exist.
In `published`, every digest is
nonzero and matches the bytes at its fixed locator; components equal exactly
`["derivedDeploymentForkSafetyV1"]`; candidate facts equal exactly
`denyAll / notPromotable / currentHead / hostMediated`; qualification C is a
40-hex ancestor of publication HEAD; both platform receipts name C, retain the
closed `macos/aarch64` and `linux/x86_64` release identities, reproduce the
2026-08-06 author-ratified bounds, and keep every lifecycle median within its
bound. The original bounds record remains a frozen ancestor of C. Each prose
review remains required and digest-bound, but its body is never parsed for
authority. Its fixed exact-shape JSON history binds the prose path and digest,
family, contiguous round number, and reviewed commit; the highest round must
name C and record `READY`. The Codex and Fable families must remain distinct.
The author fixture has the closed
`snapback.derived-fork-author-acceptance.v1` shape, the exact line
`Charlie Cheever — accepted 2026-08-06`, the C/tree/facts/component identity,
and an exact `evidenceSha256` map for the twelve non-self evidence bindings;
the receipt binds the author fixture's own digest and closes that intentional
self-cycle break.

C-versus-P custody follows necessity, not directory. The ratified original
bounds record and the asset evidence map already exist and stay frozen in C.
The two platform receipts must be rebound to the final C, the four independent
reviews and their four structured verdict histories can happen only after C
freezes, and named-author acceptance comes last; those eleven locators are
publication-only. Of those, the two platform
JSON receipts and author fixture sit under the implementation-tree roots, so
they are also explicitly excluded from C's self-digest. The checker, Rust
mirror, fixed receipt shape/locator order, and all executable behavior must
already be in C. P may fill the fixed receipt bindings, add those eleven
evidence files, and update the ruled guide/LLP publication records plus the
anchor/carrier; it may not change executable behavior or widen the evidence
vocabulary.

**2026-08-06 — author acceptance and narrow local publication.** Charlie
Cheever accepted LLPs 0163, 0164, and 0165 after their three-round mutually
blind Codex/Fable `READY` convergence, authorized the exact dated acceptance
fixture, and confirmed that the complete claimed release-platform set is
exactly `macos/aarch64` plus `linux/x86_64`, release profile. The fixture's
SHA-256 closes the ninth receipt binding; the final carrier binds that receipt,
the exact `denyAll / notPromotable / currentHead / hostMediated` candidate,
qualification commit `0ee1fadc136e837f430556374a5842ac82069004`, and its
implementation-tree digest. The source anchor publishes the carrier, and the
LLP 0061 capability-index row now claims `operating.instance-forks` only for
the local contributor-source target at partial maturity.

This publication is deliberately narrower than the reserved manifest id.
`agent_safe_derived_deployment_fork_v1` stays wholly `Missing` in every target
manifest, and the broader agent-safe-storage aggregate, in-app Track B facts,
hosted/Cloudflare/remote targets, promotion/merge-back, and process containment
remain unclaimed. LLP 0185 Phase 6 item 2 (released-binary/npm parity) and the
normal-installation exit clause also remain open; no public-package claim is
made.

**2026-08-07 — v2 qualification publication.** Qualification commit
`ad0ad58748981010204b61eb5002e35b887a5093` has implementation digest version
`snapback:agent-safe-implementation-tree:v2` and recomputed digest
`sha256:fc6e3e58453b4700ce06c647aaef87132879e0da336e560eca834d1d42c5459a`.
The canonical lifecycle receipts bind exactly `macos/aarch64` and
`linux/x86_64`, both release profile. Each of the Codex- and Fable-family Spec
and implementation verdict histories is contiguous through round 12; all four
round-12 heads name C and are `READY`. Charlie's v2 acceptance uses the exact
line `Charlie Cheever — accepted 2026-08-06` and binds the four 12-round heads,
the complete non-self evidence digest set, the v2 implementation digest, and
the exact `denyAll / notPromotable / currentHead / hostMediated` candidate.
The dated receipt, carrier, and source anchor therefore publish the LLP 0061
`operating.instance-forks` guide row at target `local`, maturity `partial`.

The published claim is contributor-source local, finite-TTL, fail-closed,
non-promotable, and host-mediated without process or OS containment. It makes
no hosted, Cloudflare, remote, merge-back, public-package, released-binary/npm,
or normal-installation claim. LLP 0185 Phase 6 item 2 and its normal-installation
exit clause remain open. Per the author's Phase 0 ruling,
`agent_safe_derived_deployment_fork_v1` remains wholly `Missing` in every LLP
0113 target manifest; the guide row is the claim carrier. The artifacts are
unsigned and not transparency-logged, so a commit-capable actor fabricating
both reviewer histories and the named-author acceptance is outside the
guarantee. The current-state-only prose binding weakness remains disclosed in
`issues/20260807-review-prose-history-not-frozen.md`.

**2026-08-07 — publication withdrawn after wave drift.** The publication at
`7cada777b` was valid for qualification C's exact implementation digest. The
later wave changes nine covered proof/checker/metrology leaves, so the
combined-tree oracle refused instead of extending the old evidence to new
bytes. The source anchor is now `withheld`, the LLP 0061 capability row is
target `none`, and the dated receipt/carrier/reviews/benchmarks/author
acceptance are retained only as historical evidence. No fork runtime
correctness code changed. Republishing follows the LLP 0189 §Consequences
order — digest re-scope with drift gates for departing wave-shared files
first, then one fresh C against the re-scoped digest — with both canonical
platform receipts, fresh accepted review heads, and named-author acceptance;
see `issues/closed/20260807-derived-fork-publication-wave-drift-requalification.md`.

**2026-08-09 — final v3 qualification publication.** Qualification commit
`04332ab8b73799bd3279b3150dbd8598df275530` binds scoped implementation
digest `sha256:42d8fdccbe42ed3699da014f1c3ec68aa8fd05ca99de423310b6a6885190708f`
and the qualification-time selection-policy digest
`sha256:9221291f95c690d455be3240b342010216b7e1b470cf21aba53104408a3f9075`.
The complete seven-round requalification sequence is frozen into all four
Codex/Fable Spec and implementation histories: requalification rounds 1–3,
final, close, publication-C, and publication-C2. The publication-C round is
split (`Codex NOT_READY`, `Fable READY`); publication-C2 converges dual
`READY` at exact C. The dated macOS/aarch64 and Linux/x86_64 receipts bind C,
the dated bounds locator retains the ratified 2026-08-06 values, and Charlie's
exact `Charlie Cheever — accepted 2026-08-09` author line binds the complete
v3 evidence and history-head set.

The source anchor and LLP 0061 `operating.instance-forks` row therefore return
to `published` and target `local`, respectively, for only the partial
contributor-source claim on those two platforms. Fleet commits after C changed
scoped source, so LLP 0189 D-3 custody honestly reports
`PUBLISHED_REQUALIFICATION_DUE` while the claim stands. Per LLP 0189 D-4, the
local persistent-store carrier/anchor and the relation/activity and
sequence-allocation carriers are not rebound or restored by this publication;
their separate frozen-record gates own their integrity. The target-manifest
tuple remains wholly `Missing`, and released-binary/npm parity,
normal-installation, public-package, hosted/Cloudflare/remote, merge-back, and
process-containment support remain explicit nonclaims.

## Status

**Accepted 2026-08-06.** F0a, F0b, and F1 implement the local safety
substrate, CLI consumer, dated fleet dogfood, guide, fork-aware harness, and
the LLP 0185 lifecycle/resource-bound increments, concurrent agent/worktree
ergonomics, first exact net-diff slice, fork-private asset custody, and the
post-acceptance durability/recovery corrections. Remaining Phase-4 filters,
pagination, human projection, operation attribution, broader-domain/storage-
wide completeness, and F2 hosted work stay open under LLP 0185. The local
app-row net diff's authorizer-backed completeness slice is recorded above.
Acceptance records the approved design, the
same-`appId` derived-deployment amendment, and the landed local substrate. The
2026-08-07 publication was withdrawn after covered wave drift. The final v3
qualification and acceptance on 2026-08-09 now publish the LLP 0061
`operating.instance-forks` row at target `local` for the narrow
contributor-source claim, with post-C scoped evolution visibly marked
`PUBLISHED_REQUALIFICATION_DUE`. The separately reserved
`agent_safe_derived_deployment_fork_v1` target-manifest predicate remains
wholly `Missing`; released-binary/npm, normal-installation, hosted,
promotion/merge-back, process-containment, and broader storage claims remain
open or explicitly unclaimed.
The earliest local-only `clonefile` validation and its corrected claim remain
in §Spike evidence. The same-day 0097 reconciliation narrowed the claimed
territory. A
six-round dual-family super-refine loop ran the same day and
**converged dual-READY at v0.11** (Fable READY rounds 2–4; Codex READY
round 6 after a strictly shrinking defect set — 4 blockers + 6 majors in
round 1 down to clean; two convergent cross-family findings; artifacts
under `llp/reviews/0158-instance-forking.{claude,codex}.md`). Both
families' shared closing guidance authorized the now-landed F0a after OQ9's
author decision. The author made the Draft → Review transition on
2026-08-05 (LLP 0185 Phase 0 item 2) and accepted the document on
2026-08-06 after the loop converged (round-2 findings all resolved,
round-3 delta READY).

**Acceptance basis.** All three graduation criteria hold:

1. **A named first consumer exists for a residual use case** — one that
   an implemented LLP 0097 branch cannot serve (§Relationship to
   LLP 0097): schema/function-divergent rehearsal, a cross-host or
   cross-trust-boundary environment, or whole-app operator checkpoint.
   Named means the pattern that graduated 0097 itself (Exact LLP 0390
   was its consumer): a specific workflow, demo program, or product
   surface with a concrete ask — not a category of plausible users.
   *Status of this criterion:* **PINNED 2026-08-03 (author)** — the
   first consumer is this repository's own agent fleet, adopting
   fork-per-worktree for demo-application development (the pain is
   already documented in this repo's operational history: stale servers
   on fixed ports, sessions trampling shared dev databases). Exact's
   agents are the anticipated second demand signal, not a gate.
   Verification remains empirical: the criterion completes when the
   fleet actually uses F0 in anger and a diary entry records the
   experience (LLP 0016's loop). Ticket:
   `issues/closed/20260803-0158-first-consumer-fleet-dogfood.md`.
   **Completed 2026-08-03:** Diary 0054 records two simultaneous Todo
   worktrees forked from one live parent, with different function bundles,
   isolated writes, app-row diff receipts, and exact disposal.
2. **The migration-rehearsal gap is real** — a comparison of the
   fork-based flow against LLP 0081's implemented restore-derived
   rehearsal shows the fork adds workflow value (whole-app rehearsal,
   ergonomics, speed) rather than duplicating an existing paved path.
   *Per the author's 2026-08-03 direction, this is folded into
   criterion 1's first real use rather than run as a separate study.*
   **Completed 2026-08-03:** the diary comparison found the fork additive:
   it is a lightweight whole-app, function-divergent development loop, while
   LLP 0081 rehearsal remains the stronger approved-plan/backup-bound proof
   consumed by production migration admission.
3. **The safety corpus passes (F0a)** — the F0a corpus in full
   (§Implementation path): the credential negatives, the parent-signed
   asset URL refusal, the crash-cut publication tests, and the `DenyAll`
   refusal legs including S3/provider I/O under inherited
   env credentials. No safety claim in this document graduates on
   design alone. **Completed 2026-08-03:** the custody, credential-negative,
   publication/recovery crash-cut, asset-refusal, and deny-all egress corpora
   are green, including fail-closed treatment of unknown future custody and
   host-op classes.

The earlier fold fallback did not fire: the completed first-consumer diary
demonstrated schema/function-divergent, out-of-process value beyond LLP 0097's
in-app branch. All three empirical graduation criteria are satisfied. The OQ4
DO-bookmark spike is F2 hosted work, while OQ2's `CaptureOnly` residual and
bypass closure are sequenced by LLP 0185/0164 rather than conditions of this
design acceptance. The author made the Draft → Review transition on
2026-08-05 and accepted the document on 2026-08-06. Neither the OQ4/OQ2
residuals nor the landed F0b `DenyAll` implementation may be advertised before
its own qualification and publication gate.
