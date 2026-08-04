# LLP 0158: Instance forking

**Type:** RFC
**Status:** Draft
**Systems:** Storage, Deployment, Runtime, Scheduling, Assets, Security, Agent experience, Developer experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-03
**Revised:** 2026-08-04 (v0.17 — managed in-app branches now apply the same
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
lifecycle-generation bump (`src/assets_cut.rs` restore-epoch fence)
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
unwired, per `src/server.rs`'s own annotation, and its keying needs
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
**Related:** LLP 0007, LLP 0008, LLP 0018, LLP 0027, LLP 0028, LLP 0036, LLP 0044, LLP 0049, LLP 0070, LLP 0081, LLP 0083, LLP 0088, LLP 0097 (ephemeral data branches — the implemented in-app sibling this RFC must position against), LLP 0099, LLP 0139, LLP 0146

> **Experimental.** This RFC explores a capability. It commits no
> implementation, no schedule, and no priority relative to the accepted
> program work (LLP 0130's wave, LLP 0155's local-sync lanes). It exists so
> the design space is thought through once, on paper, before anyone builds
> anything — and so that if the answer is "not now," the reasoning is
> recorded rather than re-derived.

## Summary

Should Snapback support **forking a logical app** — producing a new,
independent instance whose data starts as a consistent snapshot of an
existing one (copy-on-write-cheap when the parent is cold; a consistent
full copy via the backup primitive when it is live)? This RFC argues the capability is distinct from, and far
cheaper than, the record-level branching that
[LLP 0088](./0088-record-history-and-branching.rfc.md) deferred: a fork is a
whole-instance operation that lands exactly on the logical-app boundary
[LLP 0018](./0018-app-instance-boundaries.rfc.md) already defines, so none of
the sync-core invariants (single per-app gap-free version stream, LLP 0007
DK-2) acquire a branch dimension. The interesting design work is not the
database copy — measured effectively free for a cold parent on SQLite,
an unmeasured full copy live — but the **runtime plane**:
what a fork does about scheduled work, outbound side effects, secrets,
sessions, and the asset store. Because Snapback owns the runtime as well as
the data, a Snapback fork can be a whole-*backend* fork, which is both the
hard part and the reason it would be more valuable than what
database-only vendors ship.

The recommended posture, if this is ever pursued: **throwaway-first**.
Forks are cheap, quarantined, disposable rehearsal environments with a
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
rogue-agent worry (no parent credentials, disposable data, captured
effects); containing a rogue agent *process* additionally requires OS or
container isolation (§Threat model). It is also the git-worktree
analogy made literal — agent fleets already fork the *code* per worktree
(this repository's own development runs that way); the fork gives each
worktree a matching backend.

Concrete workflows a fork would serve, in rough order of conviction:

0. **Agent-parallel product development** (the primary case, per the
   ask above). Each agent gets `fork → own port, own database, own
   admin token, no secrets, paused scheduled work, captured egress`,
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
4. **Operator undo / "snap back."** A pre-operation fork is a checkpoint
   the operator can promote if the operation goes wrong. This overlaps
   backup/restore (LLP 0007's byte-level snapshot) and is the weakest
   independent justification — restore already exists — but the product
   name is sitting right there.

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
`src/branches.rs`; strict `DenyAll` replay promotion now lives in
`src/fork_promotion.rs`, while `CaptureOnly` product mediation remains unbuilt.
No server, CLI, or client path consumes the in-app branch surface yet
(`src/server.rs` annotates its diagnostic code "Not yet wired into any
request path"), and 0097's own claim boundary keeps the capability
`Missing` until its acceptance corpus passes. The distinction the round-1
reviews forced: **accepted design** and **landed substrate** are both
real, but neither is a **product-wired capability** — which matters for
both what 0097 serves today (nothing yet) and what this RFC can claim to
reuse (designs and library primitives, not working mediation).

The two capabilities are different points on one isolation axis:

| | LLP 0097 branch (substrate landed, unwired) | LLP 0158 fork (this RFC) |
| --- | --- | --- |
| Boundary | Ephemeral child *inside* one logical app's trust boundary | A separate instance — new logical app or derived deployment, identity model open as OQ9 (LLP 0018) |
| Schema / function bundle | **Shared with parent** — a branch cannot diverge them | Fully divergent — fork can run a different app version |
| Version stream | Typed child stream, never numerically comparable to canonical (0097's 0007/0018 amendment) | The fork's own canonical stream: same numbering space continuing from the fork point, **new stream identity** minted so cursors cannot cross (§Design sketch; §Spike evidence 5) |
| External effects | Captured as durable intents, settle on promotion | No promotion — quarantined outright (§Runtime plane, reusing 0097's mediation) |
| Merge-back | Staged promotion by re-execution, one canonical transaction | **None** (non-goal) |
| Placement | Lives inside the parent server process | Independent process/host; physically portable (clone-to-laptop, clone-to-another-machine) |
| Cost per instance | Overlay + child stream — cheap, many-at-once (N live futures) | One clonefile + a boot — cheap locally, heavier hosted |
| Trust posture | Cooperating-not-adversarial (0018) | Separate app; suitable when the experiment must not share the parent's trust boundary |

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
- **The quarantine reuses 0097's *contract*, and shares its unbuilt
  prerequisite.** 0097's branch egress mediation and `CaptureOnly`
  effect ledger (LLP 0070 idiom) are the effect-isolation design a fork
  applies in a *capture-only, never-settle* posture (no promotion exists
  to settle into). But 0097 itself names exhaustive host-egress
  mediation a **prerequisite it defines, not something that exists**,
  and the wiring from live egress ops into the ledger is net-new for
  either consumer; the ledger's keying (`capture_effect` requires a
  branch child-stream row) also needs adaptation for an out-of-process
  fork. Whichever of 0097-wiring or 0158-F0 lands first builds the
  mediation seam the other then reuses.
- **The version-stream stories are compatible, not competing.** 0097's
  amendment governs child streams *within* one logical app. A fork is a
  separate instance owning an ordinary canonical stream; continuation from
  the fork point (observed native in §Spike evidence) violates nothing
  in the amendment. But the co-existence should be stated in whichever
  document graduates first.
- **A legitimate outcome of this RFC is a fold, not a feature.** If the
  residual set is thin, the right landing may be a dated amendment to
  LLP 0097 rather than a standalone capability — concretely, a **shared
  snapshot/materialization engine**: 0097's `MaterializedBase` already
  snapshots a source database into a fresh, atomically consistent
  database file via SQLite's backup primitive (`src/branches.rs`), which
  is the storage half of a heavy fork; what would remain 0158-specific
  is the instance-identity scrub/mint and quarantine layer. §Status's
  graduation criteria make this concrete.

### Why this is still not LLP 0088 reopened

LLP 0088 §3's deferral of *record-level* branching was answered by
LLP 0097 for the in-app case under 0088's own revisit trigger. This RFC
introduces no branch identity inside any data model and no further
change to the 0007/0018 stream contracts: the fork is a **separate
instance** — its own schema copy, its own canonical stream, its own
auth namespace after the scrub-and-mint — whether OQ9 lands on "new
logical app" or "derived deployment." Parent and fork share history
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
- **Long-lived divergent forks as a paved path.** Nothing prevents keeping
  a fork alive (it is an ordinary instance), but the design center is
  minutes-to-days disposable environments. Long-lived forks inherit the
  full cost of being a real environment (secret rotation, migration
  drift), and this RFC deliberately does not smooth that path.

## Design sketch

### The fork operation

`fork(parent_app, options) → new instance` (a new logical app or a
derived deployment of the same one — the identity model is OQ9 and all
pre-OQ9 language here is identity-neutral) with, at minimum:

- **A consistent snapshot boundary.** The fork captures the parent at a
  single committed version — the same consistency class as LLP 0007's
  byte-level snapshot for backup/restore. The parent's commit version at
  the snapshot becomes the fork's recorded **fork point**, stamped in
  both directions (parent lists its forks; fork records its parent and
  fork-point version) for diagnostics and diff derivation.
- **A transactional scrub-and-mint — not a rotation.** The spike showed
  identity is inherited through the clone; the round-1 reviews showed
  the initially proposed fix (rotate the auth-stream incarnation) is
  **insufficient**: sessions and agent credentials resolve by unkeyed
  token-hash lookup against rows *inside the cloned database*
  (`src/auth/crypto.rs` `hash_bearer`; `src/auth/session_projection.rs`),
  a rebooting fork re-projects those rows under the new incarnation and
  admits parent tokens; resume tokens never consult the auth incarnation
  at all (they bind `appId`, manifest generation, data-stream identity,
  and a separate resume keyring, LLP 0091). The codebase's own precedent
  is `app.reset`, which rotates the incarnation *in the same transaction
  that deletes auth state*. The fork mint is therefore one transactional
  operation over a **custody manifest** — every DB-resident credential
  class and every sidecar file gets an explicit rule (`copy`, `scrub`,
  `rotate`, `share`, or `refuse`; an unknown custody class fails fork
  creation): terminate/delete copied sessions and token families, revoke
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
  manifest's completeness must be **mechanically enforced, not
  precedent-derived**: a build/test-time sweep over every `_snapback_*`
  and `_auth_*` table (and every sidecar naming convention) that fails
  when a new system table lands without a custody classification.
  (`app.reset`'s deletion sequence is a useful precedent but provably
  incomplete — it omits the durable-jobs tables — so it cannot be the
  authority; round-2 review caught this document briefly claiming
  otherwise.) **No invalidity claim in this document is asserted until a
  negative-test spike presents parent session, agent, and resume
  credentials to a minted fork and sees all three refused.** The logical
  `appId` is kept in v1 (manifest-bound); whether that makes the fork a
  "derived deployment" rather than a new logical app is OQ9.
- **Crash-safe mint publication — a fork is never bootable unminted.**
  The scrub-and-mint cannot be "the clone, then some fixes": between
  clone and scrub, the copy is a bootable database that accepts copied
  credentials, and a crash in that window leaves it lying around
  permanently dangerous. And sidecar placement compounds it: the resume
  keyring is **directory-scoped** — the production path is
  `database_path.with_file_name("resume-keyring.json")`
  (`src/local.rs`; `RESUME_KEYRING_FILE_NAME`, `src/rqs.rs`), one
  keyring per directory — so a fork cloned into the parent's directory
  would *share the parent's live resume keyring*.
  The publication protocol is an explicit **state machine** (rounds 3–4
  of review each caught an ordering hole in looser prose versions —
  first a clone-before-stamp bootable window, then an unspecified
  transition to bootability; the states and transitions below are the
  design, and every refusal behavior named here is **F0 work to build —
  none of it exists in `snapback start` today**):

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
  - **S5 live.** Reconciliation: registry row finalized, then the
    sentinel is removed (and parent fsync'd) — clear-after-rename is
    the one fail-closed ordering.

  **Recovery resolves every crash toward the rename's verdict, from
  local evidence alone:** the published directory is self-evident — it
  carries the lineage stamp, the mint receipt, and the sentinel — so
  repair completes or reaps **without consulting the registry**:
  staging present in S0–S3 → reap (staging is disposable; an intent row
  without a published directory means not-committed); published
  directory still sentinel-bearing (S4) → verify the lineage stamp,
  finalize the registry *if reachable*, remove the sentinel; published
  directory without a finalized row → finalize when the registry is
  next available. The registry row is **advisory bookkeeping** (listing,
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
- **A version-stream decision.** The fork's stream should **continue the
  parent's numbering from the fork point** rather than restart at zero:
  it keeps `_version` values in copied rows meaningful, keeps the
  journal's retained window usable for post-fork diffs, and costs
  nothing mechanically (the counter is in the file). One OQ9 consequence
  the round-3 review surfaced: LLP 0018 currently pins the stream as
  per-*logical-app* — under OQ9's derived-deployment branch, parent and
  fork would be two instances of one logical app with independent
  streams, so the OQ9 amendment must widen 0018's one-stream-per-app
  clause to per-instance, not just the identifier scoping. Restart-from-zero would
  require rewriting `_version` on every copied row or breaking the
  monotonic-stream contract. The spike confirmed continuation is what
  the substrate does natively — the version counter lives inside the
  database (`_snapback_version`), so a cloned file continues from the
  fork point without any code (§Spike evidence). One split to state
  precisely: numbering continuation is **not** cursor validity — the
  scrub-and-mint rotates the *data-stream identity* (resume tokens MAC
  the stream identity, `src/rqs.rs`; `rotate_data_version_stream_in`
  exists in `src/storage/auth_invalidation.rs`), so parent resume and
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
separate instance** (identity model per OQ9), with per-target
implementation quality — the same
capability-contract pattern LLP 0007 uses for snapshot/restore. Speed is a
quality-of-implementation property; correctness (consistent boundary,
independent streams) is the contract.

- **Local SQLite (the shipped default).** Two paths by parent state.
  *Cold parent* (no server holds the instance lock): the CLI **acquires**
  the lock — acquisition, not observation, or a starting server races
  the clone window — then checkpoints and clones; on APFS `clonefile(2)`
  is an O(1) copy-on-write clone, Linux gets reflinks, `VACUUM INTO` is
  the everywhere-fallback. *Live parent*: reuse the consistency primitive
  0097's `MaterializedBase` already implements — SQLite's backup API
  snapshots the source into a fresh database, atomically consistent with
  a recorded version, while the source keeps committing
  (`src/branches.rs`). That is a full copy, not O(1); whether a faster
  quiesce+clonefile protocol is worth proving (write-gate custody, WAL
  readers, partial-destination cleanup, crash boundaries) is measured
  later, not asserted — no latency claim for the live path until then.
  Either way, no diff machinery is needed to *create* a fork; diffs earn
  their keep elsewhere (§Diff surface).
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
fork (the `EffectClass::classify` posture in `src/branches.rs` is the
pattern), and new outbound adapters must declare fork behavior to land.
Proposed defaults, each overridable explicitly:

| Concern | Default in a fork | Rationale / mechanism |
| --- | --- | --- |
| Cron (LLP 0028) | Copied but **paused** — autonomous claiming off (`SNAPBACK_CRON_DISABLED`) | Never double-execute the parent's schedule. Note: the *admin manual tick* still claims and executes due runs — a deliberate rehearsal affordance ("fire this cron job in the fork on purpose"), documented rather than discovered. |
| Durable background work (LLP 0070) | Copied but **paused** (`SNAPBACK_JOBS_DISABLED`); pending `runAfter` work visible and inert | Same double-execution rule; admin forced-drain remains as the deliberate override, same caveat as cron. |
| Asset maintenance worker | **Off** (`SNAPBACK_ASSET_RUNNER_DISABLED`) — the third autonomous worker, easy to miss | An asset-bearing fork must not run ledger work or GC sweeps against a store it may share or lack (§Asset plane). |
| Maintenance egress (push-receipt polling) | **Off / captured — mechanism NET-NEW**, unlike the three worker rows above: no `SNAPBACK_*_DISABLED` switch exists for this lane; it runs inside the unconditional maintenance worker whenever the app declares a push ledger | The general maintenance loop polls Expo push receipts over the network — autonomous egress that is not handler-initiated and must be enumerated on its own row. |
| Handler egress — the enumerated op families: buffered `ctx.fetch` (`host.fetch`), `push.send`, `action.streamOpen/Read/Cancel` (`ctx.fetchStream`), and effects deferred via `jobs.enqueue` | **Captured, never fired, never settled** — LLP 0097's capture-don't-fire contract in capture-only mode; any op outside the closed set refuses | This is *not* one seam: the reviews found at least four initiation families in the runtime dispatch (`src/runtime.rs`). The wiring from these ops into 0097's ledger is net-new (§Implementation path). A rehearsal that emails real users is a defect. |
| Asset-provider I/O (`SNAPBACK_ASSET_STORE=s3`) | **Refused in a fork by default** — the S3 store reads `SNAPBACK_ASSET_S3_*` env credentials and performs direct HTTP on the *request path* (uploads, delivery), entirely outside the worker switches; a fork boot ignores inherited provider env unless explicitly opted in | Provider asset I/O is egress the worker-pause rows do not touch; its env credentials are custody-manifest entries like any other credential (round-2 review finding). |
| Webhook / callback ingress | Fork endpoints **receive nothing by default** — no parent-registered callback routes to a fork; ingress-triggered handlers follow the egress rules above if invoked deliberately | Ingress is a separate class from egress and needs its own deny-by-default statement. |
| Secrets (LLP 0036 config values) | **Not copied — free by construction**: values live in a 0600 sibling `*.config.json`, never inside the database; copying is the explicit `--with-secrets` opt-in | LLP 0036's file placement makes the safe default zero-cost. The *broader* credential custody (DB-resident validators, push device tokens, asset signing material, keyring sidecars, `SNAPBACK_ADMIN_TOKEN` env inheritance) is governed by the custody manifest (§Design sketch), not by this row. |
| Auth sessions / tokens / agent credentials | **Terminated by the scrub-and-mint** (§Design sketch) — not by incarnation rotation alone; user *records* are copied as data | Copied accounts are data to test against, not live credentials into the fork. Unproven until the negative-test spike passes. |
| Telemetry / export surfaces | Local-only by default; no export destination inherited | Telemetry export is not autonomous egress but *is* a data-export path; enumerate it rather than assume it. |
| Admin access | Forker gets a **fresh minted** admin token on the fork (never the parent's, and never an inherited `SNAPBACK_ADMIN_TOKEN` env) | The fork is their sandbox; admin on the fork grants nothing on the parent. |
| Live clients | None; the fork starts with zero subscribers; rotated data-stream identity keeps copied resume/search cursors from crossing | Clients must connect explicitly and distinguish instances by endpoint + stream identity, not `appId` (OQ9). |

This matrix is the substance of the capability. Neon, Turso, and
postgres.ai stop at the database because they *have to*; their users
rebuild the side-effect quarantine by hand per app. Snapback shipping the
quarantine as the default is the differentiated work — and it is honest
work, not a toggle: the mediation seam it needs is the same one LLP 0097
names as its own unbuilt prerequisite.

### Threat model — what a fork does and does not contain

The round-1 reviews converged on this needing to be explicit. Three
capability tiers, none implying the next:

1. **DataIsolated** (local F0 delivers this): the fork's writes,
   migrations, and resets land in a disposable copy; the agent holds no
   parent credentials; parent data is untouched *by anything routed
   through the fork*. This is protection against **accidents and bugs**,
   and it is what the cooperating-not-adversarial posture of LLP 0018 /
   LLP 0097 already assumes.
2. **HostEgressMediated** (F0's quarantine matrix, once the wiring
   lands and the bypass corpus passes): handler and maintenance egress
   from the fork's runtime is captured or refused, so rehearsals cannot
   fire real external effects.
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
(`src/assets.rs`), and the local blob store is rooted in an `assets/`
directory **beside the database** (`src/local.rs`). Consequences for a
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
not bind an instance identity (`src/assets.rs`), so the mint must
invalidate parent-signed URLs — by rotating the fork's signing keys,
by the **lifecycle-generation bump** the asset-cut import already
implements and tests (its restore-epoch fence bumps every generation
past the manifest's so old-epoch signed URLs cannot validate,
`src/assets_cut.rs`), or both — and F0a's corpus includes the negative
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
  deliberately bypasses the app journal (protected lane, `src/local.rs`);
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

Cheap creation without cheap deletion recreates the unbounded-history
trap LLP 0088 §5 guarded against, one level up. Proposed: every fork
carries a **TTL at creation** (finite, default short, extendable
explicitly), forks are first-class listable objects on the parent
(`snapback fork list`-shaped surface, inspectable per LLP 0017's
conventions), and expiry reaps compute and storage — plus, *if* the
F2-era shared asset store (§Asset plane option c) ever exists, its GC
barrier; under F0's custody options (refuse, or fork-private tree) there
is no cross-instance asset coupling to reap. **No un-TTL'd fork in v1.**
Promoting a fork to a permanent app is an explicit graduation that
clears the TTL (and, under option c only, re-establishes independent
asset custody).

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
   start the fork with startup artifacts; the current demo-harness
   launch sequence already does the former.
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

A code-level seam inventory, corrected by the round-1 cross-family
reviews (both reviewers independently verified or falsified each row —
the honest split is *storage plane mostly exists; quarantine and
identity are real new work*):

| Piece of the fork | Status | Where |
| --- | --- | --- |
| O(1) consistent copy (cold parent) | **Proven** (spike) | APFS `clonefile` / reflink / `VACUUM INTO` fallback |
| Consistent copy (live parent) | **Substrate exists** — SQLite backup primitive with atomically consistent recorded version, as 0097's `MaterializedBase` implements; full copy, unmeasured latency | `src/branches.rs` |
| Boot a clone as a working backend | **Proven** (spike) | `snapback start --db <clone>` |
| Function manifest into the fork | **Proven** (spike); dev agents run their *own* `snapback load` with their modified manifests anyway | `snapback load` |
| Scheduled-work pause: cron | **Built** — boot switch; autonomous claiming only (admin manual tick remains, as a documented rehearsal affordance) | `--cron-disabled` / `SNAPBACK_CRON_DISABLED` (`src/cli.rs`) |
| Scheduled-work pause: durable jobs | **Built** — sibling switch; pending work visible but inert; admin forced-drain remains | `SNAPBACK_JOBS_DISABLED` (`src/server.rs`) |
| Asset-runner pause | **Built** — the third autonomous worker's switch, which F0 must also set | `SNAPBACK_ASSET_RUNNER_DISABLED` (`src/server.rs`) |
| Config-secret non-inheritance | **Free by construction** — values in a 0600 sibling `*.config.json`, never in the database (LLP 0036 D1/D2) | `src/config.rs` |
| Admin-token isolation | **Free by construction** — per-database minted sibling; F0 must also guard against an inherited `SNAPBACK_ADMIN_TOKEN` env suppressing the fresh mint | LLP 0017 auto-mint; `src/admin.rs` |
| Effect capture (egress quarantine) | **Design owned by 0097; wiring NET-NEW.** The ledger and types exist in `src/branches.rs` but nothing outside that module consumes them; the runtime has at least four egress-initiation families to mediate (`host.fetch`, `push.send`, `action.streamOpen/…`, `jobs.enqueue` deferral) plus maintenance receipt-polling; `capture_effect`'s keying (branch child-stream row) needs adaptation for a fork | `src/runtime.rs`, `src/server.rs`, `src/push.rs`, `src/branches.rs` |
| Identity scrub-and-mint | **Real new work** — one transactional operation over the custody manifest (§Design sketch): terminate copied sessions/token families, revoke agent credentials/grants, rotate auth incarnation (`rotate_authorization_version_in` exists, `src/storage/auth_stream.rs`) *and* data-stream identity, fresh resume keyring + admin token, fork stamp; effectiveness unproven until the negative-test spike | `src/storage/auth_stream.rs`, `src/auth/*`, modeled on `app.reset`'s delete-plus-rotate transaction (`src/storage.rs`) |
| Asset custody | **F0 decision required** — refuse asset-bearing forks or reflink a fork-private `assets/` tree (§Asset plane); shared-store indirection is F2 | `src/local.rs`, `src/assets.rs`, `src/assets_store.rs` |
| Fork registry, TTL, reaping | **New**, but mirrors the implemented `_snapback_branches` registry/lifecycle pattern; registry authority when the parent is offline/deleted is OQ10 | modeled on `src/branches.rs` |
| Diff receipt | **Proven** (spike) for app-row changes; coverage metadata and the retention-pin question are new (§Diff surface) | `_snapback_changes` |
| Port/endpoint isolation | **Free** — port scan + ready files | existing launch path |

Two design points the inventory surfaces:

- **Identity, precisely — and OQ9.** The `appId` is baked into the
  generated schema/functions manifest pair and validated on load
  (`pair.schema.appId`), so a v1 fork keeps the logical `appId` — like a
  git clone keeps the project name — and gains instance-level identity:
  fork id, rotated auth *and data-stream* identities, fresh sidecars,
  fresh endpoints, fork-point stamp. The Codex review is right that this
  strains LLP 0018 as written (0018 makes `appId` *the* identifier that
  scopes local-store keys, diagnostics, and telemetry — two live
  instances sharing it can mix client-side state). The candidate
  resolutions — mint a new `appId` and rebind the manifest pair, or
  define the fork as a **derived deployment** of the same logical app
  with an instance identity threaded through credentials, cursors,
  local-store keys, and telemetry — both require a dated LLP 0018 (and
  likely 0012) amendment. Recorded as **OQ9**; F0 cannot ship before it
  is decided.
- **Forking a *live* parent.** `clonefile` of a database mid-write, with
  a separate WAL, is not a consistent pair — and `src/instance_lock.rs`
  provides ownership and metadata, not a checkpoint primitive. Cold
  path: *acquire* the lock (not observe it — TOCTOU), checkpoint, clone.
  Live path: the backup-API materialization above, through the server as
  a host op with real authorization, destination validation, and crash
  cleanup. No latency claims for the live path until measured.

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
  sources take option (a), `SNAPBACK_FORK_CUSTODY_REFUSED`, until F0b/F1 owns
  a same-cut private-tree copy. F0a is complete; F0b subsequently landed the
  first consumer surface recorded below.
- **F0b — the local fork verb:** `snapback fork create
  [--from <db|ready-file>] [--ttl 2h] [--with-secrets] [--app-root <dir>]`
  → copy (cold or live path), scrub-and-mint, registry row with TTL,
  boot with all three worker switches + `DenyAll` egress, ready file
  out (LLP 0024 envelope); `fork list`, `fork diff` (the receipt),
  `fork drop`, TTL reaping; asset custody per the F0 decision
  (refuse or fork-private tree).
  **Implementation record — 2026-08-03:** implemented as the source CLI over
  the F0a `instance_fork` module. Every managed fork has a finite expiry,
  same-`appId` lineage and independent auth/data-stream identities; default
  secret custody scrubs the config sibling and `--with-secrets` is the only
  copy opt-in. The child runtime publishes an LLP 0024 `hostOpsResult` plus a
  ready file, disables cron/jobs/assets, and inherits the F0a `DenyAll` gate.
  Asset-bearing parents still refuse under OQ5 option (a). List/drop/reap use
  UUID-bound advisory registry entries that must re-bind to the exact regular
  direct-child destination, mint receipt, database lineage, and ready file
  before read/signal/delete; an unverified possibly-live PID refuses. Reaping
  takes a portable-range injected clock. The app-row diff pins floor/head/rows
  in one read transaction and refuses if retention passed the fork point.
  Copied history drops parent-only operation ids when their ledger is scrubbed.
  The automated managed-lifecycle and executable CLI tests plus the dated fleet
  record at
  `tests/acceptance/instance-fork-fleet-dogfood.2026-08-03.v1.json` are green.
- **F1 — agent ergonomics:** fork-per-worktree conventions, the diff
  receipt as a first-class review artifact, guide page + capability
  index row, acceptance-suite fork-instead-of-seed option.
  **Implementation record — 2026-08-04:** `guide/operating/instance-forks.md`
  teaches the finite-TTL worktree workflow and its quarantine, custody, diff,
  lifecycle, and threat-model limits. `demos/_kit/instance-fork.mjs` consumes
  the exact CLI lifecycle and `openHeadlessApp({ forkFrom, forkRoot,
  forkTtl })` opts out of seeding while loading the current worktree's
  generated manifests. The maintained Todo fork-aware acceptance suite proves
  parent-state preservation, inert/deny-all creation facts, one bounded
  fork-only app-row diff, live-parent invisibility, and cleanup through
  registry-bound `fork drop`. The capability row deliberately remains an
  unpublished target-`none` GAP while this RFC is Draft.
- **F2 — hosted:** the OQ4 DO-bookmark spike decides bookmark-fork vs
  export/import on Cloudflare; container-VM rides Fly volume forks
  (LLP 0099) and adds the ProcessContained tier (§Threat model);
  fork-aware shared asset store. Only after F0/F1 demonstrate use.

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

None of the external systems fork the *runtime posture* — scheduled
work, egress, secrets — because none of them own it. Snapback has the
accepted design and landed substrate for exactly that posture (LLP 0097's
effect isolation), but not yet the wiring. The differentiation argument
for a Snapback *instance* fork is therefore "build the mediation seam
0097 already specifies, once, for both consumers" — still a genuine
moat relative to database-only vendors, but honest work, not a toggle.
(The Turso row above, like Convex and Supabase, is author knowledge —
its branch/fork feature has shifted between product generations;
re-verify before citing competitively.)

## What this would cost

Not estimated in engineering detail (deliberately — experimental status),
but the shape of the bill, roughly ordered:

1. **Egress mediation wiring** — threading an isolation policy through
   every outbound-initiation family (`host.fetch`, `push.send`, the
   `fetchStream` ops, `jobs.enqueue` deferral, maintenance
   receipt-polling) into 0097's capture ledger, with fail-closed
   refusal of anything unclassified, plus the ledger-keying adaptation.
   The single biggest item; shared with (and specified by) LLP 0097.
2. **The identity scrub-and-mint** — the custody manifest over every
   DB-resident credential class and sidecar, the transactional
   terminate/revoke/rotate operation modeled on `app.reset`, and its
   negative-test corpus. Second biggest.
3. **Fork bookkeeping** — fork-point stamping, parent/fork registry,
   TTL/reaping, admin/inspection surface, the asset custody decision.
4. **The copy paths** — cold-parent path proven; live-parent path rides
   the existing backup primitive; DO (bookmark-fork or export/import)
   and container-VM are F2.
5. **Diff receipts** — a read over existing journal machinery plus a
   receipt format LLP 0081 already prototypes, extended with coverage
   metadata and possibly a per-instance retention pin.

Notably absent from the bill: any change to LLP 0007/0008 core contracts.
Like LLP 0088's phase 1, this consumes existing machinery (snapshot,
journal, per-app streams) rather than amending it — the strongest
structural argument that the capability is priced correctly.

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
- **OQ5 — Asset custody in F0. DECIDED for local v1 F0a 2026-08-03:**
  refuse asset-bearing forks. A fork-private reflinked tree remains the
  additive path for F0b/F1 once its same-cut proof exists; the fork-aware
  shared store with its GC barrier remains F2. This is intentionally the
  cheapest honest posture: metadata is never published while its physical
  blob tree is absent.
- **OQ6 — Where does `fork` live in the surface? DECIDED for local v1 F0b
  2026-08-03:** CLI-only. The source `snapback fork` verb emits the LLP 0024
  host-operation/ready envelopes; no handler or public app API may fork.
- **OQ7 — The promotion path.** Is fork-graduation (throwaway → real
  environment) in scope at all, or is v1 strictly disposable with
  promotion deferred until preview-environment demand is concrete?
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
  amendment follows LLP 0097's in-doc amendment pattern
  (proposed-normative here; effective when this RFC is accepted):

  > **Amendment (proposed-normative; effective on acceptance of this
  > LLP).** LLP 0018's Terms gain **derived deployment**: a physically
  > separate instance of one logical app, minted from a consistent
  > snapshot by the LLP 0158 fork operation, carrying its own instance
  > identity — fork id, auth-stream incarnation, data-version-stream
  > identity, endpoints, and sidecars — while sharing the logical
  > `appId`. Two clauses of LLP 0018 are amended accordingly: (1) the
  > namespaces LLP 0018 scopes by `appId` (client local-store keys,
  > offline mutation queues, diagnostics, telemetry) are scoped by
  > `(appId, instance identity)` wherever more than one instance of a
  > logical app exists — clients distinguish instances by endpoint and
  > stream identity, never by `appId` alone; (2) the
  > one-canonical-commit-version-stream-per-logical-app rule (as
  > already amended by LLP 0097 for child streams) becomes one
  > canonical stream per *instance*; LLP 0097's child-stream amendment
  > continues to govern within each instance. LLP 0012's headless
  > integration contract inherits (1): generated-artifact consumers
  > treat instance identity as part of the connection identity, not a
  > new schema surface.

  Residual sub-question, still open: should copied user records retain
  their identities for re-sign-in in the fork (useful for testing,
  plausible since fork egress is refused/captured), or be scrubbed with
  the credentials? Default assumption: retained (they are data), per
  §Design sketch.
- **OQ10 — Registry custody (scope narrowed by the round-5 fix).** The
  publication state machine now makes the fork directory self-evident
  and the registry advisory — boot safety and repair never consult it —
  so this question governs *bookkeeping* (listing, TTL scheduling,
  orphan discovery when a parent is deleted), not safety. Open:
  where advisory registry state lives across parent replacement, and
  whether each agent's fork sits under its worktree (reaped with the
  worktree) or under the parent's `.snapback/` (centralized listing).

## Status

Draft, **experimental**. Authored 2026-08-03 from a brainstorming session;
F0a, F0b, and F1 now implement the local safety substrate, CLI consumer,
dated fleet dogfood, guide, and fork-aware harness, while F2 hosted work remains open. This
status records implementation progress but stays Draft until the author makes
the LLP 0005 transition; it is not a capability advertisement. The earliest
local-only `clonefile` validation and its corrected claim remain in §Spike
evidence. The
same-day 0097 reconciliation narrowed the claimed territory. A
six-round dual-family super-refine loop ran the same day and
**converged dual-READY at v0.11** (Fable READY rounds 2–4; Codex READY
round 6 after a strictly shrinking defect set — 4 blockers + 6 majors in
round 1 down to clean; two convergent cross-family findings; artifacts
under `llp/reviews/0158-instance-forking.{claude,codex}.md`). Both
families' shared closing guidance authorized the now-landed F0a after OQ9's
author decision. Per LLP 0005, any status transition is still the author's call —
this document proposes, on that basis, moving to **Review** when the
author is ready, and stays Draft until then.

**Graduation criteria.** This RFC graduates from experiment (proceeds
toward Review and an implementation decision) only when **all three**
hold:

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
   asset URL refusal, the crash-cut publication tests, and the egress
   capture-or-refuse legs including S3/provider I/O under inherited
   env credentials. No safety claim in this document graduates on
   design alone.

If (1) arrives but points at machinery 0097 already owns, the recorded
fallback is a **fold**: land the fork as a dated LLP 0097 amendment (a
branch base materialized into a separate instance) and tombstone this RFC
into it. If neither criterion is met after a reasonable interval, this
document stands as recorded reasoning: LLP 0097 owns everything
branch-shaped inside the app boundary, and whole-instance forking stays
un-built with its design costed. Remaining pre-graduation spikes, only
if criterion 1 shows signs of arriving: the OQ4 DO-bookmark spike and
the OQ2 residual (egress-path enumeration for out-of-process executors).
