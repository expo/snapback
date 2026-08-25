# Superseded P3-LOW reasoning review: execution is required

Status: Closed
Date: 2026-08-24
Systems: snapback-auth, snapback-sync, snapback-engine, snapback-kernel, snapback-server
Related: issues/20260824-liveness-row-bucket-assignment.md, LLP 0303,
  issues/20260824-assertion-provenance-is-the-recurring-test-defect.md,
  issues/20260825-p3-low-top-six-execution.md

## Execution supersession — 2026-08-25

This document is a reasoning review, not closure evidence. The watched execution in the related
2026-08-25 issue falsified all six attempted bounds, including this document's `CONFIRMED-P3`
verdicts for F089, F091, and C004. Its old counts and ticket-ready closure reasons must not be used
to retire rows. The five remaining reasoned bounds (F006, F096, F242, F243, F287) also remain open
until execution reaches their assertions.

## Why this was checked

The row bucket assignment classified 17 rows as **P3-LOW** — "no durable effect and no authority can
follow, so mis-pairing has no consequence worth the change." That label had been produced by a single
analysis pass and never independently verified. If it held, those rows close with documented
reasoning and no code, which is real completion rather than deferral.

**It does not hold for more than half of them.**

| Verdict | Rows |
|---|---:|
| CONFIRMED-P3 — genuinely bounded | **8** |
| MIS-BUCKETED to P1 | **4** |
| MIS-BUCKETED to P2 | **5** |
| UNRESOLVED | 0 |

## What this changes

- **8 rows can be closed** with the bounding reason recorded — each names the structure that makes a
  durable effect impossible, not merely that no path was found.
- **9 rows become work that was not previously counted**: 4 with an obvious predicate and existing
  helper, 5 needing an authorization decision. The P1 and P2 populations both grow.

The net effect on the program is roughly neutral in count and strongly positive in accuracy: we
traded an optimistic "17 free closures" for 8 real ones and 9 defects that would otherwise have been
dismissed by label.

## The discipline that produced the correction

The brief required that **"I could not find a path" is UNRESOLVED, not CONFIRMED-P3** — a CONFIRMED
verdict had to name the structural bound. Under that rule the analysis returned zero UNRESOLVED and
nine reclassifications. Under the weaker rule, most of the nine would plausibly have been waved
through as "no path found".

This is the third time in this program that the difference between *could not construct* and
*cannot exist* has changed a verdict. It should be treated as a standing requirement for any
"no action needed" classification, not a per-task instruction.

## Analysis caveat, recorded

The verification ran in a read-only sandbox that could not write `.git/FETCH_HEAD` or resolve
`git ls-remote`, so it inspected detached `HEAD == local origin/main == 097df2338` (2026-08-24
12:17). Remote movement after that point is not excluded; re-verify any row whose surrounding code
has since changed.

---


Fetch limitation: I ran `git fetch origin main` first, but the read-only sandbox prevented writing `.git/FETCH_HEAD`; `git ls-remote` also could not resolve GitHub. The inspected tree is detached `HEAD == local origin/main == 097df233848ce99c39c662042efd906e91d00e49`, timestamped 2026-08-24 12:17:39 -0700. Remote movement after that cannot be excluded.

| Row | Current site and what it mints | Verdict | Structural bound or concrete effect path |
|---|---|---|---|
| F006 | [provider.rs:3096](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3096) — an `OwnedMutexGuard<()>` for a hash stripe selected by the idempotency key. | **CONFIRMED-P3** | The return type carries only a unit mutex guard and is not passed into the guest transaction. Production stores it as `_idempotency_guard` at [server.rs:19529](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:19529); the durable plan independently receives the key at [server.rs:19534](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:19534), and the database rejects a mismatched request digest at [auth_catalog_ops.rs:1475](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_catalog_ops.rs:1475). A wrong guard can only change serialization. |
| F043 | [provider.rs:3283](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3283) — a read plan returning `StepUpCoordination` containing challenge, address, and key selection. | **MIS-BUCKETED — P2** | A selected live challenge can be combined with a wrong code or binding by `for_step_up` at [provider.rs:3448](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3448). Although that cannot authorize the operation, later consumption **durably increments the challenge’s attempts** when the digest fails at [auth_catalog_ops.rs:2865](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_catalog_ops.rs:2865). Policy must decide who may spend another challenge’s attempt budget. |
| F044 | [provider.rs:3293](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3293) — a read plan returning an optional `ExchangeCoordination` for a caller-selected challenge. | **MIS-BUCKETED — P2** | `for_exchange` turns it into an exchange admission at [provider.rs:4016](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:4016). A wrong code reaches the writer transaction and durably increments `attempts` at [auth_catalog_ops.rs:1610](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_catalog_ops.rs:1610). Exact code verification bounds credential issuance, but not the durable failure write. |
| F054 | [provider.rs:3448](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3448) — a `StepUpProofAdmission` holding an address stripe and a computed `StepUpProof`. | **MIS-BUCKETED — P2** | A mismatched coordination/binding/code produces a bad submitted digest at [provider.rs:3455](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3455), which can be supplied to production consumers such as [server.rs:17280](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:17280). Durable consumption charges the challenge attempt before rejecting at [auth_catalog_ops.rs:2868](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_catalog_ops.rs:2868). |
| F055 | [provider.rs:4016](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:4016) — an `ExchangeAdmission` holding preliminary coordination and its address mutex. | **MIS-BUCKETED — P2** | `commit_planned_issuance` uses this admission at [provider.rs:4188](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:4188); an invalid submitted code commits the challenge-attempt update at [auth_catalog_ops.rs:1615](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_catalog_ops.rs:1615). The stripe and later credential check do not bound that durable write. |
| F063 | [provider.rs:4362](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:4362) — a password-authentication preparation for the `AddressAdmission`’s selected address, including credential and failure-ledger snapshots. | **MIS-BUCKETED — P2** | `finish_password_authentication` performs the KDF and records `verified` in the plan at [provider.rs:2101](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:2101). A wrong password does not mint a session, but the writer deliberately calls `record_password_failure_in` at [auth_identity.rs:1351](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_identity.rs:1351), durably advancing the selected account’s failure/lockout ledger. Whether arbitrary login attempts may charge that subject is an abuse-policy decision. |
| F089 | [types invalidation.rs:495](/Users/ccheever/projects/snapback/crates/snapback-types/src/auth/invalidation.rs:495) — mutates a caller-owned `RetryEpisodeRegistry` and returns a `RetryReservation`. | **CONFIRMED-P3** | There is no production caller of this method. Production persistence uses the distinct, private `PersistedRetryEpisodeRegistry` at [kernel auth_invalidation.rs:44](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_invalidation.rs:44) and its own transaction wrapper at [kernel auth_invalidation.rs:672](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_invalidation.rs:672). The public in-memory registry has no Snapback durable or authority sink. |
| F091 | [session_projection.rs:175](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:175) — a borrow-tied `BoundConnectionSessionIdentity` carrier. | **CONFIRMED-P3** | Its fields are private, and its sole production consumer compares incarnation, session, user, provider, generation, deadline, and terminal state at [session_projection.rs:1630](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:1630) before constructing authority at [session_projection.rs:1676](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:1676). |
| F096 | [session_projection.rs:1138](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:1138) — an `Arc<SessionFence>` selected by session ID. | **CONFIRMED-P3** | `SessionFence` is crate-private at [session_projection.rs:317](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:317), its operative methods are private beginning at [session_projection.rs:332](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:332), and the method has no caller. The selected handle cannot cross into an authority-producing API. |
| F242 | [room_authority.rs:926](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/room_authority.rs:926) — a `RoomCreationAdmission`. | **CONFIRMED-P3** | The type contains only a private mutex guard and has no methods at [room_authority.rs:1729](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/room_authority.rs:1729). Production binds it to `_authority` while accessing a private room map at [ephemeral.rs:6754](/Users/ccheever/projects/snapback/crates/snapback-sync/src/ephemeral.rs:6754); callers holding the admission cannot themselves create a room or write durable state. |
| F243 | [room_authority.rs:940](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/room_authority.rs:940) — a `RoomRetirementAdmission` for a selected room. | **CONFIRMED-P3** | Its only operation marks/removes that room in the process-local registry and notifies waiters at [room_authority.rs:1739](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/room_authority.rs:1739). It can cause transient fail-closed retirement, but exposes neither a durable writer nor an authority constructor. |
| F285 | [engine.rs:21731](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21731) — a staged live-unsubscribe plan binding independently supplied input, authority, and effect fence. **Moved from `21687`.** | **MIS-BUCKETED — P1** | Use an owned subscription/fence B but place victim connection ID A in the input. Final ownership checks only authority and fence at [engine.rs:21673](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21673); it never compares the input ID with the subscription or `PreparedConnectionAct`, then touches A at [engine.rs:21691](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21691). `touch` inserts/refreshes A at [engine.rs:2437](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:2437), and the background reaper preserves it at [engine.rs:2472](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:2472). Exact act-ID binding is already available through `PreparedConnectionAct` and `try_act` at [server.rs:8740](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:8740). |
| F286 | [engine.rs:21825](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21825) — a staged invalidation-ACK plan binding input, connection descriptor, admission lease, and independently supplied effect fence. **Moved from `21781`.** | **MIS-BUCKETED — P1** | Finalization touches the caller-selected input connection **before** checking the installed invalidation connection or ACK token at [engine.rs:21784](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21784), so even a failing ACK can refresh another connection and preserve its live authority through the reaper. Separately, a supplied descriptor and matching foreign ACK token reach obligation discharge at [auth invalidation.rs:1330](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/invalidation.rs:1330). Input, descriptor, admission, and fence must derive from the same existing `PreparedConnectionAct`. |
| F287 | [engine.rs:22005](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22005) — a staged manual-retry plan. **Moved from `21961`.** | **CONFIRMED-P3** | Before the manual-retry operation can touch liveness or reserve durable retry state, finalization requires input connection equality plus exact authority/fence ownership at [engine.rs:22039](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22039). The operation then requires the descriptor’s issuer and generation to equal the subscription scope at [engine.rs:21914](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21914), before the durable reservation at [engine.rs:21940](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21940). |
| F288 | [engine.rs:22625](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22625) — a staged live-resume plan containing independently supplied input, authority, and `LiveInvalidationAdmission`. **Moved from `22581`.** | **MIS-BUCKETED — P1** | Finalization touches the caller-selected connection ID before subscription lookup or ownership validation at [engine.rs:22121](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22121), permitting lazy-liveness extension even when resume later fails. In addition, the separately supplied invalidation descriptor is checked only against global issuer/version state at [engine.rs:22190](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22190), after which its generation is used to register a new live scope at [engine.rs:22225](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22225). Exact act ID, fence, and descriptor must be one opaque binding. |
| C004 | [session_projection.rs:150](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:150) — direct construction of a `ProjectedSessionAuthority` data value. | **CONFIRMED-P3** | The only authority-producing sink is private `CoordinatorTopology::prepare_bearer_authority` at [coordinator.rs:1976](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1976). Public coordinator entry points obtain its argument directly from locked projection resolution at [coordinator.rs:1508](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1508); no API accepts a caller-constructed value or wrapper enum. |
| C009 | [auth invalidation.rs:110](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/invalidation.rs:110) — direct construction of an `AuthorizationInvalidationConnection` descriptor, including caller-selected connection generation. | **MIS-BUCKETED — P1** | `LiveInvalidationAdmission::new` accepts this descriptor beside an independent fence at [engine.rs:4201](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:4201). `accepts_connection` checks issuer, authorization incarnation/epoch, and version stream but not binding to the current act or whether the generation belongs to it at [engine.rs:3741](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:3741). Resume then uses that generation to create and install a live subscription scope at [engine.rs:22225](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22225). Production already holds the exact descriptor and fence together in `PreparedConnectionAct` at [server.rs:6142](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:6142), making this P1. |

### Counts

| Verdict | Count |
|---|---:|
| CONFIRMED-P3 | **8** |
| MIS-BUCKETED → P1 | **4** |
| MIS-BUCKETED → P2 | **5** |
| UNRESOLVED | **0** |
| Total | **17** |

### Ticket-ready closure reasons

- **F006:** “The factory returns only a process-local unit mutex guard; the guard is discarded as an input and durable idempotency is independently enforced by exact key and request digests.”
- **F089:** “The method mutates only a caller-owned in-memory registry, while production persistence uses a distinct private kernel registry and no production authority consumer accepts its result.”
- **F091:** “The borrow-tied carrier’s private fields are compared against the exact live projection incarnation, session, user, provider, generation, deadline, and terminal state before authority is constructed.”
- **F096:** “The selected fence has a crate-private type with private operative methods and no caller, so it cannot cross into a durable or authority-producing sink.”
- **F242:** “`RoomCreationAdmission` contains only a private mutex guard with no methods, and the only room-creation map is private to the production caller that acquires it from the same room and generation.”
- **F243:** “The admission can only perform fail-closed retirement/removal in the process-local room registry; it exposes neither a durable writer nor an authority constructor.”
- **F287:** “Exact input connection, authority, effect fence, issuer, and connection generation are all rechecked against the retained subscription before any durable retry reservation or live effect.”
- **C004:** “Although the data fields are public, the only authority-producing consumer is private and receives values solely from locked projection resolution; no API accepts a caller-constructed value.”

Rows not located on the inspected main: **none**.

Rows whose bucket-document sites moved: **F285, F286, F287, and F288**, each by +44 lines.

## Resolution

Closed 2026-08-25 as superseded. The file already pointed at
`issues/20260825-p3-low-top-six-execution.md`, which falsified the six attempted
P3-LOW bounds including this document's CONFIRMED-P3 verdicts. Remaining P3
work lives in that successor and
`issues/20260825-twelve-of-seventeen-p3-rows-need-execution.md`. Do not use this
ticket's old counts or closure reasons to retire rows.
