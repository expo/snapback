# The authorization denominator and the seam map

**Status:** open (living measurement)
**Produced:** 2026-08-26, read-only audit of `029164f60`, no build or attack execution.

Answers three questions the programme could not previously answer: how many defects
actually remain, whether the row is the right unit of work, and what order to attack
the remainder in. Every claim below is labelled READ-CONFIRMED or INFERRED; the
distinction is load-bearing and should be preserved when quoting these numbers.

**Headline:** the tracked population of 124 is wrong. The corrected floor is **at least
133 total / 111 open**, and **21 blocker seams hold 31 blocked rows**.

---


# Authorization denominator and seam report

Read-only audit of `029164f60a555e3aa687236d41cab84c269e32d2`. No build or attack execution was performed.

Labels:

- **READ-CONFIRMED** — established from checked-in source, manifests, issues, or recorded commit evidence.
- **INFERRED** — follows from those facts but was not measured here.

## 1. Denominator

### Reconciliation

| Term | Count | Evidence |
|---|---:|---|
| Tracked actionable population | 124 | **READ-CONFIRMED.** The [additive-feature sweep](issues/20260825-additive-feature-writer-sweep-98-of-100-already-rowed.md:62) moves 123 to 124. |
| Firm closures at `c2016d2` | 13 | **READ-CONFIRMED.** The [blocker audit](issues/20260826-row-consumer-blocker-graph.md:36) names them and explicitly rejects F182’s compile-only result. |
| Later firm closures at current HEAD | 9 | **READ-CONFIRMED.** `9c9a1a283` closes F112, F113, C006, F115; `20b3c884e` closes F149, F150, F279, F280, C012. |
| Firm closures used here | 22 | **INFERRED arithmetic.** The row ledger has 22 `CLOSED` entries, but F182 is runtime-open while F297 is the firm closure omitted from that ledger; substituting F297 for F182 leaves 22. |
| Inventoried defects still open | 102 | **INFERRED:** 124 − 22. |
| Unrowed defects established below | at least 9 | Six runtime-executed, two compile/source-confirmed, one source-confirmed settlement composition. |
| **Open denominator** | **at least 111** | **INFERRED:** 102 + 9. |
| **Corrected total programme population** | **at least 133** | **INFERRED:** 124 + 9. |

A stricter runtime-executed-only subfloor is **108 open / 130 total**. The additional three are not presented as runtime measurements.

### The undercount is nine defects, not five

The [nine-attack report](issues/20260826-nine-compiling-security-boundary-attacks-are-reachable.md:44) contains six runtime-executed unrowed effects:

| Unrowed defect | Status and derivation |
|---|---|
| Protected-record erasure bridge | **READ-CONFIRMED, executed.** A dependent deleted a protected row using caller-selected authority facts. |
| Pending-effect creation bridge | **READ-CONFIRMED, executed.** A caller-authored request became a durable `Pending` record. |
| Pending-effect refusal bridge | **READ-CONFIRMED, executed.** Creation plus caller-selected refusal produced durable `Refused` state and the selected code. |
| Promotion-contention prepare/activate pair | **READ-CONFIRMED, executed.** A caller-selected stream produced an active contention policy. |
| Direct `MembershipWriter::Admin` plus plan/commit | **READ-CONFIRMED, executed.** The public variant committed a privileged membership change. F232/F233/F236 are adjacent rows, not this producer. |
| Raw SQLite re-export | **READ-CONFIRMED, executed.** `snapback-services/remainder-tests` exposed `rusqlite`; there is no F-row. The re-export remains in [lib.rs](crates/snapback-services/src/lib.rs:39). |

Three pending-effect siblings extend the undercount:

| Additional sibling | Status and derivation |
|---|---|
| Approval | **READ-CONFIRMED compile/source reachability; not runtime-measured here.** The repaired [approval witness](tests/fixtures/security-boundaries/src/bin/admit_pending_effect_approval.rs:4) obtains a preparation and calls the public approval bridge. |
| Denial | **READ-CONFIRMED compile/source reachability; not runtime-measured here.** The [denial witness](tests/fixtures/security-boundaries/src/bin/admit_pending_effect_denial.rs:4) calls the surviving public denial bridge. |
| Settlement | **INFERRED reachable; not runtime-measured here.** The checked-in witness passes the obsolete `&str` spelling, but the surviving consumer accepts a genuine `PendingEffectExecutionTicket`. That ticket is publicly obtainable through approval and `ApprovedPendingEffect::into_parts`; settlement still accepts independently supplied `executed` and `outcome_code`. Under LLP 0303(s), the obsolete-spelling refusal is not closure. |

Therefore, beyond the stated five:

- **READ-CONFIRMED:** raw SQL is the sixth already-executed unrowed effect.
- **READ-CONFIRMED:** approval and denial are additional compiling/source-complete siblings.
- **INFERRED:** settlement is another live sibling under revision (s).

### Why 111 is still a floor

- **READ-CONFIRMED:** [run-row-attacks.mjs](scripts/run-row-attacks.mjs:173) checks the security ledger only for entries opting in with `row` or `rows`. No current security-boundary attack declares either field, making that cross-ledger omission check vacuous.

- **READ-CONFIRMED:** The blocker audit found 66 observed leaves but zero leaves with exhaustive alternate-route proof. Its then-24-attack corpus could not establish 110 negative consumer censuses.

- **READ-CONFIRMED:** The row corpus covers production and additive `test-support` for five crates, but not `snapback-services/remainder-tests`, precisely the feature cell exposing raw SQL. This violates revision (o) as a completeness basis.

- **READ-CONFIRMED:** [LLP 0303(s)](llp/0303-subject-authority-correlation-policy.decision.md:690) requires an executed alternate-route attempt for closure.

- **INFERRED:** Reading can discover additional routes, but cannot establish that no other public composition exists. Closing the denominator requires mandatory row mapping for every security attack, feature-complete effect-producer enumeration, and executed alternate-route attempts for every closure or leaf claim.

## 2. Seam-level map

“Auto” means only on the observed graph. Except for later measured landings, it is not global capability proof.

| # | Consumer seam | Rows held | Closing consequence | Current state |
|---:|---|---|---|---|
| 1 | F118 exact-grant conversion | C003: 1 | **INFERRED auto** on observed graph; F118 remains separate work. | Open |
| 2 | F113 service-witness registration | C006: 1 | **READ-CONFIRMED auto:** C006 and F113 closed together. | **Closed** |
| 3 | F232/F233 membership-writer conversions | C007: 1 | **INFERRED auto** only if both sibling conversions close. | Open |
| 4 | Unowned Q02 inner staging join | C012, F149, F150, F279–F282: 7 | **READ-CONFIRMED mixed:** five witnessed rows closed; F281/F282 were only unblocked. | **Closed** |
| 5 | F240 authorization-preflight consumer | C013: 1 | **INFERRED auto** on observed graph. | Open |
| 6 | F258 ask-spend guarded sink | C014, F203, F204, F257, F259, F260: 6 | **READ-CONFIRMED only unblocks staged migration:** sink, wrappers, then forwarding surfaces. | Open; Q13 first |
| 7 | Unowned issuance-consumer family | F020, F069: 2 | **INFERRED auto** only when every password/guest/exchange/address consumer is bound. | Open |
| 8 | F032 guest-claim consumer | F037, F061: 2 | **INFERRED auto** on observed graph. | Open |
| 9 | Unowned tombstone writer | F053: 1 | **READ-CONFIRMED only unblocks:** the production `execute_auth_plan` branch remains. | Open |
| 10 | Unowned registration prepare/finish route | F062: 1 | **READ-CONFIRMED only unblocks:** the row wrapper remains. | Open |
| 11 | Unowned password-issuance consumer | F063: 1 | **INFERRED auto** if admission binds identifier and verification result. | Open |
| 12 | Unowned engine retirement consumers | F082: 1 | **INFERRED auto** only after both located consumers are covered. | Open |
| 13 | Unowned retry-persistence sink | F089: 1 | **INFERRED auto** on observed graph. | Open |
| 14 | Unowned bound-session consumer | F091: 1 | **INFERRED auto** if database/session origin is bound. | Open |
| 15 | F127 session-publication attachment | F097, F210, F212, F213, F215: 5 | **INFERRED mixed:** first four close on observed graph; F215 remains behind F128. | Open |
| 16 | F227 public service-terminal callback consumer | F115: 1 direct | **READ-CONFIRMED auto:** arbitrary callback factory/interlock capability is gone; F115 closed. | **Closed** |
| 17 | F117 kernel callback consumer | F227: 1 direct; F115 transitive | **READ-CONFIRMED only unblocks:** old callback seam is gone, but F227 lacks an effect-wide closure claim. | **Closed** |
| 18 | Unowned durable service-terminal consumer | F117: 1 direct; three-row chain transitively | **INFERRED:** closes F117 when operation meaning is tied to its receipt; F227 then needs alternate-route evidence. | Open |
| 19 | F146 dev-input consumer | F121: 1 | **READ-CONFIRMED only unblocks:** F121 also reaches F211. | Open |
| 20 | F211 engine dev consumer | F121, F146: 2 | **READ-CONFIRMED only unblocks:** F146’s input route remains. | Open |
| 21 | Unowned raw test database accessor | F170: 1 | **READ-CONFIRMED only unblocks:** the foreign-lease route remains. | Open |
| 22 | Unowned schema-freshness seam | F182: 1 | **READ-CONFIRMED auto in design:** requires an in-transaction resource-derived mode read. | Open |
| 23 | F128 service-publication attachment | F215: 1 | **READ-CONFIRMED only unblocks:** F215 also depends on F127. | Open |
| 24 | Unowned raw width-plan staging | F272: 1 | **INFERRED auto** on observed graph, subject to LLP 0312 and alternate-route evidence. | Open |
| 25 | F284 generation-bearing consumer accepting `None` | F283: 1 | **INFERRED auto** once the surviving `None` composition is impossible. | Open |

**READ-CONFIRMED snapshot:** 25 concrete seams, 13 row-owned and 12 unowned. Collapsing the three test-support consumers into one architecture gives 23 architectural blockers.

**INFERRED current reconciliation:** four unsafe seams—#2, #4, #16, #17—are closed, leaving **21 blocker seams holding 31 blocked rows**.

### Is the seam the right unit?

- **INFERRED:** Yes for dependency-correct scheduling. A lane should own the full consumer census and all routes feeding it.

- **INFERRED:** No as the sole estimating denominator. The 21 excludes leaves, three uncertain rows, and nine unrowed defects. Seam weights range from one to six open rows, several rows have two blockers, and design decisions dominate some one-row seams.

- **INFERRED:** The proper model is a weighted DAG: seams are dependency nodes, row ids are acceptance-coverage labels, and independent leaves remain parallel tasks.

- **INFERRED:** There is no defensible total seam count for the entire remainder. There are 21 residual blocker seams plus at least five additional architectural families exposed by the unrowed defects—pending effects, protected erasure, promotion contention, direct membership authority, and raw SQL—but the leaves have not undergone a seam census.

## 3. Dependency-correct order

1. **READ-CONFIRMED:** Resolve prerequisites in parallel: Q13 for ask spending; reviewed receipt/operation coupling for F117; LLP 0312 for F272; in-transaction resource-mode design for F182.

2. **INFERRED:** While those decisions run, close F127 and F128 together. F127 holds five rows, and F215 requires both publication seams.

3. **INFERRED:** After Q13, close ask spending from the sink outward: F258 → F257/F204/F260 → F203/F259.

4. **INFERRED:** Finish the service chain bottom-up: durable operation/receipt coupling → F117 closure attempt → F227 alternate-route attempt.

5. **INFERRED:** Treat the tombstone, retry-persistence, and raw-database seams as one test-support architecture lane; then return to F053/F089/F170’s row-specific routes.

6. **INFERRED:** Respect the smaller DAGs: F211 → F146 → F121; close both F127 and F128 before F215; close the guest-claim and issuance families across all siblings.

7. **INFERRED:** Staff singleton seams and independent leaves in parallel. F281, F282, and F227 are now unblocked candidates, not proven closures.

8. **INFERRED:** Add one pending-effect owner-bridge lane covering all five sibling transitions. Staffing only creation and refusal would reproduce the revision-(q) undercount.

## Critical path

| Component | Critical-path reason |
|---|---|
| F258 ask-spend seam | **READ-CONFIRMED:** six rows, the largest open fan-out. **INFERRED:** Q13 decision latency compounds it. |
| F127/F128 publication seams | **READ-CONFIRMED:** F127 holds five rows; F215 depends conjunctively on both. |
| Pending-effect owner bridges | **READ-CONFIRMED/INFERRED mixed:** five unrowed effect producers share one architectural boundary; settlement lacks runtime execution evidence. |
| Shared test-support architecture | **READ-CONFIRMED:** three concrete blockers share a broad migration and additive-feature hazard. |
| Durable service-terminal seam | **READ-CONFIRMED:** surviving bottom of the former three-deep F115 → F227 → F117 chain. |
| F211 → F146 → F121 | **READ-CONFIRMED:** remaining two-level dependency chain; F121 has two blockers. |
| F032 and issuance families | **READ-CONFIRMED:** two rows each with multiple sibling producers or consumers. |

**READ-CONFIRMED:** Q02 was the snapshot’s largest seam at seven rows. It is no longer on the current critical path: five rows closed and F281/F282 became unblocked. Counting all seven as automatically closed would contradict both the ledger and revision (s).

## Bottom line

**INFERRED:** Use **111 open defects** as the planning floor and **133** as the corresponding minimum total programme population. Neither is a true denominator.

**READ-CONFIRMED/INFERRED reconciliation:** Use **21** only as the count of still-open blocker seams inherited from the supplied 25-seam graph. Schedule blocked work by weighted seam/DAG component, retain row ids as acceptance coverage, and keep independent leaves parallel.