# The row consumer-blocker graph is concentrated, but it is not the whole programme

Status: open
Date: 2026-08-26
Systems: snapback-auth, snapback-engine, snapback-kernel, snapback-server, snapback-sync,
  snapback-types, test-support
Related: issues/shelved/20260824-implementation-plans-remaining-p2-rows.md,
  issues/shelved/20260824-liveness-row-bucket-assignment.md,
  issues/shelved/20260825-the-strict-family-is-not-batchable-45-roots-for-58-rows.md,
  issues/shelved/20260825-the-critical-path-is-the-shared-surface-not-the-rows.md,
  issues/shelved/20260825-test-support-accessors-now-block-named-rows.md,
  llp/0303-subject-authority-correlation-policy.decision.md,
  llp/0311-bind-the-authorization-interlock-to-the-database-resource.rfc.md,
  llp/0312-origin-bound-asset-carriers.rfc.md

## The question

The previous programme analysis counted producer roots: 45 roots for 58 strict rows, 38 singleton
roots, and no useful root worth more than one immediately executable row. This analysis asks the
other half of LLP 0303 revision (s): after a row's named producer is corrected, which consumer can
still accept an equivalent carrier and reach the effect?

The graph direction is:

> **X -> Y means row X cannot make an effect-wide closure claim until consumer seam Y is closed.**

This is deliberately stronger than the scoped-landing rule. A lane may still land a correct local
improvement while an edge stands; it must say that it did not close the row.

## Snapshot, denominator, and method

The source snapshot is `c2016d224d83ddd16bb11856e39a9913b91a3543`, the fetched
`origin/main` at the start of the audit. The worktree was clean and exact at that commit. No product
code or fixture was changed.

The row denominator needed reconciliation before graphing:

| Inventory disposition | Rows |
|---|---:|
| Original enumerated population | 134 |
| True duplicate spellings, excluded | 11 |
| Actionable population after the P4 re-audit | 123 |
| Current firm closures, excluded | 13 |
| **Rows examined here** | **110** |

The 11 true duplicate spellings are F002, F014, F019, F078, F095, F161, F162, F189, F264, F265,
and F312. The 13 current firm closures are F094, F143, F157, F171, F172, F173, F175, F188, F190,
F191, F297, C005, and C009. F182 is **not** in that closed set: its corpus witness compile-refuses,
but the later two-handle execution found that a handle retaining an `Open` schema cache can register
after another handle activates `Disabled`.

For every candidate edge I searched the current definition, all current Rust callers, the relevant
row plan, and the checked-in row attacks. I then followed the carrier to the first consumer that
either performs the effect or produces the next effect-bearing carrier. The confirmation labels are:

- **yes / executed**: a checked-in attack or the cited executed review exercised the composition;
- **yes / static**: the complete call chain is present at current source lines, but this audit did
  not add or run a new hostile program;
- **unconfirmed**: a suspicious consumer is present, but a current alternate route to it was not
  established after intervening sealing work.

The distinction matters. LLP 0303 revision (s), at
`llp/0303-subject-authority-correlation-policy.decision.md:690-731`, says a compile refusal proves a
spelling is gone, not the effect, and requires an executed alternate-route attempt. Consequently,
"leaf" below means **no consumer blocker located in this audit**, not an exhaustive impossibility
proof. The standing corpus has only 24 attacks, so it cannot prove 110 negative consumer censuses.

Two current-source corrections to the commissioning premise are material:

1. `ResolvedAppAuthority::Session` is no longer publicly constructible from parts. The variant now
   contains private `ResolvedSessionAuthority` fields at
   `crates/snapback-sync/src/auth/invocation.rs:323-370`, construction is restricted at `:744-787`,
   and preparation checks admission origin at `:3084-3100`. Raw `ResolvedSession` fields remain
   public at `crates/snapback-types/src/contract_types.rs:107-117`.
2. `ProjectedSessionAuthority` likewise now has private fields at
   `crates/snapback-sync/src/auth/session_projection.rs:148-194`. Older C004 execution remains
   important history, but its exact direct-construction spelling is not current.

Those corrections reduce confidence in F122's proposed dependency and prevent counting C004 as a
confirmed current edge.

## Confirmed consumer-blocker graph

Rows sharing an identical consumer are grouped, but every one of the 41 confirmed-blocked rows is
named. "Unowned" means no row in the 134-row inventory names that consumer. It does not necessarily
mean a new numeric row is mandatory: the programme may explicitly expand an existing row's scope,
but it must do so before claiming closure.

| Row X | Blocker / consumer owner | Current consumer and traced composition | Confirmed? |
|---|---|---|---|
| C003 | F118 | Public `ExactGrantScope` fields at `crates/snapback-kernel/src/storage/auth_grants.rs:117-123` feed public `ResolvedGrantScope::from_exact` at `crates/snapback-sync/src/auth/invocation.rs:644`; sealing only the data producer leaves the conversion. | yes / static |
| C006 | F113 | The forged public `ServiceAuthorityWitness` is accepted by `ServiceAuthorityFenceRegistry::register` at `crates/snapback-auth/src/auth/service_fence.rs:821-826`. The C006 and F113 corpus attacks preserve both halves. | yes / executed |
| C007 | F232 and F233 | Public `ResolvedMembershipWriter` variants at `crates/snapback-kernel/src/storage.rs:17135-17147` are copied by `MembershipWriter::from_resolved` and `from_resolved_with_authority_creating` at `:17155-17188`; the latter also accepts the independent consent bit. | yes / static |
| C012, F149, F150, F279, F280, F281, F282 | **unowned Q02 inner staging consumer** | All public and crate wrappers converge on `stage_recorded_authorization_mutation_with_generation_and_settlement_inner` at `crates/snapback-engine/src/local/engine.rs:19104-19125`, which accepts raw descriptor and prepared authority separately. Runtime comparisons at `:19230-19238` and `:19343-19353` do not make the bad spelling unrepresentable. The corpus executes the public F279 path at `:18971-18994` and the F280 alternate through the public with-wire wrapper at `:19066-19100`; F281/F282 reach the same inner function statically. | yes / executed for C012/F149/F150/F279/F280; static for F281/F282 |
| C013 | F240 | Public `AuthorizationCommitPreflight` is accepted by `RoomAuthorityParticipant::prepare_authorization_commit` at `crates/snapback-kernel/src/storage/room_authority.rs:706-741`; public forwarding consumers remain at `crates/snapback-sync/src/ephemeral.rs:3777-3788` and `crates/snapback-engine/src/local/engine.rs:2775-2782`. | yes / static |
| C014, F204, F257, F260 | F258 | Public `AskSpendSubject` fields at `crates/snapback-kernel/src/storage/ask_spend.rs:41-44` reach the guarded durable sink `reserve_ask_spend_guarded` at `:225-265`. F257 delegates at `:216-223`, F204 at `crates/snapback-engine/src/local/engine.rs:7208-7232`, and F260 at `ask_spend.rs:617-628`. | yes / static |
| F203, F259 | F258, through F257 | Engine F203 delegates at `crates/snapback-engine/src/local/engine.rs:7178-7205`; serving F259 delegates at `crates/snapback-kernel/src/storage/ask_spend.rs:609-615`; both enter F257 and then F258. | yes / static |
| F020, F069 | **unowned issuance-consumer family** | F020 constructs a guest commit plan at `crates/snapback-auth/src/auth/provider.rs:1097-1106`, which `commit_guest_issuance` accepts at `:2260-2275`. The provider-instance attack behind revision (s) also reached `commit_password_issuance` at `:2249-2258`, `ExchangeAdmission::commit_planned_issuance` at `:4177-4202`, and `AddressAdmission::commit_planned_issuance` at `:4735-4741` with a foreign provider's plan. None compares the producer instance. | yes / executed review |
| F037, F061 | F032 | Both guest/address preparation routes produce `GuestClaimPasswordPreparation`; the public effect-bearing consumer `finish_guest_claim_password_with_active_recovery_key` remains at `crates/snapback-auth/src/auth/provider.rs:2694`. F037 is at `:3205-3217`; F061 is at `:4320-4336`. Closing either producer alone leaves the other route into F032. | yes / static |
| F053 | **unowned test-support tombstone writer** | The production carrier reaches public `LocalSnapback::execute_auth_plan` at `crates/snapback-engine/src/local/engine.rs:7655`; independently, additive `insert_session_tombstone_for_test` at `crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5660` plants a caller-selected bearer digest for a victim session. Both branches are in `tests/fixtures/row-attacks/src/attacks/f053.rs:10-49`. | yes / executed |
| F062 | **unowned registration preparation/consumer route** | The row wrapper at `crates/snapback-auth/src/auth/provider.rs:4339-4348` is not the only producer: public raw `AuthProvider::prepare_password_registration` remains at `:1917-1939`, and public `finish_password_registration_with_active_recovery_key` consumes its preparation at `:2012-2029`. | yes / static |
| F063 | **unowned password-issuance consumer** | Raw `AuthProvider::prepare_password_authentication` accepts an identifier at `crates/snapback-auth/src/auth/provider.rs:2058-2097`; `finish_password_authentication` puts the selected identifier and `verified` result in the issuance plan at `:2099-2185`. `admit_password_issuance_in` consumes it at `crates/snapback-kernel/src/storage/auth_identity.rs:1287-1367` and calls `record_password_failure_in` at `:1351-1358`, advancing the selected account's ledger on failure. | yes / static; no checked-in F063 attack |
| F082 | **unowned engine retirement consumers** | `LiveInvalidationIssuer::authenticate_scope_retirement` still accepts raw namespace and prefix at `crates/snapback-auth/src/auth/invalidation.rs:416-432`. Engine consumers derive one candidate at `crates/snapback-engine/src/local/engine.rs:4219-4238`, but a second consumer remains at `:24332-24339`. The MAC verifier at `invalidation.rs:574-605` proves signer integrity, not ownership of the chosen namespace. | yes / static; no checked-in F082 attack |
| F089 | **unowned test-support retry persistence sink** | A public retry reservation can be copied into feature-public `seed_invalidation_retry_episodes_for_test` at `crates/snapback-kernel/src/storage/auth_invalidation.rs:1150-1178`. The executed review persisted the caller-authored episode, reopened the database, and loaded it through the production registry. | yes / executed review |
| F091 | **unowned bound-session consumer** | Public `BoundConnectionSessionIdentity::new` accepts text fields at `crates/snapback-sync/src/auth/session_projection.rs:201-215`; public `AuthCoordinator::resolve_bound_connection_session` reconstructs and consumes the same tuple at `crates/snapback-sync/src/auth/coordinator.rs:1782-1824`. The executed A/B cloned-database composition committed as the same user in both databases. | yes / executed review |
| F097 | F127 | `session_publication_fence` selects any live session/generation at `crates/snapback-sync/src/auth/session_projection.rs:1188-1208`; `PreparedAuthority::with_fenced_publication` accepts it at `crates/snapback-sync/src/auth/invocation.rs:2202-2206` without comparing the publication to the prepared subject. | yes / executed review |
| F115 | F227 | The corpus composes public `ServingDatabase::service_authority_terminal_factory` and arbitrary `factory.prepared(...)` callbacks with public `ServingDatabase::service_authority_commit_interlock` at `crates/snapback-kernel/src/storage.rs:2041-2059`. F227 owns the public callback consumer. | yes / executed |
| F227 | F117 | The serving consumer at `crates/snapback-kernel/src/storage.rs:2048-2059` delegates the arbitrary callback into `KernelCommitAuthority::service_authority_commit_interlock` at `crates/snapback-kernel/src/auth/service_fence.rs:98-111`. | yes / static |
| F117 | **unowned durable service-terminal consumer** | The interlock checks returned database identity but not callback meaning at `crates/snapback-kernel/src/auth/service_fence.rs:67-86`. `attempt_auth_transaction_with_service_terminal` trusts `interlock.prepare_terminal` before the durable operation at `crates/snapback-kernel/src/storage/auth.rs:1844-1889`; eleven auth writers call that transaction helper. | yes / static; F115 executes the upstream composition |
| F121 | F146 and F211 | Public `ResolvedAppAuthority::dev_from_auth` accepts `AuthInput.user_id` at `crates/snapback-sync/src/auth/invocation.rs:817`; F146 consumes it in `prepare_admitted_dev_input` at `:3381-3397`. Independently, public engine F211 accepts a caller-created dev variant in `prepare_dev_authority` at `crates/snapback-engine/src/local/engine.rs:9374-9415`. | yes / static |
| F146 | F211 | Correcting the input-derived F146 route leaves the separate public engine consumer F211 at `crates/snapback-engine/src/local/engine.rs:9374-9415`; the dev variant itself remains publicly nameable at `crates/snapback-sync/src/auth/invocation.rs:337-341`. | yes / static |
| F170 | **unowned shared test-support database surface** | The current corpus independently reaches row-owned `register_oauth_client` with a foreign lease at `crates/snapback-engine/src/local/engine.rs:5696-5723`. Even after that is fixed, feature-public `auth_database_mut` at `crates/snapback-engine/src/test_support.rs:71-73` exposes the raw database, whose `register_agent_principal_with_class` at `crates/snapback-kernel/src/storage/auth_agents.rs:120-180` takes no lease. Both routes were executed in dependent crates. | yes / executed |
| F182 | **unowned same-resource schema freshness seam** | `register_agent_principal_with_class` derives mode from the schema supplied to its transaction at `crates/snapback-kernel/src/storage/auth_agents.rs:136-145`. A handle opened before another handle's activation can supply its stale cached schema; the executed two-handle review is recorded in `issues/20260825-f182-schema-cache-and-a-corpus-blind-spot.md`. LLP 0311 explicitly says its resource interlock does not automatically close F182. | yes / executed review |
| F210, F212, F213 | F127 | Anonymous, admin, and operator preparation all attach a separately supplied session publication through `with_fenced_publication` at `crates/snapback-engine/src/local/engine.rs:9368`, `:9453`, and `:9501`. | yes / static |
| F215 | F127 and F128 | Service preparation attaches the independent stream publication with F127 and the independent service publication with public `with_service_publication` at `crates/snapback-engine/src/local/engine.rs:9542-9549`; F128 is `crates/snapback-sync/src/auth/invocation.rs:2236-2238`. | yes / static |
| F272 | **unowned raw width-plan staging consumer** | The intended sink is `asset_width_plan_with_authorized_effect` at `crates/snapback-engine/src/local/engine.rs:17344-17361`. The raw kernel consumer `AssetAttemptsProofLocalExt::stage_width_variant_plan_proved_guarded` is declared at `crates/snapback-kernel/src/services_assets.rs:176-193`, and private `asset_resolve_width_variant` reaches it with `|| Ok(())` at `engine.rs:17246-17284`; five public delivery methods reach that private composition. LLP 0312 section “The consumer-side negative result” traces the full route. | yes / static; design census reviewed, attack not checked in |
| F279, F280 | row-owned outer alternate plus the unowned Q02 inner | In addition to the common inner edge above, the F279 public consumer remains at `crates/snapback-engine/src/local/engine.rs:18971-18994`, while the corpus's F280 attack deliberately routes through the different public F282 with-wire consumer at `:19066-19100`. Removing only either inventoried spelling cannot close the other. | yes / executed |
| F283 | F284 | The former no-generation spelling is absent, but the public generation-bearing consumer remains at `crates/snapback-engine/src/local/engine.rs:23441-23493` and accepts `expected_generation: Option<ArtifactGeneration>`; passing `None` preserves the old composition. This is the exact alternate route recorded by the current trailer audit. | yes / static review |

## Unconfirmed edges

These three rows are not counted among the 41 confirmed-blocked rows. They are also not counted as
leaves, because doing so would turn current uncertainty into a staffing assertion.

| Row X | Candidate blocker | Current evidence | Confirmed? |
|---|---|---|---|
| C001 | F119 / session-authority conversion | Raw `ResolvedSession` remains publicly constructible at `crates/snapback-types/src/contract_types.rs:107-117`, but the old public `ResolvedAppAuthority::from_session` consumer is gone. Current session-authority construction is restricted to projection output at `crates/snapback-sync/src/auth/invocation.rs:744-787`. I found no current equivalent consumer accepting raw C001. | **unconfirmed; likely a row-ledger/attack update is needed** |
| F001 | unowned `LocalSnapback::execute_auth_plan` | The public generic executor remains at `crates/snapback-engine/src/local/engine.rs:7655`, but `AuthDatabasePlan` is sealed and the generic closure factory at `crates/snapback-auth/src/auth/database_plan.rs:38-42` is crate-private. I did not establish a dependent-reachable alternate producer after deleting F001. | **unconfirmed** |
| F122 | F119/C001 claims seam | The under-comparison is real: `session_claims_for_authority` uses only `resolved.session_id()` at `crates/snapback-engine/src/local/engine.rs:9287-9296`; `identity_claims` queries only session ID/currentness at `crates/snapback-kernel/src/storage/auth_identity.rs:3709-3724`; `HandlerAuthProjection::from_authority` checks only session/claims presence parity at `crates/snapback-sync/src/auth/invocation.rs:1093-1119`. But the commissioning premise's public session-variant construction is stale at this snapshot. I did not reconstruct a forged current `ResolvedSessionAuthority` through the sealed producer. | **consumer defect confirmed; blocking edge unconfirmed** |

## Rows with no consumer blocker located

The following 66 rows are leaves in the **observed** graph and may be staffed independently of
another row's consumer. This is the operational leaf count, not a global closure proof:

> C002, C004, F005, F006, F011, F022, F032, F043, F044, F054, F055, F056,
> F067, F068, F070, F073, F075, F081, F084, F096, F100, F101, F102, F112,
> F113, F118, F119, F120, F126, F127, F128, F129, F133, F144, F145, F160,
> F183, F185, F187, F202, F205, F211, F220, F224, F232, F233, F236, F237,
> F238, F240, F242, F243, F244, F258, F270, F273, F284, F285, F286, F287,
> F288, F298, F299, F302, F305, F306.

"Leaf" does not mean "small" or "ordinary implementation." F117 is blocked and design-gated;
F145 is an observed leaf but still design-gated; F258 is a leaf but still author-decision-gated.
Likewise, several leaves have their own raw sink and must fix it. F112, F113, F127, F128, F211,
F232, F233, F240, F258, F284, F286, and F288 are examples: no other row must close first, but their
own consumer is the work.

## Shape and counts

| Graph result | Rows | Share of 110 |
|---|---:|---:|
| Confirmed blocked on at least one external or separately owned consumer | **41** | **37.3%** |
| Candidate edge only; not counted either way | **3** | **2.7%** |
| Observed leaves; no blocker located | **66** | **60.0%** |
| Leaves proved exhaustive by a current alternate-route negative corpus | **0** | **0%** |

The 41 rows are blocked on **25 normalized concrete consumer seams**. If the three concrete
test-support consumers are treated as one architectural surface, that becomes **23 architectural
blockers**. Thirteen normalized seams are owned by one or more existing rows; twelve are unowned.
The most important unowned seams already have an obvious scope home (Q02 inner staging in the F279
lane, raw width staging in F272, service-terminal transaction acceptance in F117, and schema
freshness in F182). The provider registration/authentication consumers and the bound-session
consumer do not have an equally clean inventory owner; they need either an explicit row-scope
expansion or a new row before staffing.

The leverage distribution is not flat:

| Consumer blocker | Rows directly or transitively held behind it | Count |
|---|---|---:|
| Unowned Q02 recorded-mutation inner staging consumer | C012, F149, F150, F279, F280, F281, F282 | **7** |
| F258 ask-spend guarded sink | C014, F203, F204, F257, F259, F260 | **6** |
| F127 generic session-publication attachment | F097, F210, F212, F213, F215 | **5** |
| Shared test-support architecture | F053, F089, F170 | **3** |
| F117/F227 service-terminal consumer chain | F115, F117, F227 | **3** |
| F032 guest-claim consumer | F037, F061 | **2** |
| F211 dev-authority alternate consumer | F121, F146 | **2** |
| Every other normalized blocker | one row each | **1** |

The top three consumers hold 18 of the 41 confirmed-blocked rows (**43.9%**). Adding test-support
raises that to 21 (**51.2%**). This is enough concentration to change staffing for those components,
but not enough to replace parallel-by-row staffing for the other 66 observed leaves.

## Did the hypothesis hold?

**It held as a material programme correction, not as a total reversal.** The previous producer-root
analysis was answering a real question, and its majority conclusion survives: 66 of 110 current
rows have no consumer blocker located, while three remain uncertain. The graph is therefore not one
large dependency cone.

But the statement "no root worth more than one row" is false on the consumer side. One unowned
staging consumer holds seven rows, one row-owned durable sink holds six, and F127 holds five. The
review anecdotes are not six coincidences: confirmed consumer blockers affect at least 37% of the
current population and half of those blocked rows sit behind four architectural clusters.

The right staffing model is hybrid:

- sequence the 41 confirmed-blocked rows by consumer, with one lane owning the entire consumer
  census and every alternate route;
- keep the 66 observed leaves parallel, subject to their own design and file-contention gates;
- do not call the three uncertain rows closed or independent until a current attack settles them.

## Sequence recommendation

The first five staffing decisions should be:

1. **F279, owning the whole Q02 staging consumer.** Scope the lane over C012, F149, F150,
   F279-F282 and the unowned inner function, not just F279's public wrapper. It has the highest
   confirmed leverage (seven rows), five checked-in compile witnesses, and an already-written
   `PreparedRecordedMutationAuthority` direction in the Q02 plan. This is an ordinary implementation
   lane once it accepts the seven-row scope.
2. **F127, owning Q01 attachment.** Close `with_fenced_publication` first, then migrate F210, F212,
   F213 and F215; include F128 in the service migration. This releases five blocked rows and prevents
   another producer-correct/public-consumer-open F097 round.
3. **F258, owning the ask-spend sink — but staff the author decision first.** F258 is the common
   consumer for a seven-row component including itself. Q13 still asks whether cross-principal
   charging is valid product behavior. An ordinary lane must not encode that answer. Once ruled,
   change the sink first, then F257/F204/F260, then the forwarding F203/F259 surfaces.
4. **F117, owning the service-terminal interlock chain.** The F115 corpus proves arbitrary callback
   semantics; F227 forwards them; the durable transaction trusts the result. This needs a reviewed,
   database-bound terminal receipt/interlock design before ordinary implementation. The lane must
   include F115, F117, F227 and the durable transaction consumer; treating them as three rows will
   repeat the failure.
5. **F053 as the named row behind a shared test-support architecture lane.** Do not staff another
   F053-only fix. The lane must remove or redesign the tombstone writer, raw database accessor, and
   retry persistence sink that separately block F053, F170 and F089, while migrating their test
   callers into non-authorizing harness scenarios. F170 still also needs its row-owned foreign-lease
   consumer fixed after the surface closes.

After those, staff the F032 guest-claim pair, the F211 dev pair, and the single-row unowned consumers
before returning to their producer lanes. F272 is important but releases only itself, so its design
review should run in parallel with the higher-leverage ordinary lanes rather than displacing them.

### Work that cannot start as an ordinary implementation lane

| Rows / blocker | Required prior work |
|---|---|
| F258 / C014 / Q13 | Author product ruling on whether any exact cross-principal ask-spend charging is valid. |
| F117 / F115 / F227 | Reviewed opaque terminal receipt/interlock design that binds callback meaning, exact token set, disposition, and database identity. |
| F145 | Review and accept the sealing/consumer-dominance part of Draft LLP 0312. Current origin checks at `crates/snapback-sync/src/auth/invocation.rs:3264-3277` are useful but do not satisfy the RFC's required removal of the raw sync preparation surface and mechanical consumer-dominance evidence. |
| F272 | Review and accept Draft LLP 0312's `AuthorizedAssetWidthPlan`, crate-ownership move, and raw-kernel-consumer closure. The RFC explicitly forbids landing the carrier while the unchecked consumer remains. |
| F182 | Review the same-resource, in-transaction mode source. Draft LLP 0311 states that its authorization-publication interlock is adjacent but does not close the stale-schema row. |
| F061, F062, F069, F073, F126, F202, F220, F244, F299 | Preserve the existing plan gates: verified address/registration carriers, host/rehearsal authority, `AuthorizedLeaseCapture`, deferred rehearsal binding, semantic commit identity, room-reauthorization completion authority, and coherent startup binding respectively. None should be replaced with a public from-parts DTO. |

## Confidence and the weakest point

**Overall confidence: 0.74.** Confidence is high in the three leverage leaders and every edge backed
by a checked-in or cited executed composition. It is lower in the 66-leaf count because it is a
negative static result over a moving inventory, and deliberately not called proof.

The single weakest point is **F122 -> F119/C001**. The claims consumer unquestionably compares too
little, but the prompt's construction premise predates the current private session carrier. I could
not confirm a current forged carrier reaching that consumer, so the edge stays outside the blocked
count. The next useful action is a current dependent-crate attack that obtains two genuine session
carriers, crosses the claims/session facts without constructing private fields, and records whether
the preparation refuses at the intended expression.
