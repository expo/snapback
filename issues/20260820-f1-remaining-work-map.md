# What actually remains for F-1, mapped against the tree

**Status:** Open
**Filed:** 2026-08-20
**Systems:** Security/authorization, Packaging, Verification, Project
**Related:** LLP 0283 F-1, LLP 0285 (§6, superseded in part), LLP 0291, LLP 0292, LLP 0293,
LLP 0276 Phase 4

## Why this exists

LLP 0285 §6 lists fifteen steps, but it is now **Superseded in part**: author ruling 5
directs deleting and rebuilding the authority-creation surface rather than migrating it, and
§6's banner says steps 5-15 are *historical intent*. Meanwhile steps landed piecemeal — 1-4,
then 8, then part of 10, with step 6's first conversion committed on an **unlanded** branch
held under that ruling.

The result was that nobody could say what remained. This maps it against the tree rather than
against any document's intent.

## The headline, stated plainly

**None of LLP 0283 F-1's four defects is closed.** Real progress landed today — the
reachability half, room authority, a powerless `config.verify`, registry retirement — but
every one of the four defect families remains open, and the commits were careful not to claim
otherwise.

**F-1 is a large-to-extra-large, multi-engineer-week security program, not "a few steps left."**
The estimate is roughly **4-8 engineer-weeks if the core and family grouping hold, 8-12+ if
the anchor, service fence, or family semantics fragment under review**. Parallel lanes shorten
wall time, but acceptance → core → reconnection/fence → final proof is inherently serial.

## Four publication blockers beyond F-1 itself

Publication is not gated on F-1 alone:

1. **Sealed assembly identity** — the canonical assembler rejects its own newly built binary.
2. **LLP 0276 Phase 4 / F-3 disposition** — every red needs signature continuity and an
   explicit disposition; ~29 items, 7-20 engineer-days.
3. **Cold-clone qualification** — 33/34; offline boot shows blocking chrome rather than an
   honestly labelled board.
4. ~~**Handler-sandbox scope**~~ — **RESOLVED by author ruling 2026-08-20.** The next
   npm closures do not assert adversarial-handler containment, so the five findings are
   not publication blockers for pre-public-release closures. **The release claim must
   explicitly disclaim the boundary** rather than stay silent on it. The findings remain
   open work and must be closed before any release that does assert it.

## Three decisions the author still owes

Recorded at the end of this document: the final `ServingDatabase` `Deref` shape, which D-4
gates are claim-relevant for the next npm closure, and whether that closure asserts
adversarial-handler containment. The third is the consequential one — if yes, the five
handler findings become mandatory blockers; if no, the release claim must **explicitly
disclaim** that boundary rather than leave it ambiguous.

---

# F-1 closure map

Audit baseline: `HEAD == origin/main == 8176b4348`. No files were changed.

One evidence limitation matters: neither a local nor remote-tracking `lane/f1-forge` ref is available, and network access is unavailable. Its `ResolvedPrincipal`/pending-effect work therefore cannot be credited to the tree or cited by commit. LLP 0285 confirms that lane is held ([0285:103–117](/Users/ccheever/lanes/docs/llp/0285-kernel-authorization-closure.spec.md:103)); current `main` still has the old caller-supplied `requires_step_up` ([storage.rs:1771](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:1771)).

## Fifteen-step disposition

| Step | Status against `origin/main` | Evidence and rebuild meaning |
|---|---|---|
| 1. Freeze behavioral evidence | **DONE** | `dc5d59efd`; the committed freeze explicitly covers behavior, not F-1 closure ([step1 evidence:1–10](/Users/ccheever/lanes/docs/tests/acceptance/kernel-authorization-closure-step1-v1-evidence.md:1)) and records the schema digest ([lines 35–39](/Users/ccheever/lanes/docs/tests/acceptance/kernel-authorization-closure-step1-v1-evidence.md:35)). **Rebuild meaning:** retain the race/receipt behavior suites, but refresh the freeze around the LLP 0291 family census and current tree—not the obsolete API hashes. Absorbed into 0292 Phase 0. |
| 2. Split `DatabaseBinding` | **DONE** | `dc5d59efd`; the binding is public, opaque, cloneable identity only ([storage.rs:550–585](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:550)), while the authority root is separate and crate-private ([storage.rs:598–606](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:598)). **Rebuild meaning:** keep it as the powerless routing/database identity in the final core. |
| 3. Introduce `ServingDatabase` | **DONE as the historical step** | `dc5d59efd`; `ServingDatabase` owns the database and root, detached snapshots are non-extractable, and there is no `DerefMut` ([storage.rs:1182–1216](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:1182)); only shared `Deref` remains ([storage.rs:1849–1855](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:1849)). **Rebuild meaning:** a narrow serving-store owner may survive, but its compatibility-preserving broad access is not the final design. Phase 1 removes any authority-significant dereference surface. |
| 4. Make the root private/non-`Clone`; narrow re-exports | **DONE** | `dc5d59efd`; `KernelCommitAuthority` is `pub(crate)` and non-`Clone` ([storage.rs:598–616](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:598)); production claiming is private and the named helper is `#[cfg(test)] pub(crate)` ([storage.rs:2728–2755](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:2728)); auth’s storage import is crate-private ([snapback-auth/lib.rs:9](/Users/ccheever/lanes/docs/crates/snapback-auth/src/lib.rs:9)). **Rebuild meaning:** preserve this containment until Phase 1 deletes the old root outright. |
| 5. Add additive `ResolvedPrincipal` | **OBSOLETE under ruling 5** | No such compiled type exists on `main`; LLP 0291 records the absence ([0291:61–68](/Users/ccheever/lanes/docs/llp/0291-authority-forgery-surface.research.md:61)). LLP 0292 explicitly abandons the additive form ([0292:377–380](/Users/ccheever/lanes/docs/llp/0292-authority-straight-path.plan.md:377)). **Absorber:** Phase 2’s private `KernelVerifiedEvidence`/`VerifiedActor` inside the final authority module. Do not merge the lane’s adapter type. |
| 6. Convert four admissions one by one | **SUBSUMED by Phases 2–3; migration form obsolete** | Current `main` still accepts caller-selected pending-effect approval/step-up facts ([storage.rs:1771–1788](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:1771)) and twelve caller-supplied erasure fields ([storage.rs:1817–1844](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:1817)). LLP 0292 abandons one-by-one conversion while retaining same-transaction derivation ([0292:379–380](/Users/ccheever/lanes/docs/llp/0292-authority-straight-path.plan.md:379)). **Rebuild meaning:** Phase 2 builds operation-specific transactional commits; Phase 3 reconnects the evidence classes. The unlanded pending-effect derivation may contribute tests/query knowledge, but not its transitional API. `config.verify` is one useful pulled-forward result already landed at `56982daef`. |
| 7. Move the service fence into the kernel | **SUBSUMED by Phase 4; tree work NOT STARTED** | The domain and publication/permit carriers still live in `snapback-auth` ([service_fence.rs:60–100](/Users/ccheever/lanes/docs/crates/snapback-auth/src/auth/service_fence.rs:60)); its registry remains public/cloneable ([service_fence.rs:564–587](/Users/ccheever/lanes/docs/crates/snapback-auth/src/auth/service_fence.rs:564)); the kernel still exposes the closure bridge ([storage.rs:1449–1477](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:1449)). **Rebuild meaning:** preserve the LLP 0059 algorithm, but rehouse it directly behind final core types—not as a literal compatibility-preserving line move. |
| 8. Move room authority into the kernel | **DONE** | `8de11f06e`, corrected by `8176b4348`. The registry is kernel-private ([room_authority.rs:166–196](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage/room_authority.rs:166)), participant construction and binding are private ([room_authority.rs:288–318](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage/room_authority.rs:288)), and prepared settlement is `pub(crate)` ([room_authority.rs:1070–1084](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage/room_authority.rs:1070)). **Rebuild meaning:** keep this ownership and the retirement fix; Phase 4 only reattaches it to the new prepared-operation/core vocabulary. |
| 9. Delete closure constructors | **PARTLY DONE** | Step 8 deleted the room carrier factory, but the public service terminal factory still accepts three closures ([kernel service_fence.rs:36–53](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/auth/service_fence.rs:36)); `ServingDatabase::service_authority_commit_interlock(impl Fn…)` remains ([storage.rs:1458–1477](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:1458)), as does public `DbRead::with_pinned_read_view(impl FnOnce…)` ([storage.rs:8114–8124](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:8114)). **Absorber:** delete public factories in Phase 1; replace the service bridge while reattaching the fence in Phase 4. |
| 10. Demote every privileged test seam to `#[cfg(test)]` | **PARTLY DONE** | `dc5d59efd` made the root claim `#[cfg(test)]`, made the join crate-private, and deleted `open_commit_graph_sibling_for_test`; step 8 removed room test factories. But feature-visible authority remains: `RecordingServiceAuthorityCommitInterlock` is still `#[cfg(any(test, feature="test-support"))]` and public ([kernel service_fence.rs:130–146](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/auth/service_fence.rs:130)), and direct session-mint fixtures remain feature-visible ([auth_catalog_ops.rs:4605–4678](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage/auth_catalog_ops.rs:4605)). **Rebuild meaning:** Phase 1 deletes production-feature privilege seams in one cut; private kernel unit fixtures may remain. |
| 11. Replace raw SQL with typed probes | **PARTLY DONE** | `c3a72edec` plus correction `2bfeec3b7`; server tests now use typed physical/visible telemetry probes ([server/tests.rs:24–43](/Users/ccheever/lanes/docs/crates/snapback-server/src/server/tests.rs:24)). But `push/authority_tests.rs` remains the raw-rusqlite consumer ([authority_tests.rs:9–12](/Users/ccheever/lanes/docs/crates/snapback-engine/src/push/authority_tests.rs:9)). **Rebuild meaning:** keep sound typed probes; remove the residual consumer during Phase 1 rather than continue a staged migration. |
| 12. Give `snapback` a visible rusqlite dev-dependency | **DONE** | `c3a72edec`/`2bfeec3b7`; direct dev-dependency at [snapback/Cargo.toml:84–85](/Users/ccheever/lanes/docs/crates/snapback/Cargo.toml:84). Keep it; ordinary dev-dependencies do not propagate authority to dependents. |
| 13. Create `snapback-harness` | **DONE** | `c3a72edec`; the rank-7 harness exists and carries rusqlite only as a dev-dependency ([snapback-harness/Cargo.toml:1–20](/Users/ccheever/lanes/docs/crates/snapback-harness/Cargo.toml:1)); confinement inventory includes it ([allowed-dependencies:17–25](/Users/ccheever/lanes/docs/crates/allowed-dependencies.v1.json:17)). Keep it. |
| 14. Delete `remainder-tests` and services `test_support` | **NOT STARTED; absorbed by Phase 1** | The feature still exists ([snapback-services/Cargo.toml:12–18](/Users/ccheever/lanes/docs/crates/snapback-services/Cargo.toml:12)) and still publicly re-exports rusqlite ([snapback-services/lib.rs:39–43](/Users/ccheever/lanes/docs/crates/snapback-services/src/lib.rs:39)); four workspace dev-dependency activations remain. **Rebuild meaning:** delete the module/feature and residual consumer in the flag-day cut. |
| 15. Final verification | **SUBSUMED by Phase 6** | Landed slices ran affected checks, and the complete F-3 battery has since run, but no proof can qualify code that does not exist yet. LLP 0292 Phase 6 requires family disposition, transaction/race evidence, regeneration, cold install, sealed qualification, and independent integrated review ([0292:356–367](/Users/ccheever/lanes/docs/llp/0292-authority-straight-path.plan.md:356)). That expanded Phase 6 replaces old step 15. |

## Actual remaining path to F-1 closure

1. **Finish and accept the implementation-authoritative mechanism.** The direction is accepted, but LLP 0292 is still metadata-`Draft` and LLP 0293 is `Review` ([0293:1–11](/Users/ccheever/lanes/docs/llp/0293-authority-transition-chokepoint.spec.md:1)). The prototypes answered eight of nine structural questions; only the administrator-anchor protocol remains open ([prototype evidence:206–246](/Users/ccheever/lanes/docs/prototypes/authority-chokepoint/EVIDENCE.md:206)). Specify KDF/MAC, sidecar format, rotation, fork/restore recovery and fault behavior, then accept the full mechanism.

2. **Refresh the evidence/family ledger against current `main`.** Freeze all 46 original LLP 0291 families with a disposition, crediting what `56982daef`, `8de11f06e` and `8176b4348` already removed. Do not assume all 46 are still live; do require all 46 to be accounted for. Harvest only tests and query knowledge from `lane/f1-forge`.

3. **Phase 1: delete the old authority vocabulary and escape hatches.** Remove `ResolvedAppAuthority`, `System`, `AdminBypass`, generic `PreparedAuthority`, `KernelCommitAuthority`, public membership discriminators, caller-selected pending-effect facts, service closure factories, feature-visible privilege seams, `remainder-tests`, and authority-significant database dereferencing. This deliberately leaves a compiler-broken branch.

4. **Phase 2: build the private authority core once.** Implement the protected-object registry/SQLite authorizer, exact operation registry, private evidence and permits, mandatory administrator anchor, same-transaction revalidation, derived membership writer/provenance and durable receipts. This depends on step 1.

5. **Phase 3: reconnect the five evidence classes and disposition every original family.** External sessions, scoped services, dev identity selection, exact operator operations, and durable internal/inherited work. Preserve the landed powerless `config.verify`; introduce the compiled durable cron due/claim shape and authenticated delivery receipt; replace pending-effect, erasure, push and membership assertion with exact operations.

6. **Phase 4: reattach fences.** The room half starts from the landed kernel implementation. The service half is still substantial: rehouse the mechanism against final core types and delete its closures/installer. Re-run all retirement, rollback, ambiguity, publication and outbox races, including the stale-permit regression from `8176b4348`.

7. **Phase 5: make the break explicit.** Add the new store-format boundary, mandatory anchor provisioning, data-only offline export/import, reset disposable state, and regenerate fixtures, demos, schemas and Guide output.

8. **Phase 6: close F-1.** All original families dispositioned; all four defect families absent; LLP 0284 gates green without allowlists; same-transaction, authorizer-bypass, LLP 0059, ambiguity and feature-cell tests green; independent review of the integrated implementation. Only here is F-1 closed.

## Current truth of the four defects

**VERIFIED: none of the four defect units is closed.**

| Defect | Current state |
|---|---|
| 1. Publicly claimable authority root / unverified fact assertion | **OPEN, with reachability half closed.** The root is private, but public owner bridges still mint System/user/other push from caller selection ([storage.rs:1223–1239](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:1223)), accept caller-selected pending-effect step-up ([storage.rs:1771–1788](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:1771)), and accept caller-provided erasure identity/digest facts. Public `ResolvedAppAuthority::{AdminBypass,System}` and the generic admitted gate remain ([invocation.rs:294–356](/Users/ccheever/lanes/docs/crates/snapback-sync/src/auth/invocation.rs:294), [invocation.rs:1945–1966](/Users/ccheever/lanes/docs/crates/snapback-sync/src/auth/invocation.rs:1945)). |
| 2. Public arbitrary-closure factories | **OPEN, partly closed.** The room callback factory is gone, but the service closure factory and `DbRead::with_pinned_read_view(impl FnOnce…)` remain. The non-overclaim in `8de11f06e` is accurate. |
| 3. Caller-selectable raw-SQLite feature | **OPEN, partly migrated.** Visible dev-dependencies and the harness landed, but `snapback-services/remainder-tests` still exports raw rusqlite to any dependent enabling it. |
| 4. Caller-selected membership provenance | **OPEN, essentially untouched.** `MembershipWriter` remains a public, cloneable enum with public `Seed`, `Import`, and `Admin` variants ([storage.rs:14155–14190](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:14155)); the public planner/commit APIs still accept it ([membership_plans.rs:1832–1847](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage/membership_plans.rs:1832)); provenance still maps `Admin` to `hostOps:dataEdit` ([storage.rs:14286–14334](/Users/ccheever/lanes/docs/crates/snapback-kernel/src/storage.rs:14286)). |

## Step 7 disposition

Step 7 is **not unnecessary**. Its old migration-shaped implementation is subsumed by Phase 4, but its ownership result survives intact.

The service registry and domain remain above the kernel, and the kernel still accepts a closure that can manufacture terminal behavior. That is incompatible with both “kernel derives, never accepts” and the final no-public-callback surface. LLP 0292 already settles the policy: retain the service-fence algorithm and rehouse it behind concrete final types ([0292:334–346](/Users/ccheever/lanes/docs/llp/0292-authority-straight-path.plan.md:334), [0292:381–382](/Users/ccheever/lanes/docs/llp/0292-authority-straight-path.plan.md:381)). No new author ruling is needed for whether it happens; only its final-type design remains.

## Honest size

**INFERRED bands:**

| Work | Band |
|---|---|
| Anchor specification + final LLP acceptance | **Medium** |
| Phase 1 deletion and compiler census | **Medium** |
| Phase 2 authority core | **Large** |
| Phase 3 residual-family reconnection and semantic review | **Extra-large** |
| Phase 4 service fence; room reintegration | **Large** / **Small–medium** |
| Phase 5 format break and regeneration | **Medium–large** |
| Phase 6 adversarial qualification/review | **Large** |

Overall F-1 is still a **large-to-extra-large, multi-engineer-week security program**, not “steps 5–7 left.” A reasonable planning band is roughly **4–8 engineer-weeks if the core and family grouping hold, 8–12+ if the anchor, service fence or family semantics fragment under review**. Parallel lanes can shorten wall time, but acceptance → core → reconnection/fence → final proof is serial.

## Publication blockers beyond F-1

1. **Sealed assembly identity is a hard publication blocker.** The canonical assembler rejects its own newly built binary because identity stamps stayed package-local after `binary_identity()` moved ([sealed issue:9–28](/Users/ccheever/lanes/docs/issues/20260820-sealed-assembly-rejects-own-runtime.md:9)). Ambient overrides proved the remainder of assembly, but are explicitly not a fix ([lines 38–57](/Users/ccheever/lanes/docs/issues/20260820-sealed-assembly-rejects-own-runtime.md:38)).

2. **LLP 0276 Phase 4/F-3 disposition is a release gate.** The complete battery has now run; 36 pre-existing reds collapse to roughly 29 items. Not every red must be fixed, but every signature needs continuity and an explicit disposition, while the current claim-relevant set must be green ([F-3 issue:42–49](/Users/ccheever/lanes/docs/issues/20260820-f3-bucket-b-pre-existing-reds.md:42)). The repository’s estimate is 7–12 engineer-days if auth/outbox issues converge, 12–20 otherwise ([lines 19–29](/Users/ccheever/lanes/docs/issues/20260820-f3-bucket-b-pre-existing-reds.md:19)).

3. **Cold-clone qualification is not green yet.** The registry-package build passes, but browser acceptance is 33/34 because offline boot shows blocking chrome rather than an honestly labelled board ([cold-clone issue:8–21](/Users/ccheever/lanes/docs/issues/20260820-all-aboard-offline-boot-chrome.md:8)).

4. **Handler-sandbox publication scope needs an explicit decision.** Five live findings prevent treating application JavaScript as an adversarial principal, and the issue requires a two-engine qualification gate before app-use or publication claims ([handler issue:19–40](/Users/ccheever/lanes/docs/issues/20260820-handler-sandbox-triage-and-scheduling.md:19), [lines 193–210](/Users/ccheever/lanes/docs/issues/20260820-handler-sandbox-triage-and-scheduling.md:193)). If the next closure claims hostile-handler containment, these block it independently of F-1.

## Exact questions still requiring decisions

- ~~**Serving-store surface**~~ — **RESOLVED, author ruling 9 (2026-08-20).** `ServingDatabase`
  loses `Deref` entirely. Read-only `Deref` survives only under a standing proof obligation
  covering methods not yet written; this program already paid for that twice
  (`checkpoints_read()`, `versions_read()`, then two table-dropping `*_for_test` methods).
  Removing it converts an audit-forever obligation into a structural impossibility.

- ~~**Publication claim scope**~~ — **RESOLVED, author ruling 9 (2026-08-20).** The D-4
  claim-relevant set is DERIVED from what the closure actually claims, never copied from a
  historical release list. A copied list is stale on arrival.

- ~~**Handler boundary**~~ — **RESOLVED, author ruling 2026-08-20.** Pre-public-release npm
  closures do NOT assert adversarial-handler containment, and the release claim must
  explicitly disclaim it. See
  `issues/20260820-handler-sandbox-triage-and-scheduling.md`.

The administrator-anchor question no longer needs a direction ruling—ruling 7 already requires it. It needs a focused technical specification and acceptance.
