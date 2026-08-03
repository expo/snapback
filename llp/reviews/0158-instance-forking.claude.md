# LLP 0158 instance forking review — Claude family

## Round 1 — 2026-08-03

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** Claude Code subagent (`general-purpose`), model
`claude-fable-5`, fresh context
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author subagent context over the working tree;
instructed to read LLP 0158 in full plus LLP 0097, LLP 0088, and LLP 0018,
to spot-check the §Implementation path seam inventory against
`src/branches.rs`, `src/config.rs`, `src/cli.rs`, `src/server.rs`,
`src/local.rs`, and `src/instance_lock.rs`, and not to read anything under
`llp/reviews/` concerning 0158 (no artifact existed). Orchestrated by the
Fable session that authored the draft, which therefore does not count as a
reviewer. **Same-family caveat:** this reviewer shares the author's model
family; it is recorded as a fresh-context review, not as the independent
cross-family leg (that is the Codex review). Author verification before
application: the blocker's and majors' load-bearing citations were checked
against the tree and are accurate — `hash_bearer` is unkeyed SHA-256
(`src/auth/crypto.rs:819`), `rotate_authorization_version_in` exists
(`src/storage/auth_stream.rs:309`), the LLP 0097 branch machinery is
explicitly "Not yet wired into any request path" (`src/server.rs` diagnostic
inventory comment), `SNAPBACK_ASSET_RUNNER_DISABLED` exists
(`src/server.rs:16638`), and the runtime dispatch carries `host.fetch`,
`push.send`, and the `action.streamOpen` family as distinct egress ops
(`src/runtime.rs:2180–2478`).

---

## Overall assessment

LLP 0158 is a well-structured, honestly-hedged RFC whose storage-plane
story (clonefile fork, version-stream continuation, journal-derived diffs,
fork-point stamping) is sound and largely spike-proven, and whose
0097/0088/0018 positioning is mostly careful. However, the seam inventory
contains one load-bearing false code claim — incarnation rotation does
**not** invalidate parent-issued sessions or agent credentials, which sit
as plain-hash-indexed rows inside the cloned database — and two material
overstatements: the "one host seam" egress claim (push.send and the
fetchStream op family bypass `host.fetch`) and the "0097 machinery built,
one new mode needed" framing (branches.rs is a self-contained library that
server.rs itself annotates as "not yet wired into any request path"). The
rogue-agent blast-radius story also overclaims for the named first
consumer (same-host, same-user agent fleets).

## Verdict

**NOT READY** — F0's identity mint, as specified, would ship a fork that
silently honors parent user sessions and agent tokens while the document
asserts they are "invalid by construction," which is exactly the class of
false-safety claim the graduation bar must exclude.

## Strengths

- **The spike section is a model of honest evidence** (§Spike evidence):
  it corrected its own draft claim (identity is inherited, not fresh),
  scoped what was *not* tested ("no runtime quarantine was built or
  tested"), and the version-collision observation (both sides minting
  5322) with the fork-point-stamping corollary is exactly right.
  `_snapback_version` living inside the file (src/storage.rs:5593)
  confirms the continuation claim.
- **Verified inventory rows.** I checked and confirm:
  `SNAPBACK_CRON_DISABLED` / `--cron-disabled` gates only autonomous
  claiming, definitions still load and inspect (src/cli.rs:625–628,
  3243–3249; src/server.rs:16678–16689) — matching "visible but inert";
  `SNAPBACK_JOBS_DISABLED` idles the jobs worker identically
  (src/server.rs:3244–3289); secrets live only in the 0600 sibling
  `<db>.config.json`, never in the database (src/config.rs:1–9, 272–280,
  per LLP 0036 D1/D2), so non-inheritance is genuinely free; the admin
  token is a ready-file sibling (src/cli.rs:2206–2222); `appId` is
  validated in the manifest pair on load (src/local.rs:1260–1283,
  `pair.schema.appId`), so keeping the appId in v1 is the
  manifest-compatible choice as claimed.
- **The 0088 non-reopening argument holds** (§Why this is still not
  LLP 0088 reopened): a fork as a new logical app introduces no branch
  identity in the data model and needs no child-stream amendment; the
  version-stream compatibility argument against 0097's amendment is
  correct.
- **The residual-set discipline** (§Relationship to LLP 0097) is the
  right shape, and the recorded fold-into-0097 fallback plus two-part
  graduation criteria (§Status) are exactly what an experimental RFC
  should carry. Schema/bundle divergence genuinely is impossible in a
  0097 branch (0097 §Design 1), so the primary use case is correctly
  placed in the residual set.
- **Throwaway-first posture with mandatory TTL** (§Lifecycle and GC)
  correctly anticipates the unbounded-history trap one level up from
  0088 §5.

## Concerns

1. **BLOCKER — The identity mint does not do what the document says it
   does.** §Design sketch ("the incarnation rotation is what makes them
   invalid"), the §Runtime plane auth row, and the §Implementation path
   "Identity mint — one seam" row all claim rotating
   `auth_stream_incarnation_v1` invalidates parent-issued sessions and
   resume tokens. The code does not support this for sessions: session
   bearer tokens are hashed with **unkeyed SHA-256** (`hash_bearer`,
   src/auth/crypto.rs:819–825) and resolved by hash lookup against
   `_auth_sessions` / `_auth_session_tokens` rows loaded from the
   database (src/auth/session_projection.rs:1695–1756; projection source
   at src/storage/auth_stream.rs:98–246). The incarnation check in
   `resolve_token` (line 1702) only fences the in-process projection
   against *its own* stream state — a fork server that boots after
   rotation rebuilds its projection from the cloned rows under the *new*
   incarnation and admits parent tokens normally. The same applies to
   `_auth_agent_credentials`, `_auth_grants`, and `_auth_grant_tokens`
   (src/storage/auth.rs:604, 628, 656 — LLP 0150 territory), all inside
   the cloned file. The codebase's own precedent confirms rotation is a
   *companion signal to destruction*, not an invalidator: reset rotates
   the incarnation **in the same transaction that deletes state**
   (src/storage.rs:990–1015; src/storage/auth_stream.rs:295–318). What
   actually dies in a fork: leases (incarnation is MAC'd into them,
   src/auth/lease.rs:470–479) and anything signed by the protocol/resume
   keyrings — which die because the keyring **sibling files** aren't
   cloned (src/auth/runtime.rs:836,
   `AuthKeyringStore::keyring_path(&database_path)`), not because of
   rotation. **Resolution:** the mint must additionally terminate cloned
   auth material (a reset-style destructive auth step over sessions,
   superseded tokens, agent credentials, grants, verification codes),
   and the spike must be extended to *adversarially test* the mint —
   present a parent session token and agent token to a minted fork —
   before "invalid by construction" may be asserted. Note also the
   inventory's "fork needs the rotate variant" is stale:
   `rotate_authorization_version_in` already exists
   (src/storage/auth_stream.rs:309–318).

2. **MAJOR — "0097 is implemented / already serves use cases"
   overstates; the capture row underprices.** All 0097 P0–P3 primitives
   exist in src/branches.rs (registry, child streams, materialized base,
   overlay, capture ledger, promotion) — but only as an in-crate library
   with in-module tests. Nothing outside branches.rs references
   `BranchExecutionMode`, `EgressDisposition`, or `capture_effect`
   (repo-wide grep), no CLI/admin/HTTP surface creates a branch, and
   server.rs says so explicitly: "Not yet wired into any request path"
   (src/server.rs:38819–38822). 0097's own claim boundary (no capability
   above `Missing` until the acceptance corpus passes) is still in
   force. Consequences for 0158: (a) §Relationship's "they already serve
   several use cases" is false today — no consumer can reach a branch;
   (b) the F0 cost line "the one real runtime change is the boot-level
   capture-mode egress switch over 0097's ledger" hides that the
   *entire interception wiring* from live egress ops into the ledger is
   net-new; (c) `capture_effect` fails closed without a branch
   child-stream row (src/branches.rs:685–698 → `allocate_child_version`),
   which a fork does not have — the ledger keying itself needs
   adaptation, not just a mode flag. **Resolution:** re-state 0097's
   status as "primitives landed, unwired, claim boundary in force," and
   re-price the F0 capture switch as wiring + ledger adaptation.

3. **MAJOR — "All handler egress crosses one host seam
   (ctx.fetch → host.fetch)" is factually wrong.** The Revised header,
   §Runtime plane table, and OQ2's "resolved by inspection" all assert
   the single seam. The runtime dispatch shows at least three
   handler-initiated egress op families: `host.fetch`
   (src/runtime.rs:2413), `push.send` (src/runtime.rs:2454–2478, served
   by `host.push_send` with its own Expo HTTP carrier in src/push.rs),
   and the `action.streamOpen/Read/Cancel` fetchStream family
   (src/runtime.rs:2180–2264). `jobs.enqueue` (src/runtime.rs:1742)
   additionally defers effects that fire later. OQ2's residual sentence
   partially hedges this, but the headline claim is the one a builder
   will read. **Resolution:** replace "one host seam" with the
   enumerated op list, and require the F0 capture mode to cover every
   member (fail-closed on any op not in the closed set — the
   `EffectClass::classify` posture in src/branches.rs:603–617 is the
   right pattern).

4. **MAJOR — The rogue-agent blast-radius claim overclaims for the named
   first consumer.** §Motivation reads "rogue agent" as the adversarial
   posture the fork addresses, and use case 0 says the blast radius "is
   its own disposable clone." That is true only for code executed
   *through the fork's runtime*. An agent process on the same host with
   the same UNIX user — which is precisely the repository's own
   worktree-per-agent fleet, the workflow §Status names as the first
   instance — can bypass Snapback entirely: open the parent's SQLite
   file directly, read the parent's 0600 `<db>.config.json` (same
   owner), kill the parent server, or edit the parent's app root. The
   fork removes the need to hand agents parent credentials and contains
   their *deployed handler code*; it does not contain the agent process.
   0018 and 0097 both scope themselves cooperating-not-adversarial and
   defer adversarial isolation to LLP 0009; 0158 implies it escapes that
   scoping without providing the OS-level isolation that would justify
   it. **Resolution:** add an explicit threat-model paragraph: fork =
   credential non-inheritance + runtime-routed containment; rogue-agent
   *process* containment additionally requires OS/user/container
   separation, out of F0's scope.

5. **MAJOR — The asset plane "shares every blob… nearly free by
   construction" does not match the shipped local layout.** The local
   blob store is rooted **beside the database** (src/local.rs:6498–6519;
   `assets` subdirectory, src/assets_store.rs:101). A fork cloned into a
   different directory (the spike's `$WORK/fork/` shape, and F0's
   `--from <db>`) gets metadata rows pointing at blobs that are not
   present — asset serving silently breaks. Sharing requires either
   cloning the assets tree too (cheap via clonefile, but then it is a
   copy with no cross-instance refcount question — a different design
   than §Asset plane describes) or a store-root indirection that does
   not exist. Separately, the asset maintenance loop is a **third**
   autonomous worker with its own switch,
   `SNAPBACK_ASSET_RUNNER_DISABLED` (src/server.rs:16638–16659), which
   F0's boot line (cron + jobs only) omits — a fork of an asset-bearing
   app would run ledger work and GC sweeps every 5 minutes.
   **Resolution:** row the asset store in the inventory, add the third
   switch to F0, and either scope F0 to "asset-bearing apps degraded
   until F1" or include the assets-tree clone.

6. **Minor — Shared appId vs 0018's identifier semantics.** 0018
   §Implementation Implications makes `appId` the identifier that must
   scope local-store keys, diagnostics, and telemetry. Two live logical
   apps sharing one appId means client local stores and offline mutation
   queues keyed by appId can mix parent and fork. Rotation plausibly
   serves as the client-visible reset signal (the incarnation is
   threaded into the sessions descriptor and telemetry identity,
   src/local.rs:18456–18466), but the document should state that clients
   distinguish instances by incarnation/endpoint, not appId — and note
   this in whichever of 0158/0018 graduates first.

7. **Minor — Cloned operational residue is not inventoried.** The clone
   carries mid-flight system state the inventory never sweeps: search
   journal leases and generations (`_snapback_search_*`), claimed job
   rows, stream attempts (these, at least, are reconciled at boot —
   src/local.rs:18442–18455), and cron claim state. Most are
   lease/time-bound and self-heal, but the reset deletion list
   (src/storage.rs:990–1032) is a ready-made checklist of every system
   table that needs an explicit carry/reset/inert decision at fork time.

8. **Minor — Live-fork lock TOCTOU.** "When no server holds the instance
   lock, the CLI checkpoints and clones directly" — observing the lock
   free and then cloning races a starting server. The CLI should
   *acquire* the lock (src/instance_lock.rs:37) for the checkpoint+clone
   window. The host-op path for a live parent is coherent; the host-ops
   envelope surface exists (src/host_ops.rs) and the lock metadata
   carries the owner's port/url for discovery.

## Suggestions

- Reframe the identity mint as a three-part operation and name it that
  way in §Implementation path: (1) incarnation rotation (signal +
  lease/telemetry identity), (2) auth-material termination (the
  reset-style destructive step), (3) keyring/sibling non-inheritance
  (free, but should be listed as load-bearing rather than incidental —
  it is what kills resume tokens).
- The quarantine table's cron row is accurate but could note that the
  admin manual tick still claims and executes due runs under
  `--cron-disabled` (src/server.rs:16680–16686) — that is a feature for
  rehearsal ("fire this cron job deliberately in the fork") worth
  surfacing rather than discovering.
- OQ1's adversarial sweep should explicitly include the packaged
  comparator fixtures and backup tooling named in this repo's own
  workflow history as version-number consumers.
- Consider stating in §Diff surface that the fork's own maintenance
  worker prunes `_snapback_changes` on the normal retention schedule
  (src/server.rs:16495–16513), so "pin a more generous window at
  creation" needs a real per-instance retention knob — verify one exists
  before asserting it.
- Prior-art table: the Convex and Supabase rows carry good
  unverified-flags; give the Turso row the same treatment (its branch
  feature has shifted between product generations).

## Open questions

- Which session classes, if any, *do* fail in a fork for keyring
  reasons — are sender-constrained (`sbs2_`) session proofs verified
  against a keyring-derived purpose key such that the missing sibling
  breaks them, while plain `sbs_` bearers survive? The answer determines
  how much of the leak in Concern 1 is theoretical vs total.
- Is journal retention actually pinnable per instance at creation time,
  or is that a new knob F0 must add for the diff-receipt guarantee to
  hold over a fork's whole TTL?
- When the mint terminates cloned sessions, what should the fork's
  *user-record* story be for re-authentication — do copied
  `_auth_identities` allow a tester to sign back in as a copied user
  through the normal flow (useful), and is that acceptable given the
  fork carries no email-sending capability (captured egress)?
- For the F1 fork-per-worktree convention: does each agent's fork live
  under the worktree (clean reaping with the worktree) or under the
  parent's `.snapback/` (centralized registry)? The TTL/registry design
  reads differently in each.

## Recommended next step

Fix the document before any F0 work: correct the identity-mint claim
(Concern 1) to rotation-plus-auth-termination, rewrite the single-seam
egress sentence as the enumerated op list (Concern 3), restate 0097's
wiring status (Concern 2), scope the rogue-agent threat model
(Concern 4), and row the asset store plus the third worker switch
(Concern 5). Then run a second half-day spike that adversarially tests
the corrected mint — boot a minted fork and present a parent session
token, a parent agent credential, and a parent resume token, expecting
all three to be refused — and record the results in §Spike evidence with
the same honesty as the first spike. With those corrections and that
negative-test evidence, the RFC's architecture (which is fundamentally
sound) would be READY for graduation review; nothing found here argues
against the fork capability itself, only against the current document's
account of what makes it safe.

---

## Round 2 — 2026-08-03

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** same subagent context as round 1, resumed with the
v0.4 revision; model `claude-fable-5`
**Date:** 2026-08-03
**Redacted:** no
**Method:** re-read of the full revised document; disposition of each
round-1 finding; targeted hunt for fix-introduced defects; spot-checks of
the revision's new code citations (`rotate_authorization_version_in`,
`SNAPBACK_ASSET_RUNNER_DISABLED`, `MaterializedBase` backup API, resume
token binding in `src/rqs.rs`, auth-bypasses-journal test evidence in
`src/storage/auth.rs`). Same-family caveat as round 1.

## Overall assessment

The v0.4 revision is a genuine and thorough repair, not a cosmetic one:
every round-1 blocker and major is addressed at the design level
(scrub-and-mint over a custody manifest, enumerated egress families, 0097
landed-but-unwired status, asset custody as an F0 decision, the
three-tier threat model), and the revision's new code assertions check
out under spot-verification, including two added beyond the round-1
findings (the opaque-UUIDv7 physical-key quote is verbatim at
src/assets.rs:1900–1901; the maintenance loop's Expo receipt-polling
egress is real, src/server.rs:16419–16443, driven at 16627). The document
now consistently refuses to assert safety properties ahead of the F0a
negative-test corpus, and the reordered phasing (corpus before verb) plus
graduation criterion 3 make that discipline structural. Remaining defects
are editorial-consistency residue in sections the revision forgot to
sweep.

## Verdict

**READY** — the document's claims are now honest and code-supported to
the level needed to begin F0a; the safety claims themselves remain
correctly gated on the corpus passing and OQ9 being decided, which the
document itself enforces.

## Round-1 disposition

1. Blocker (identity mint): **Resolved** — §Design sketch scrub-and-mint;
   no invalidity claim asserted pre-corpus; criterion 3.
2. Major (0097 status / capture underpriced): **Resolved** —
   substrate-landed-but-unwired; wiring is cost item #1; `capture_effect`
   keying adaptation named.
3. Major (one-host-seam egress): **Resolved** — enumerated families; OQ2
   reopened with the prior error admitted; receipt-polling lane added
   (verified real).
4. Major (rogue-agent overclaim): **Resolved** — §Threat model tiers;
   Motivation rewritten to match.
5. Major (asset plane): **Resolved** in §Asset plane — but §Lifecycle and
   GC was not reconciled (new concern 1).
6. Minor (appId vs 0018): **Resolved** — OQ9 with amendment consequence.
7. Minor (operational residue): **Partially resolved** — custody manifest
   covers credential classes and sidecars; non-credential operational
   system tables still unswept; reset's delete list
   (src/storage.rs:990–1032) remains the checklist.
8. Minor (lock TOCTOU): **Resolved** — acquire-not-observe.
Suggestions: all adopted.

## New concerns (fix-introduced or genuinely new)

1. **Minor (forgotten update)** — §Lifecycle and GC still presents the
   asset-GC barrier as the shipped design; v0.4's §Asset plane makes the
   barrier option (c), F2-only. Condition the paragraph on the custody
   option.
2. **Minor (forgotten update)** — the Summary still describes the fork as
   a "copy-on-write snapshot … nearly free"; the live-parent path is a
   full backup-API copy with unmeasured latency. Scope the clause.
3. **Minor (cross-reference gap)** — the version-stream bullet and 0097
   matrix row don't mention that the scrub-and-mint rotates the
   data-stream identity while numbering continues; a reader could
   conclude parent resume cursors stay valid because numbering continues.
   Verified split: counter in `_snapback_version`;
   `rotate_data_version_stream_in` (src/storage/auth_invalidation.rs:493);
   resume tokens MAC the `version_stream` (src/rqs.rs:1303–1318). State
   once: same numbering space, new stream identity.
4. **Minor (matrix asymmetry)** — the maintenance receipt-polling row's
   "Off / captured" default has no existing switch to cite
   (`drive_push_maintenance_once` runs inside the unconditional
   maintenance worker, src/server.rs:16419–16443, 16627); mark the
   mechanism net-new so builders don't assume switch parity.

## Recommended next step

Apply the four editorial fixes in a small v0.5 pass (no re-review needed
— none changes a design decision), then stop editing: further motion must
come from decisions and evidence, not prose. Critical path: (1) the OQ9
identity-model decision (F0a's mint tests cannot be written against an
undecided identity shape); (2) the F0a negative-test spike, which doubles
as the first real installment of LLP 0097's own mediation prerequisite.
If the worktree-fleet consumer named in criterion 1 is pinned at the same
time, all three graduation criteria are in motion with nothing
speculative left in the text.

---

## Round 3 — 2026-08-03

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** same subagent context resumed; model
`claude-fable-5`
**Date:** 2026-08-03
**Redacted:** no
**Method:** targeted soundness review of the six v0.6 changes (the Codex
round-2 fixes) with code verification of each checkable claim, plus a
document-consistency sweep. Same-family caveat as rounds 1–2.

## Overall assessment

The v0.6 additions are sound: every checkable new code claim verifies
against the source, including the three load-bearing ones — the resume
keyring really is directory-scoped rather than per-database
(`database_path.with_file_name("resume-keyring.json")`,
src/local.rs:18503–18505; `RESUME_KEYRING_FILE_NAME`, src/rqs.rs:52),
the signed-URL MAC input really binds no instance identity over
DB-resident signing keys (src/assets.rs:2566–2576; keys in
`_snapback_asset_signing_keys_v1`, src/assets.rs:964), and the reset
sequence really does omit the durable-jobs tables (`_snapback_jobs_v1`,
`_snapback_job_attempts_v1`, `_snapback_job_push_grants_v1`,
src/jobs.rs:306–351, appear nowhere in storage.rs and no
`DELETE FROM _snapback_job*` exists in src) — validating the switch to
mechanically-enforced custody authority. The crash-safe publication
protocol closes the bootable-unminted window; the identity-neutral sweep
missed two spots. No new defect rises above minor.

## Verdict

**READY** — sound to begin F0a; graduation remains correctly gated on
the safety corpus and OQ9, which the document itself enforces.

## Per-change soundness

1. Crash-safe mint publication: **sound and verified** (citation nit:
   attribute directory scoping to the production path, not tests).
2. Custody authority → mechanical schema sweep: **sound and verified**.
3. S3/provider quarantine row: **sound and verified** (incidental:
   the S3 store currently also refuses without
   `SNAPBACK_ASSET_S3_EXPERIMENTAL=1` — an extra guard, not a substitute
   for the custody rule).
4. Option-(b) same-cut + signing-key obligations: **sound and verified**
   (the cited consistent-cut model exists as described,
   src/assets_cut.rs).
5. Identity-neutral sweep: **mostly sound** — two missed spots (below).
6. Summary/diff-fallback scoping: **sound**.

## New concerns

1. **Minor (incomplete identity-neutral sweep)** — the version-stream
   bullet's "costs nothing since the stream is per logical app (LLP 0018
   pins the stream as per-app, not per-instance)" contradicts the
   derived-deployment branch of OQ9, whose 0018 amendment must therefore
   also widen the one-stream-per-app clause; and §Status's fold sentence
   still read "materialized into a new logical app."
2. **Minor (stale enumeration)** — graduation criterion 3 still listed
   only the v0.4-era negative tests; it should defer to the F0a corpus
   in full.
3. **Suggestion** — the asset-cut import already implements a tested
   generation-bump fence (restore-epoch: bump every lifecycle generation
   past the manifest's so old-epoch signed URLs cannot validate,
   src/assets_cut.rs); name it as an alternative/complement to
   signing-key rotation in the mint design.

## Recommended next step

Fold the two minors and optionally the generation-bump note into a v0.7
touch-up (no re-review needed), then hold the document still: after
three rounds it has converged, with every code-checkable claim verified
by at least one independent reviewer. The remaining motion belongs to
decisions, not prose: OQ9 first (its amendment scope now includes
0018's one-stream-per-app clause), then the F0a corpus in the v0.6
shape, with the custody schema sweep as the corpus's first mechanical
gate.

*(Author note: the v0.7 touch-up applying concerns 1–2 and the
suggestion was made the same day; see the document's Revised header.)*

---

## Round 4 — 2026-08-03

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** same subagent context resumed; model
`claude-fable-5`
**Date:** 2026-08-03
**Redacted:** no
**Method:** narrow verification of the v0.8 "Crash-safe mint publication"
bullet (the Codex round-3 blocker fix), via an explicit crash-window walk
of the protocol ordering — prompted by this reviewer's round-3 miss (it
had verified the v0.6 protocol as sound; Codex round 3 showed the
ordering was not). Same-family caveat as all rounds.

## Verdict

**READY** (the protocol bullet specifically). The pre-clone sentinel
genuinely closes the round-3 window: refusal authority exists before the
first clone byte, every crash cut in clone→scrub→sidecars leaves a
refusing directory, and the design fails closed even if the in-DB stamp
never lands — demoting the stamp to defense-in-depth is honest, not a
weakening. The startup sentinel probe is correctly treated as F0a work
to build; nothing existing contradicts it. The two-phase publication is
the standard write-ahead-intent pattern with a single commit point,
recoverable on both crash sides (intent-without-published-directory →
not committed, reap staging; published-without-reconciliation →
committed, finalize), and the retraction of joint registry+rename
atomicity removes the round-3 impossibility. No new impossible or
code-contradicted claim.

## Recorded lesson (round 3 → round 4)

In round 3 this reviewer verified the protocol's constituent *facts*
against the code (keyring scoping, stamp placement, sidecar paths) but
accepted its *ordering logic* as stated — it never walked each crash
window between steps or asked whether "atomic publication (registry row
+ rename)" was implementable. A protocol claim needs an adversarial
step-by-step crash-window walk, not just verification of the facts each
step rests on.

## New concern

- **Minor** — the sentinel/rename handoff was unstated: where the
  sentinel lives relative to what gets renamed, and when it clears.
  Only one ordering is fail-closed: the sentinel travels with the
  renamed directory and clears *after* the rename as the reconciliation
  step (a crash between rename and reconciliation leaves a
  published-but-still-refusing fork that repair completes). Also worth
  one word: `rename(2)` atomicity requires same-filesystem staging.
  *(Author note: both pins applied the same day as v0.9.)*
