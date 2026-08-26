# The row acceptance ledger: 62 units of independent work remain

> **CORRECTION (2026-08-26): these dispositions have now been executed, and 11 of 28
> tested units were WRONG.** See
> [`issues/20260826-row-acceptance-ledger-execution-report.md`](20260826-row-acceptance-ledger-execution-report.md).
> The sampled DELETED error rate was **5 of 10**, and every error pointed the same way —
> **false DELETED**, a public route still reached the authority effect. Six of fifteen
> OUTSIDE-AUTHORITY-CREATION units were also wrong: their compositions created grants,
> sessions, or challenges leading to sessions. Do not quote the counts below as settled
> work remaining without that report. The sample was purposive and cross-crate, so 5/10
> measures that sample and is **not** a confidence interval for the 37 unsampled deletions.

**Status:** open (living measurement)
**Produced:** 2026-08-26, read-only audit of `4eb138b55`. No build or attack executed.

Answers the question the open-row count obscures: **how much work actually remains.** The
answer is **62 independent units**, not 112 — because 67 of the 133 units stop being separate
work once the chokepoint absorbs them, 47 are deletions rather than implementations, 3 are
powerless, and 15 sit outside authority creation entirely.

It also corrects the denominator **upward**: applying LLP 0303 revision (s) honestly, F094 and
C009 do not qualify as closed — their evidence is compile refusal against an obsolete spelling
with no recorded post-fix alternate-route execution. Qualifying closures are 21, so the open
floor is **112, not 111**.

Every claim is labelled READ-CONFIRMED or INFERRED. Preserve that distinction when quoting.

Requested by LLP 0313 §10, which recommends the row inventory become an acceptance ledger.

---

# Authority-creation acceptance ledger

**READ-CONFIRMED:** Analysis is against `HEAD 4eb138b5507fa3988ccc5c5fea7e8b2bb60bdea4`. No build or attack was run.

## Headline

| Unique defect disposition | Count |
|---|---:|
| `ABSORBED(<AuthorityPurpose>)` | **67** |
| `DELETED` | **47** |
| `POWERLESS` | **3** |
| `OUTSIDE-AUTHORITY-CREATION` | **15** |
| `UNCLASSIFIED` | **1** |
| **Total programme floor** | **133** |

**INFERRED — remaining independent implementation work: 62 unique units, range 62–63 pending F287.**

That is:

- 47 deletion units
- 15 defects outside authority creation
- 67 units absorbed as chokepoint acceptance coverage
- 3 powerless units requiring no implementation
- 1 unsettled unit

For the 124 inventoried actionable units alone, **61 remain independent, range 61–62**. The 62nd programme unit is the unrowed raw-SQL re-export.

These are row/effect acceptance units, not necessarily 62 separate commits: several deletions should land atomically.

### Normalization

| Population | Deleted | Absorbed | Powerless | Outside | Unclassified | Total |
|---|---:|---:|---:|---:|---:|---:|
| 134 historical row spellings | 47 | 68 | 3 | 15 | 1 | 134 |
| Plus later additive row | 48 | 68 | 3 | 15 | 1 | 135 |
| Less 11 duplicate aliases | 46 | 59 | 3 | 15 | 1 | **124** |
| Plus nine unrowed defects | **47** | **67** | **3** | **15** | **1** | **133** |

**READ-CONFIRMED:** The excluded aliases are F002, F014, F019, F078, F095, F161, F162, F189, F264, F265, and F312. They still receive dispositions below.

**READ-CONFIRMED:** LLP 0313 requires a closed, one-to-one `AuthorityPurpose`/`AuthorityMutation` registry but does not name variants. The CamelCase names below are **INFERRED proposed ledger names**, not current Rust identifiers.

A disposition is a final-state target, not a claim that the row is currently closed.

## `DELETED`

All dispositions in this section are **INFERRED**.

| Row | One-line justification |
|---|---|
| F001 | Delete the generic closure-to-`LocalDatabase` plan factory; exact `ServingDatabase` ceremonies replace arbitrary plans. |
| F002† | Delete the provider wrapper with the dormant authorized-lease mechanism; alias of F073. |
| F005 | Delete generic `AddressAdmission` as authority custody; an email remains only an untrusted selector. |
| F056 | Delete the canonical-address form of generic address admission. |
| F068 | Delete the rehearsal-window challenge wrapper with rehearsal authority. |
| F073 | Delete dormant public authorized-lease minting until an exact consumer and purpose exist. |
| F075 | Delete the shape-only invalidation-issuer constructor. |
| F081 | Delete the ambient signer API authenticating caller-supplied issuer/target/app facts. |
| F084 | Delete obligation-registry construction from caller-authored expectations. |
| F089 | Delete the feature-public retry-persistence path that durable-writes caller-owned registry output. |
| F091 | Delete the public from-parts bound-session constructor. |
| F094 | Delete arbitrary `ProjectionSource` rebuild as an authority producer. |
| F095† | Delete the fresh-startup-ID wrapper with F094. |
| F113 | Delete public service-witness registration; durable resolution derives the witness internally. |
| F115 | Delete arbitrary fact-asserting terminal callbacks and factories. |
| F118 | Delete public conversion from caller-constructible `ExactGrantScope`. |
| F119 | Delete public `ResolvedSession` to app-authority conversion. |
| F120 | Delete public `ResolvedScopedToken` to service-authority conversion. |
| F121 | Delete caller-selected `DevImpersonation` construction. |
| F122 | Delete public claims-plus-authority projection construction. |
| F126 | Delete deferred rehearsal binding. |
| F127 | Delete generic session-publication attachment. |
| F128 | Delete generic service-publication attachment. |
| F133 | Delete the raw stream-incarnation setter. |
| F143 | Delete generic admission-plus-resolved-authority preparation. |
| F144 | Delete the sibling general prepared-authority join. |
| F149 | Delete the descriptor factory accepting an independent stream incarnation. |
| F150 | Delete descriptor construction from a caller-obtainable resolved authority. |
| F157 | Delete bearer-free reusable retained-session authority. |
| F160 | Delete the generally movable session-authority-plus-fence carrier. |
| F202 | Delete rehearsal-window authority outright. |
| F210 | Delete `Anonymous` as an authority value; anonymous access is absence of credentials. |
| F212 | Delete `AdminBypass`; LLP 0313 excludes `Admin`/`System` authority classes. |
| F232 | Delete public caller-selected membership-writer variants. |
| F233 | Delete the sibling writer-plus-consent conversion. |
| F302 | Delete the generic caller-I/O secret-root helper; retain only pinned owner provisioning. |
| F305 | Delete assertion-based hosted-target construction. |
| C001 | Delete public fact-asserting `ResolvedSession` construction. |
| C002 | Delete public all-fields `ResolvedScopedToken`. |
| C003 | Delete public all-fields `ExactGrantScope` in its authority role. |
| C004 | Delete public construction/rebuild of projected session authority. |
| C005 | Delete the legacy publicly constructible `ResolvedAppAuthority` vocabulary. |
| C006 | Delete the public all-fields service witness. |
| C007 | Delete the public `ResolvedMembershipWriter` assertion enum. |
| C009 | Delete the fact-asserting all-fields invalidation-connection carrier. |
| C012 | Delete `AuthorityDescriptor` as a caller-supplied fact assertion; a wire echo may remain ordinary payload. |
| C013 | Delete public selector-bearing authorization preflight. |
| ADD-TS-01 | Delete feature-public `seed_grant_revocation_watch_for_test`. |

## `ABSORBED(<AuthorityPurpose>)`

All dispositions and purpose names in this section are **INFERRED**.

| Row | Disposition and justification |
|---|---|
| F011 | `ABSORBED(IssueSessionCredential)` — derive the response/bearer from the exact committed rotation. |
| F014† | `ABSORBED(IssueSessionCredential)` — same exact-outcome purpose after password change. |
| F019† | `ABSORBED(IssueSessionCredential)` — guest issue consumes its exact committed session/revocations. |
| F020 | `ABSORBED(CommitGuestSessionIssuance)` — guest context and issuance become one composite mutation. |
| F022 | `ABSORBED(IssueSessionCredential)` — a response cannot be supplied beside a plan. |
| F032 | `ABSORBED(ClaimGuestAddress)` — guest bearer, delivery proof, address and successor are one ceremony. |
| F037 | `ABSORBED(ClaimGuestAddress)` — fold raw identifier preparation into the same ceremony. |
| F053 | `ABSORBED(RecordAuthenticatedUse)` — derive session, generation and database from the connection authority. |
| F061 | `ABSORBED(ClaimGuestAddress)` — admission cannot independently select the claim address. |
| F062 | `ABSORBED(RegisterPasswordIdentity)` — registration follows exact delivery or existing-identity proof. |
| F069 | `ABSORBED(IssueHostSession)` — proof-free issuance requires a sealed host/administrator purpose. |
| F070 | `ABSORBED(CommitSessionIssuance)` — admission and issuance are one operation. |
| F078† | `ABSORBED(RetireInvalidationScope)` — alias of F082’s retirement effect. |
| F082 | `ABSORBED(RetireInvalidationScope)` — namespace/prefix derive from the owned obligation/stream. |
| F097 | `ABSORBED(PrepareSessionPublication)` — publication derives from the prepared subject and producer instance. |
| F100 | `ABSORBED(IssueProjectedSession)` — projection insertion consumes the durable issuance receipt. |
| F101 | `ABSORBED(MutateProjectedSession)` — rotation/terminalization derives the selected session. |
| F102 | `ABSORBED(ExpireProjectedSession)` — expiry derives subject and verified time from the resource. |
| F112 | `ABSORBED(TerminalizeServiceAuthority)` — derive exact token set and disposition. |
| F117 | `ABSORBED(TerminalizeServiceAuthority)` — consume a receipt binding meaning, tokens, disposition and database. |
| F145 | `ABSORBED(PrepareAssetCallback)` — derive service subject/scope from the active catalog and callback function. |
| F146 | `ABSORBED(PrepareOwnerBoundDevOperation)` — derive subject from authenticated project ownership. |
| F161† | `ABSORBED(ReserveAuthorizationCommitRooms)` — alias of F240. |
| F162† | `ABSORBED(BeginProtectedRoomAct)` — alias of F237. |
| F170 | `ABSORBED(RegisterIntegrationPrincipal)` — mode, invitation, owner, database and credential issuance become one ceremony. |
| F171 | `ABSORBED(BeginOAuthConsent)` — consenting user derives from the management session. |
| F172 | `ABSORBED(ApproveOAuthGrant)` — effective user, request and scopes derive from exact predecessors. |
| F173 | `ABSORBED(IssueOAuthAuthorizationCode)` — consume the exact approved request. |
| F175 | `ABSORBED(ResolveServiceAuthority)` — token, grant, subjects and publication derive together. |
| F182 | `ABSORBED(RegisterAgentPrincipal)` — read active mode in-transaction and commit one registration mutation. |
| F183 | `ABSORBED(MintAgentInvitation)` — inviter, step-up and invitation are one ceremony. |
| F185 | `ABSORBED(MintPairingCode)` — effective user derives from the management session. |
| F187 | `ABSORBED(PresentPairingGrant)` — credential, request, code and scopes form one explicit relation. |
| F188 | `ABSORBED(ApproveGrant)` — consume exact request, approver and consent predecessor. |
| F189† | `ABSORBED(TerminalizeServiceAuthority)` — alias of F112. |
| F190 | `ABSORBED(RevokeGrant)` — derive user and grant from target-bound management authority. |
| F191 | `ABSORBED(RevokeGrants)` — derive bulk actor/effective-user selection. |
| F205 | `ABSORBED(RevokeIntegrationTokensAsAdministrator)` — exact administrator-anchor purpose. |
| F211 | `ABSORBED(PrepareOwnerBoundDevOperation)` — consume only the exact owner-bound operation. |
| F213 | `ABSORBED(PrepareOperatorOperation)` — derive operator authority from the store-bound anchor. |
| F215 | `ABSORBED(PrepareServiceOperation)` — derive service resolution and both publications together. |
| F220 | `ABSORBED(ReconcileSemanticCommit)` — intent instance, rows, value and receipt form one semantic commit. |
| F224 | `ABSORBED(SendPush)` — recipient/audience derive from authority or an explicit relation. |
| F227 | `ABSORBED(TerminalizeServiceAuthority)` — delegate only the private receipt ceremony. |
| F236 | `ABSORBED(CommitMembershipTransition)` — policy-derived writer and plan share one operation. |
| F237 | `ABSORBED(BeginProtectedRoomAct)` — participant, room, generation and act derive together. |
| F238 | `ABSORBED(BeginProtectedRoomAct)` — sibling guard for the same operation. |
| F240 | `ABSORBED(ReserveAuthorizationCommitRooms)` — selectors derive from the staged mutation/write set. |
| F244 | `ABSORBED(CompleteRoomReauthorization)` — derive generation and discharged obligation together. |
| F264† | `ABSORBED(ReconcileSemanticCommit)` — uncertain retention belongs to the receipt. |
| F265† | `ABSORBED(ReconcileSemanticCommit)` — final cut, intent and retention share one identity. |
| F270 | `ABSORBED(StageAssetUpload)` — attempt, caller, offset and staging write derive together. |
| F272 | `ABSORBED(CommitAssetWidthPublication)` — width ticket, route reservation and publication form one purpose. |
| F273 | `ABSORBED(CommitAssetPublication)` — derive the PUT/cleanup lease from the proof-bound publication. |
| F279 | `ABSORBED(CommitRecordedMutation)` — descriptor, mutation identity and write set derive internally. |
| F280 | `ABSORBED(CommitRecordedMutation)` — independently enumerated generation-bearing sibling. |
| F281 | `ABSORBED(CommitRecordedMutation)` — settlement/issuance join the exact mutation. |
| F282 | `ABSORBED(CommitRecordedMutation)` — wire/media fields become ordinary checked payload. |
| F283 | `ABSORBED(SubscribeLive)` — authority, connection, subscription, invalidation and fence derive together. |
| F284 | `ABSORBED(SubscribeLive)` — optional generation cannot preserve an alternate raw route. |
| F285 | `ABSORBED(UnsubscribeLive)` — ownership and fence form one operation. |
| F286 | `ABSORBED(AcknowledgeInvalidation)` — derive connection, descriptor, token, admission and fence before effects. |
| F288 | `ABSORBED(ResumeLive)` — derive input, subscription, authority and generation before touching liveness. |
| F297 | `ABSORBED(AuthorizeSecretRead)` — exact operator/root approves and consumes scopes/budgets. |
| F298 | `ABSORBED(AuthorizeSecretRead)` — public wrapper for the same purpose. |
| F299 | `ABSORBED(AuthorizeSecretRead)` — proof root, nonce and registry are one producer-bound ceremony. |
| F306 | `ABSORBED(ActivateHostedServing)` — authenticated target, authorization incarnation and boot lineage derive together. |
| F312† | `ABSORBED(ActivateHostedServing)` — alias of F306. |

## `POWERLESS`

These classifications are **INFERRED from current structure, not runtime-measured closure**.

| Row | Justification |
|---|---|
| F006 | `OwnedMutexGuard<()>` carries only stripe serialization; durable idempotency is checked independently by exact key/request digest. |
| F096 | The returned `SessionFence` is crate-private, its operative methods are private, and no authority-producing caller is recorded. |
| F242 | `RoomCreationAdmission` contains only a private mutex guard and has no methods. |

**READ-CONFIRMED limitation:** The repository’s adversarial plan calls all three GREEN but expressly says GREEN is not measured closure. Before decrementing the current open denominator, execute:

- F006 with mismatched keys/provider handles against one SQLite resource.
- F096 by obtaining a victim-selected fence and attempting every reachable consumer.
- F242 with a mismatched room/generation and observation of room/authority state.

No other row is supportable as POWERLESS from the commissioned sources:

- F089 was persisted by an executed additive-feature composition.
- F091 authorized both cloned databases.
- C004 and C009 produced forged application/live authority.
- F287 remains unsettled.
- C012-like public DTOs do not become powerless merely because a future design could treat them as wire echoes.

## `OUTSIDE-AUTHORITY-CREATION`

All dispositions are **INFERRED**.

| Row | Justification |
|---|---|
| F043 | Selecting whose step-up attempt budget is charged is abuse/availability accounting. |
| F044 | Selecting whose exchange attempts advance is abuse accounting; successful credential issuance remains proof-checked. |
| F054 | A mismatch can consume another challenge attempt before refusal: lockout/DoS, not authority creation. |
| F055 | A mismatched exchange can commit another challenge’s failure update. |
| F063 | The residual effect is advancing another account’s failure/lockout ledger. |
| F067 | Challenge delivery precedes ownership by design; LLP 0303 Q39 says rate-limit/monitor. |
| F129 | False caller/approver audit attribution is an audit-integrity defect, not authority creation. |
| F203 | Selecting whose ask budget is charged is unresolved Q13 billing policy. |
| F204 | Same Q13 billing defect through the authorized-effect wrapper. |
| F243 | Caller-selected in-memory room retirement is an availability/destruction defect. |
| F257 | Kernel wrapper persists the same caller-selected billing subject. |
| F258 | A callback guard does not change the billing nature. |
| F259 | Serving wrapper remains Q13 billing work. |
| F260 | Guarded serving wrapper remains Q13 billing work. |
| C014 | `AskSpendSubject` selects a payer; it requires derivation or an explicit relation but is outside authority creation. |

## `UNCLASSIFIED`

| Row | Settling evidence |
|---|---|
| F287 | **READ-CONFIRMED unsettled.** Clone/rebuild the manual-retry stage, cross engine/connection/issuer instances, and assert refusal occurs before connection touch, obligation mutation or durable retry reservation. Refusal supports `POWERLESS`; any effect yields `ABSORBED(AcknowledgeInvalidationManualRetry)`. |

## Nine unrowed defects

| Effect | Disposition |
|---|---|
| Protected-record erasure | **INFERRED `ABSORBED(EraseProtectedRecords)`** — exact administrator-anchor purpose. |
| Pending-effect creation | **INFERRED `ABSORBED(CreatePendingEffect)`**. |
| Pending-effect refusal | **INFERRED `ABSORBED(RefusePendingEffect)`**. |
| Pending-effect approval | **INFERRED `ABSORBED(ApprovePendingEffect)`** — explicit cross-principal relation. |
| Pending-effect denial | **INFERRED `ABSORBED(DenyPendingEffect)`**. |
| Pending-effect settlement | **INFERRED `ABSORBED(SettlePendingEffect)`** — exact execution receipt. |
| Promotion-contention activation | **INFERRED `ABSORBED(ActivatePromotionContention)`**. |
| Direct `MembershipWriter::Admin` plan/commit | **INFERRED `ABSORBED(CommitMembershipTransition)`** — public Admin assertion disappears. |
| Raw SQLite re-export | **INFERRED `DELETED`** from every production/additive feature closure. |

## Contradictions

1. **READ-CONFIRMED:** The row fixture now contains 27 attacks and 23 `CLOSED` labels. LLP 0313 says 26/22, and the denominator report assumes 22 ledger closures. F220 was added later.

2. **READ-CONFIRMED:** F182 is `CLOSED` in the executable ledger because two obsolete partial APIs no longer compose, but the seam map and blocker graph show the same registration effect runtime-open through stale schema on a second handle.

3. **READ-CONFIRMED:** C009’s current evidence is `E0451` on a literal; the earlier executed composition installed a never-issued generation and reached durable retry state. No commissioned post-fix alternate-route execution is recorded.

4. **READ-CONFIRMED:** F094’s earlier closure was rejected because raw rebuild compiled under unified `test-support`. Its current evidence is `E0624` against the old spelling, with no recorded post-fix alternate-route execution.

5. **READ-CONFIRMED:** F170’s current fixture correctly says `OPEN`: the foreign-lease route refuses, but a second `LocalDatabase` reaches integration registration. This corrects its historical false closure.

6. **READ-CONFIRMED:** F097/F127 lost their old spellings in all 14 cells, yet split-and-publish and fork compositions reached the effect. Both remain open; F128 also blocks F215.

7. **READ-CONFIRMED:** Settlement’s witness refuses obsolete `&str`, while the live consumer accepts a publicly obtainable execution ticket plus independent `executed`/`outcome_code`.

8. **READ-CONFIRMED:** The denominator says no security attack declares `row`/`rows`. The current security ledger now maps F220, making “none” stale, although the nine undercounted effects remain unmapped.

9. **READ-CONFIRMED:** The factory inventory summary reports 123 function `LIVENESS-ONLY` entries, but its current table reclassifies F170/F182; parsing yields 121 function plus 11 carrier liveness entries. The 134-row programme survives only as a historical row identity set.

10. **READ-CONFIRMED:** The P4 issue opens with 12 duplicates/120 actionable but its later correction makes F280 a sibling and settles on 11/123. The later figure governs.

11. **READ-CONFIRMED:** LLP 0291’s `F01`–`F16` are additive family labels, not row IDs `F001`–`F312`. Its 46 families are end-to-end forgeries; the row inventory contains declaration-level factories and unrelated billing, room, asset, abuse and audit effects.

12. **READ-CONFIRMED:** LLP 0291 folds wrappers and excludes pure DoS/metadata, while the row inventory counts declarations; conversely, the denominator found nine effects absent from the row inventory. Neither instrument substitutes for the other.

## Denominator sanity check

**READ-CONFIRMED:** `123 unique historical rows + 1 additive row + 9 unrowed defects = 133`. No tenth distinct defect was found in the commissioned sources.

Therefore, **133 total remains the correct floor**.

The open floor is **at least 112, not 111 — INFERRED arithmetic**:

1. Denominator report: 22 firm closures.
2. F220 later landed and was independently reviewed closed: 23.
3. Apply LLP 0303(s): F094 and C009 remain unsettled because the commissioned post-fix evidence is compile refusal without recorded alternate-route execution: 21 qualifying closures.
4. `124 − 21 + 9 = 112 open`.

F182 was already excluded and replaced by F297 in the denominator’s closure arithmetic. F102 is not subtracted because its reviewed branch result is not shown landed in this checkout.

**INFERRED final denominator: at least 133 total / 112 open.** Running valid post-fix alternate-route attacks for F094 and C009 could lower the floor to 110; new routes or unrowed effects can only raise it.
---

## Supervision note 2026-08-26: the 47 deletions are not 47 available tasks

I sized several deletion units to dispatch as parallel work, on the reasoning that LLP 0313 §10
green-lights "final-state subtractive deletion" regardless of the §11 ruling. That reasoning is right
but the work is not available yet, for two reasons.

**They belong to atomic groups.** LLP 0313 §8 requires certain deletions to move together — writer
relocation with authorizer enforcement and every alternate protected writer; `LocalDatabase`
privatization with raw accessor/adoption/dereference deletion; old in-memory producer deletion with
exact prepared operations, every consumer, and the HTTP transport. Measured sizes bear this out:
`AdminBypass` has **68** references and `Anonymous`-as-an-authority-value **137**, across engine,
kernel, runtime, and host-glue. Deleting either standalone would fight the landing sequence rather than
advance it. The ledger says as much — "not necessarily 62 separate commits: several deletions should
land atomically" — and that qualifier is load-bearing.

**One deletion contradicts the design it is meant to serve.** F202 reads "delete rehearsal-window
authority outright", but LLP 0313 §4 lists **non-production rehearsal** among the surviving derived
`AuthorityClass` values. Either the caller-constructible rehearsal-window *wrapper* is the thing being
deleted while the derived class survives — in which case F202's wording should say so — or §4 should
drop rehearsal. `rehearsal` currently spans **43 files** including the CLI, migration, and schema
export, so it is a live feature and not a test-only concept. This needs settling before anyone starts.

**Consequence for scheduling:** deletion work is gated on landing-sequence position, not available as
parallel filler between review cycles. The practical order stays A → B → C → D → E. Attempting
deletions out of order buys nothing and risks a rebase against the landing that was supposed to carry
them.

## The three suspect closures, settled by execution — 2026-08-26 (`250d653bd`)

The Contradictions section above flagged three rows whose closure evidence did not meet LLP 0303
revision (s). All three were re-tested by **running an alternate composition**, not by reading. One was
a false closure.

**F182 — OPEN.** It was recorded CLOSED because two obsolete partial APIs no longer compose. The seam
map's disagreement was correct. The executed composition:

> Open handle A and publish agents mode `Open`. Open handle B on the same SQLite file and publish
> agents mode `Disabled`. Use the **stale** handle A to call `register_agent_principal`. A third handle
> then resolves the issued secret and returns the same durable user, credential, and generation.

Reached the effect in **both** production and additive-test-support cells. **No error code fired** —
the call returned `Ok` at `tests/fixtures/row-attacks/src/attacks/f182.rs:47`, with durable readback
succeeding at line 60. The ledger has been corrected to OPEN.

**F094 — genuinely CLOSED.** The obsolete `SessionProjection::rebuild` spelling was replaced with a real
alternate: read database A's public raw projection source, create a public admission controller, combine
those with database B's public binding via the public `PreparedLocalSessionCoordinator`, and pass it to
`AuthCoordinator::from_prepared_local_session_database`. Both cells refuse the carrier literal itself
with **`E0451`** at its private-field span, *before* the consumer. The recorded `expectedCode` is now
that code rather than the removed spelling's.

**C009 — genuinely CLOSED.** The historical `Clone` route was replayed: clone a real
`AuthorizationInvalidationConnection`, set the clone's generation to `connection_generation() + 10_000`,
wrap it in `LiveInvalidationAdmission`, and supply it to the live-resume consumer preceding the
failure/manual-retry/durable-retry suffix. `Clone` is still available, but both cells refuse the
never-issued-generation assignment with **`E0616`**, so resume and the durable retry-state operations
are never reached.

## What this changes

**F182 is the second confirmed false closure**, after F170. Both were recorded CLOSED on compile-fail
evidence while a runtime route reached the effect through a *second handle*. That is now a named
pattern rather than a coincidence: **compile-fail evidence cannot see a second-handle route**, because
nothing about the second handle is a spelling.

The audit's value was in the ratio as much as the finding — two of three suspicions were wrong, and
saying so is what makes the third credible. Closure counts move to **28 qualifying**, and the open
floor to **113**.
