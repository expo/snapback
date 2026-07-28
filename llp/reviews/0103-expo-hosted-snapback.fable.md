# LLP 0103 / 0104 / 0105 — cluster review (Fable family)

**Reviewer family:** Fable
**Provider / runtime:** Fable (Anthropic) via isolated subagent
**Targets:** LLP 0103 (RFC), 0104 (Spec), 0105 (Plan) — reviewed as a lockstep cluster; this file holds the verbatim cluster review, with per-target verdicts. 0104/0105 carry pointer stubs to this file.
**Redacted:** No (target bytes disclosed whole; context = repo minus `llp/reviews/<targets>`).

## Round 1 — 2026-07-28 (/llp-super-refine)

- **Topology:** lockstep cluster (targets tightly coupled via `Related:` and cross-references).
- **Entry revision hashes:** 0103 `cfe177f4` · 0104 `e3788e7d` · 0105 `81300b18` (git blob, at Draft→Review transition).
- **Instruction hash:** `0ec10b35` (`/tmp/sr1/instruction.md`).
- **Runtime:** Fable via general-purpose subagent (file read access).
- **Blindness:** launched concurrently with the GPT review; reviewer instructed to exclude `llp/reviews/`. Because the subagent had filesystem read access, blindness here is **instruction-based, self-attested** (not structurally enforced); the two reviews were sealed from each other until both landed. A brief working-notes preamble the reviewer emitted before the review proper is omitted below as non-review meta; the review body is verbatim.

---

**Overall assessment**

Expo-hosted Snapback is a good idea and the plan is largely sound. The three documents form a genuinely coherent set: 0103's `(expoAccountId, expoAppId, snapbackEnvironmentId)` identity key, 0104's metering identity contract, and 0105's cross-repo ledger all agree on the same stable-id spine, and the "releases are not databases" invariant is enforced consistently across all three. The topology (EAS dispatcher → Snapback gateway → environment coordinator DO → WfP handler namespace with a capability-gated HOST bridge) is technically feasible on the named Cloudflare primitives and is correctly derived from already-ratified Snapback decisions (LLP 0014 everything-on-DO, LLP 0040's hibernating-subscriber proof, LLP 0009's untrusted floor). The honesty discipline is strong throughout. The set is close to acceptable. The blocking problems are narrow: the one concrete new price in 0104 is thin against the provider floor and defended only by an un-run gate; the single-coordinator scale ceiling is under-specified as a launch risk; and one durability/backup claim in the free tier likely overpromises against the DO primitive. I judge 0103 and 0105 READY and 0104 NOT READY, hence SET NOT READY, though the 0104 fix is bounded.

**Strengths**

- Correct product boundary: Expo owns identity/roles/billing/transfer/support; Cloudflare owns substrate; Snapback owns app-facing semantics. This reuses the hard horizontal pieces EAS Hosting already has (WfP dispatch, signed deploy URLs, BigQuery/Stripe metering) rather than rebuilding a control plane.
- The refusal to conflate developer identity with app-user identity (0103 §Developer control plane) is the single most important correctness call in the set, and it is made explicitly and defended.
- "An immutable EAS Hosting deployment is a release, not a database" (0103 §Project and environment identity) is load-bearing and is enforced in 0104 (§Commercial principles #6, aggregate by account) and 0105 (§Sequencing constraints, "No database per immutable preview deployment"). This kills the most obvious cost-explosion failure mode at the design level.
- Dedicated WfP handler Worker with a narrow `HOST` service binding, no DB binding, no ambient secret, invocation-bound capability failing closed (0103 §Recommended Cloudflare topology, §Security model) is the right untrusted-code shape and correctly defers to LLP 0009/0047 rather than claiming isolation from Cloudflare primitives alone.
- 0104's metering identity contract (idempotent `eventId`, `occurredAt`/`observedAt`, ownership interval for transfer, append-only corrections, per-source completeness watermark) is genuinely well-designed and directly supports the transfer/dedupe/late-data acceptance tests.
- 0105's gate structure is disciplined: Gate 0 kills the topology (not the public claim) on failure; charges are blocked until two shadow billing periods reconcile; free-tier marketing is blocked until hard-stop/data-safety proof. Sequencing constraints are concrete and enforceable.
- Facets/Worker Loader correctly held as an evidence-gated future optimization under LLP 0087, not a launch dependency — consistent across all three docs and with 0087 itself.

**Concerns**

1. **[MATERIAL] The one concrete new price — database storage at $0.25/GB-month — is structurally too thin and is defended only by a gate that has not run.** (0104 §Summary, §Proposed paid contract, §Margin gate.) The DO SQLite provider floor is $0.20/GB-month (LLP 0014 §Platform Facts), so $0.25 is a 1.25× markup. But the same document requires this price to also cover "DO storage plus backup/metadata overhead" and PITR, and 0104 §Customer-facing meters explicitly bills *logical* SQLite bytes while *excluding* invisible PITR overhead — meaning the provider will bill physical bytes (indexes, system tables, 30-day PITR history) that the customer meter does not count. A 25% gross margin before backup/PITR/replication overhead is very likely negative net margin on storage-heavy tenants. This is the single load-bearing new number in the commercial contract, and it is presented as a candidate whose only defense is the §Margin gate — which 0105 P0.4/Gate 0 confirm has not been run. Resolve by either (a) running the margin gate before this document leaves Review and replacing the candidate with a proven number, or (b) explicitly widening the multiple (competitors sit at $0.75–$1.00/GB-month equivalent for comparable durable storage per 0104's own cited pricing) so the price covers PITR + physical overhead with margin. As written the number is a decision, not a placeholder, and it is the wrong number.

2. **[MATERIAL] Row-write amplification is acknowledged as a risk but the pricing model does not yet contain it, and the fallback meter is deferred past the point where it can be validated.** (0104 §Margin gate, §Proposed paid contract; 0103 §Recommended Cloudflare topology.) DO SQLite bills row writes at $1.00/M — 1000× row reads (LLP 0014) — and every Snapback mutation writes rows plus version-counter plus journal plus subscription/outbox bookkeeping in one `transactionSync`. 0104 correctly names "row-write amplification is measured after batching version/journal writes" as a gate item and proposes a "database write unit" meter only *if* request/CPU cannot cover write-heavy costs. The problem is decision-quality: the design (0103) commits to per-app coordinator writes for version/journal/subscription/outbox on every mutation, so write amplification is not a maybe — it is structural, and whether request+CPU pricing absorbs it is the central open commercial question. Deferring the write-unit meter to "only if evidence shows" while shipping request/CPU prices as ratification decision #1 risks locking the customer-facing price schema before the write-cost evidence exists. Resolve by making the write-amplification measurement a Phase 0 *blocking* output (it already is in 0105 P0.4/Gate 0) and stating in 0104 that ratification decision #1 (reuse EAS Hosting request/CPU prices) is contingent on that measurement, not independent of it.

3. **[MATERIAL] The single-coordinator scale ceiling is a real launch risk that the set names but does not bound.** (0103 §Completeness gap matrix final paragraph; 0105 §Phase 4.) 0103 correctly identifies "one coordinator is a deliberate ceiling" and points at LLP 0046 Postgres graduation or sharding. But the north-star reference app (Partiful at a few hundred thousand MAU, per LLP 0000) is exactly a popular-app RSVP/realtime fan-out shape, and one SQLite-backed DO has a 10 GB hard ceiling (LLP 0014) and one version authority per app (LLP 0014 §Resolution / DK-2). The docs treat "large-app answer" as a GA-gate line item (0105 §Phase 4 "a large-app answer before claiming unlimited popular-app scale") but never state the *interim* ceiling a paid customer will actually hit, nor what happens at 10 GB before Postgres graduation exists. This is a decision-quality gap: a paid product needs a published per-environment ceiling and a defined behavior at that ceiling (read-only? refuse writes? emergency export?) at *launch*, not at GA. Resolve by adding an explicit interim scale envelope to 0103 (per-environment GB and write-rate ceiling) and a defined at-ceiling behavior to 0104's quota section, distinct from the eventual Postgres graduation.

4. **[MATERIAL] The free tier promises 30-day PITR as user-visible restore, but the design has not shown user-visible restore on the DO PITR primitive, and 0103 lists it as a substantial gap.** (0104 §Proposed free tier "Point-in-time recovery 30 days"; 0103 §Completeness gap matrix "Backup/export: PITR primitive only → user-visible restore/export and drills … Yes".) 0103 is explicit that today there is only the PITR *primitive* and that user-visible restore/export/drills are unbuilt and "substantial." 0104's free-tier table advertises "Point-in-time recovery 30 days where the provider contract permits" as a headline free-tier value. Advertising a 30-day restore guarantee in the commercial contract while the restore capability is an acknowledged unbuilt gap is exactly the "commercial and capability truth must agree" principle 0104 §Commercial principles #8 sets for itself — and it is violated here. Resolve by demoting free-tier PITR to a capability-gated line ("available once restore ships in Phase 4" per 0105 §Phase 4 item, or Phase 1's restore drill), or by moving PITR out of the *advertised* free tier until 0105 Gate 1's "restore and logical export independently verify" passes.

5. **[detail] DO objects do not relocate after creation (created near first `get()`, LLP 0014), which makes the residency/regions story harder than "policy."** (0103 §Completeness gap matrix "SLA/regions … policy"; 0104 §Entitlements "domain, region, support, and compliance"; 0105 §Phase 4 "residency/compliance".) Data location is effectively pinned at environment-creation time and cannot be moved without a data migration. This is deferred to GA, which is acceptable altitude, but the docs frame it as a publishing/policy task; the underlying primitive makes region *selection at creation* a design requirement (jurisdiction can't be retrofitted onto an existing coordinator). Note it in 0103 so Phase 4 residency work knows it must be a create-time placement decision, not a later toggle.

6. **[detail] "Backend requests" meter folds seven semantically different operations into one unit, which muddies the CPU meter relationship.** (0104 §Customer-facing meters.) A live subscribe, an HTTP function call, and a "platform operation" have wildly different provider costs but count as one request each; CPU is a separate meter, so cheap requests and expensive requests are only distinguished through CPU. This is defensible (simplicity is a stated goal) but the margin gate should confirm the request+CPU pair doesn't systematically undercharge subscribe-heavy or platform-operation-heavy shapes. Detail because it's a gate-validation item, not a wrong decision.

7. **[detail] "Included: Current EAS Hosting allowance" is under-specified as a paid-contract term.** (0104 §Proposed paid contract table.) Three of six paid meters state included amounts as "Current EAS Hosting allowance" rather than a number, while the free tier and summary give concrete figures (100,000 requests; 1M CPU-ms; 1 GB asset). A commercial contract spec should pin the paid included quantities or explicitly state they inherit a named, dated Hosting figure. Detail — mechanical to fix, and 0104 §Status already flags figures as a dated snapshot.

8. **[detail] Realtime-messages pricing is presented two ways without resolving which ships.** (0104 §Customer-facing meters, §Proposed paid contract: "$0.40/million, or folded into requests after evidence.") Carrying a separate realtime meter *and* a "may be folded into requests" note into the same table leaves the customer-facing schema ambiguous. Fine to defer the decision, but 0104 should state the default that ships (separate meter) and the trigger to fold it, rather than presenting both as live. Detail.

9. **[detail] "Separate action role or demonstrably equivalent kill domain" is left as an open decision that Phase 0 depends on.** (0103 §Recommended Cloudflare topology #4; 0105 §Open decisions #3, P0.1.) Whether slow/egress action work runs as a second WfP script or a proven independent kill domain is genuinely open, and 0105 correctly puts it in Phase 0. Not a defect — the docs handle it correctly — but flagging that Gate 0's "slow actions cannot block transactional work" is the single most likely Phase 0 finding to reshape the topology, so it deserves a named fallback if two-script isolation proves too costly.

**Cross-document consistency**

- Identity spine is consistent: 0103's `(expoAccountId, expoAppId, snapbackEnvironmentId)` == 0104's metering event key == 0105's Identity ledger row. Good.
- "Releases are not databases" is consistent across 0103 §Project identity, 0104 §Commercial principles #6, and 0105 §Sequencing constraints. Good.
- Meters match design: every 0104 customer meter (requests, realtime messages, CPU, DB storage, asset storage, egress) maps to a resource 0103's topology produces; shadow meters (WfP, DO GB-s, SQLite rows, R2, Queues) map to 0103's components. No orphan meter, no unmetered billable resource. Good.
- Plan delivers spec: 0105 P0.4 emits exactly 0104's customer+shadow meters; Gate 0 enforces 0104's margin gate; Phase 3 gates on the ratified 0104 free tier. Good.
- **Gap:** 0104 §Margin gate and ratification decision #1 (reuse request/CPU prices, add DB storage) are stated as if independent, but 0105 P0.4/Gate 0 make them *outputs* of an un-run measurement. 0104 should state the price decisions are contingent on Gate 0, matching 0105's actual sequencing (see Concern 2).
- **Gap:** 0104 free-tier PITR (advertised) vs 0103 backup/export gap (unbuilt) vs 0105 restore-verification gate (Gate 1) are inconsistent about whether PITR is a shippable free-tier promise (see Concern 4).
- **Minor gap:** 0103 §Completeness gap matrix marks "Postgres … 10 GB ceiling if explicit," but neither 0104 nor 0105 states the interim per-environment ceiling to a paid customer (see Concern 3).

**Verdicts**

- 0103: READY
- 0104: NOT READY
- 0105: READY
- SET: NOT READY

---

## Round 2 (delta) — 2026-07-28 (/llp-super-refine)

- **Entry revision hashes (revision 2):** 0103 `dd7d7aa5` · 0104 `8bc8ec21` · 0105 `d29521e6`.
- **Instruction hash:** `04164b23` (`/tmp/sr2/instruction.md`; delta enumerated in the instruction).
- **Runtime:** Fable via general-purpose subagent (file read access).
- **Blindness:** launched concurrently with the round-2 GPT review; instructed to exclude `llp/reviews/`; instruction-based, self-attested; sealed until both landed. A brief working-notes preamble is omitted; review body verbatim.

**Overall assessment**

Revision 2 is a substantial, coherent improvement, and the round-1 material concerns now read as largely resolved. The owner-independent durable identity `(expoAppId, snapbackEnvironmentId)` is defined cleanly in 0103 §Project and environment identity and propagates consistently into 0104's metering identity contract and 0105's identity ledger and Work-ownership sections; transfer-opens-a-new-ownership-interval-and-rekeys-nothing is stated the same way in all three. The release-pinning cutover fence (0103 §Release pinning and cutover fence) is now a real consistency mechanism keyed on the coordinator registry entry rather than the alias, and it correctly closes the non-alias (preview/custom-domain) traffic hole. The logical-SQLite-bytes definition (0104 §Defining billable "logical SQLite bytes") is now bill-grade: a concrete `(page_count − freelist_count) × page_size` measurement with explicit exclusions, cadence, and reconciliation. The account-budget/lease protocol (0104 §Authoritative account-budget protocol) is enforceable in shape (leases, fail-closed renewal, bounded overshoot) rather than hand-wavy. The DB-storage price is now honestly a gate-pending candidate with floor-plus-overhead logic, and 0105 makes the write-amplification/logical-storage/budget proofs blocking Phase-0 outputs that feed 0104's price decisions. The remaining issues are altitude-appropriate details or a couple of genuine-but-narrow coherence gaps, none of which I judge MATERIAL. I find no unresolved MATERIAL defect in any of the three documents.

**Concerns**

1. **[detail] {IN-DELTA}** — The free-tier storage aggregation model and the account-budget "storage headroom" lease collide with the per-environment storage service limit without an explicit reconciliation. 0104 §Proposed free tier sets Database storage at "1 GB" aggregate per Expo account (principle #6), and §Authoritative account-budget protocol reserves per-environment storage leases against "the account storage limit." But §Service limit and 0103 §Interim per-environment scale envelope set a *per-environment* ceiling safely below 10 GB. For free accounts these two boundaries (1 GB account-aggregate vs. a multi-GB per-environment ceiling) are never explicitly related — e.g., whether a free account's 1 GB can concentrate in one of its 3 environments, and how a storage lease reconciles an account cap that is smaller than the per-environment cap. Resolves by one sentence in 0104 §Authoritative account-budget protocol stating the effective storage bound is `min(account aggregate, per-environment service limit)` and that free storage leases draw against the account aggregate. No decision is defective; this is spec-refinement altitude.

2. **[detail] {IN-DELTA}** — The write-rate ceiling is asserted but unquantified in both 0103 §Interim per-environment scale envelope and 0104 §Service limit ("consistent with one coordinator's single-`transactionSync` version authority"). This is correct at RFC/Spec altitude — the number is explicitly a Phase-0/Gate-0 output (0105 P0.4) — but the two documents should name that the numeric ceiling is produced by the same gate that proves write amplification, so a reader does not expect it pinned here. Resolves by a cross-reference; identifies no defective decision.

3. **[detail] {IN-DELTA}** — The cutover-fence "compatibility window" (0103 §Release pinning and cutover fence) requires admission to prove that "each new release accepts the immediately prior release's in-flight requests for a bounded window." This is a strong invariant, but the document does not say how admission *checks* that property (schema-superset check? declared compat contract? test replay?), and an unprovable admission gate is a place a fence can silently degrade to "reject everything" or "accept unsafely." This is implementation-phase refinement (0105 P0.3 is the natural home to specify the check), not a broken decision, so detail — but P0.3's assertion should be expanded to prove the *admission* compatibility check, not only the repair-invariant convergence it currently names.

4. **[detail] {PRE-EXISTING}** — 0104 §Customer-facing meters realtime row and 0104 §Internal shadow meters note "Cloudflare WebSocket frame conversion is an implementation detail," but LLP 0014 §Platform Facts records that incoming WebSocket messages bill as requests at a 20:1 ratio and hibernation stops duration charges. The realtime meter ($0.40/million delivered) and the request meter therefore both sit atop a provider frame-billing shape the margin gate must model; the spec correctly defers this to shadow metering and the margin gate but does not flag the 20:1 asymmetry as a specific margin-gate input. Resolves by naming it in the §Margin gate bullet list. Detail; the gate already exists to catch it.

5. **[detail] {IN-DELTA}** — The operation-classification table (0104 §Chargeable operation classification) says platform operations count as a "Chargeable subset only … Only the enumerated tenant-visible control operations count." But the enumerated subset is never actually enumerated — the row lists create/promote/rollback/inspect/export/restore/suspend/delete as examples and then says "chargeable subset only" without stating *which* of those are in the subset. Since the whole point of the versioned table is that "backend request" counts identically in runtime, dashboard, docs, and invoice, leaving the chargeable subset unlisted defeats the table's reproducibility goal for exactly the control-plane operations. Resolves by listing the chargeable control operations explicitly in `operation-class.v1`. I rate this detail (not MATERIAL) because control-plane operations are low-volume and the versioning discipline is correct; but it is the closest of these to material and should be fixed before the table is called v1-final.

6. **[detail] {IN-DELTA}** — 0104 §Metering identity and event contract lists both "`expoAccountId` as the ownership attribution in force at `occurredAt`" and, separately, "ownership interval for transfer attribution." These are two encodings of the same fact (the point-in-time owner vs. the interval). Not contradictory, but a reader could implement both and diverge. Resolves by stating that the interval is authoritative and `expoAccountId` at `occurredAt` is derived from it. Purely editorial.

7. **[detail] {PRE-EXISTING}** — 0103 §Recommended Cloudflare topology item 4 and §Security model rely on "a separate action role or demonstrably equivalent kill domain" to keep slow/egress action work from blocking transactional handlers, and 0105 Open decision 3 still lists "Two handler/action scripts versus a proven independent kill domain" as unresolved. This is an honestly-flagged open decision feeding Gate 0, not a defect, but 0103 Decision 4 ("isolation … not deferrable") and the security model read as if the separation is settled while 0105 keeps it open. Resolves by 0103 noting the mechanism choice is a 0105 open decision. Detail.

**Cross-document consistency**

- **Durable identity:** Consistent across all three. 0103 §Project and environment identity, §Transfer and deletion; 0104 §Metering identity and event contract; 0105 §Work ownership (Snapback bullet) and §Cross-repository ledger (Identity row) all state the owner-independent `(expoAppId, snapbackEnvironmentId)` key with `expoAccountId` as time-versioned attribution and transfer rekeying nothing. No contradiction found.
- **Storage ceiling:** 0103 §Interim per-environment scale envelope and 0104 §Service limit describe the same per-environment ceiling (safely below the 10 GB LLP 0014 hard limit, headroom for indexes/system tables/PITR/compaction) with matching at-ceiling behavior (warn → refuse writes; reads/live/export/deletion continue; never silently drop; never bill into exhaustion; exit is export/graduation to LLP 0046). 0104 explicitly cross-references 0103's section. Consistent. The only gap is the free-tier account-aggregate vs. per-environment interaction (Concern 1).
- **Price is a gate output, not a number:** 0104 §Summary/§Margin gate/Decision 1 and 0105 P0.4/Gate 0 agree that the $0.25/GB-mo DB-storage price and the request/CPU-reuse decision are *outputs* of the Phase-0 write-amplification and logical-storage measurements. The $0.20 floor and 1000× write:read facts trace correctly to LLP 0014 §Platform Facts. Coherent.
- **Fence ↔ plan:** 0103 §Release pinning and cutover fence and Decision 5 align with 0105 P0.3, which proves the repair invariant and pin-across-route-shapes rather than re-opening whether a fence is needed. The one under-specified seam is the admission compatibility check (Concern 3).
- **LLP 0089 scope:** 0103 §Paved path narrows 0089 to artifact provisioning and claims the hosted-lifecycle operation contract here; 0105 §Work ownership (Universe) and §Cross-repository ledger (Deploy row) mirror that split. Consistent.
- **PITR:** 0104 free-tier PITR is capability-gated on 0105 Gate 1; 0103 §Completeness gap matrix lists backup/export as substantial-unbuilt. Consistent and honest.

**Verdicts**

- 0103: READY
- 0104: READY
- 0105: READY
- SET: READY

---

## Round 3 (final delta) — 2026-07-28 (/llp-super-refine)

- **Entry revision hashes (revision 3):** 0103 `ad022d13` · 0104 `01290602` · 0105 `016dac73`.
- **Instruction hash:** `2714de89` (`/tmp/sr3/instruction.md`; delta enumerated).
- **Runtime:** Fable via general-purpose subagent (file read access).
- **Blindness:** launched concurrently with the round-3 GPT review; instructed to exclude `llp/reviews/`; instruction-based, self-attested; sealed until both landed.

**Method:** Read all three current targets (0103 rev-3, 0104 rev-3, 0105 rev-3) in full, plus LLP 0014 platform facts (10 GB/object hard limit, $0.20/GB-month, 1000× write:read, 20:1 incoming-WebSocket-frame:request, hibernation, objects placed at first `get()` and non-relocating) and LLP 0089's `provisioning.v0` operation table and open questions. No exposure to anything under `llp/reviews/`.

**Overall assessment**

Revision 3 lands the round-2 MATERIAL concerns cleanly, and I read all five as resolved. The coordinator-issued release-epoch fence is now a real ordering mechanism, not an assertion: the coordinator (not the gateway pre-read) binds both admission and execution to a monotonic epoch, drain-and-revoke is the default, and the compatibility-window alternative is gated on a concrete admission check (declared compat contract + schema-superset + representative replay) and bounded by an enforced maximum socket lifetime / re-pin deadline. The transfer fence in 0104 revokes/epochs old-owner leases, bounds in-flight spend to what committed under the old interval, and requires a new-owner lease before post-cutover work — genuinely closing the in-flight-lease-spend-across-ownership-change hole rather than relying on cache invalidation. The logical-storage quantity is now honestly named "allocated non-freelist page bytes, an upper bound on live logical bytes," self-corrects the prior false deleted-but-unreclaimed exclusion, names the exact APIs, treats missing samples as irreversible conservative carry-forward, and reconciles per-object samples in aggregate to the namespace-level provider bill with an allocation rule and error bound (no per-stable-id physical charge claimed). The 0089 mapping is internally consistent with 0089 itself and non-contradictory across all three docs. The two scale ceilings are named formulas producing Gate-0 dated outputs with a pin-identical-values-before-beta step in both 0103 and 0104, mirrored by 0105 P0.4/Gate 0. Remaining items are detail-altitude.

**Concerns**

1. **[detail] {IN-DELTA}** — *Chargeability of `transfer` and `preview-TTL governance` is unclassified.* 0104 §Chargeable operation classification (`operation-class.v1`) enumerates create/promote/rollback/inspect/suspend/delete as non-chargeable and export/restore as chargeable, but `transfer` and `preview-environment TTL governance` — both owned by 0103's hosted-lifecycle contract — are not named in either list. Resolves by adding both to the non-chargeable enumeration when the table is next versioned; no decision is defective, so this does not block.

2. **[detail] {IN-DELTA}** — *Compatibility-window replay coverage is a bounded-but-unquantified claim.* 0103 §Release pinning and cutover fence rests the "accept old+new handlers" path on replay of "representative" in-flight request shapes. Neither doc states a coverage floor or what happens to a shape not in the representative set mid-window. Because the default path is hard drain-and-revoke and the window path is opt-in and re-pin-deadline-bounded, an unrepresentative shape degrades to termination-at-deadline, not silent corruption — so the safety property holds. Implementation-phase refinement (define the representativeness bar in P0.3 receipts), not a defect.

3. **[detail] {PRE-EXISTING}** — *Reserved-headroom safety margin has no lower bound named.* 0103/0104 give `storage ceiling = 10 GB − reserved headroom` with PITR depth workload-dependent; no doc states a floor the ceiling cannot drop below. A Gate-0 measurement output, correctly deferred; the formula is checkable and the pin step forces a dated number before beta. Detail.

4. **[detail] {PRE-EXISTING}** — *Action-isolation mechanism deferral is correctly scoped but Gate-0 exit lacks an explicit mechanism-decision line.* 0103 Decision 4 names the isolation property non-deferrable and the mechanism a 0105 open decision; Gate 0 proves the property but does not force the mechanism to be chosen at the gate. Acceptable altitude; a one-line "mechanism selected" gate criterion would make it fully checkable. Detail.

5. **[detail] {IN-DELTA}** — *Namespace-level reconciliation allocation rule is asserted, not specified.* 0104 and 0105 P0.4 aggregate first-party per-object samples to the namespace bill "under an explicit allocation rule and error bound," but the rule itself is a Gate-0 output rather than stated. Right altitude — a measurement/derivation obligation, and the "persistently widening ratio is a margin-gate signal, not a silent customer charge" clause prevents it reaching an invoice. Detail.

**Cross-document consistency**

- **Epoch fence** — 0103 §Release pinning and cutover fence and 0105 P0.3 agree: coordinator-issued epoch, admission+execution bound at the coordinator, drain-and-revoke or bounded compat window with enforced max socket lifetime, admission compat check, non-responsive-WebSocket closure at re-pin deadline, non-alias/preview/custom-domain traffic pinned on the registry entry. Consistent.
- **Transfer fence** — 0104 §Authoritative account-budget protocol, 0105 Gate 1/P0.4, and 0103 §Transfer and deletion agree (ownership-interval attribution, revoke/epoch old-owner leases, new-owner lease before post-cutover work). Consistent.
- **0089 mapping** — 0103 §Paved path table, 0105 §Work ownership + ledger, and 0104's op table treat 0089 as contract authority (create/push/activate incl. rollback+anti-rollback), Universe as hosted implementation authority, tenant/billing lifecycle owned by 0103, `app.delete`/lifecycle-v1 a flagged 0089 amendment — matching 0089 itself. No contradiction.
- **Scale ceilings** — 0103 and 0104 carry byte-identical formulas, same Gate-0 provenance, same pin-before-beta step; 0105 P0.4/Gate 0 produces them; `min(account aggregate, per-env ceiling)` reconciles the free aggregate. Consistent.
- **20:1 / margin inputs** — 0104 §Margin gate names the 20:1 ratio and hibernation, matching 0014. Consistent.

No unresolved MATERIAL concern remains for any target or for the set. All open items are detail-altitude implementation/measurement refinements that the Gate-0/P0.3/P0.4 receipt obligations already own.

**Verdicts**

- 0103: READY
- 0104: READY
- 0105: READY
- SET: READY

---

## Round 4 (delta) — 2026-07-28 (/llp-super-refine)

- **Entry revision hashes (revision 4):** 0103 `12624eb4` · 0104 `efef254e` · 0105 `fd52455b`.
- **Instruction hash:** `a1da1700` (`/tmp/sr4/instruction.md`; delta enumerated).
- **Runtime:** Fable via general-purpose subagent (file read access).
- **Blindness:** launched concurrently with the round-4 GPT review; instructed to exclude `llp/reviews/`; instruction-based, self-attested; sealed until both landed. Brief working-notes preamble omitted; review body verbatim.

**Overall assessment**

Revision 4 is a strong, coherent set. The four revision-introduced fixes I was asked to scrutinize each landed correctly and are, for the most part, sound by construction: the drain-and-revoke default with a machine-checkable window rule (replay demoted to supplemental, rule-failure falls back to drain-and-revoke); admission-bound attribution + the atomic transfer boundary (commits-after-cutover charge the old owner); the storage formula sourced to named PRAGMAs with `databaseSize` as a validated cross-check and an honest upper-bound framing with a customer-favorable missing-sample policy; and the `environment.create`/`environment.inspect` split consistent with LLP 0089. No prior-round MATERIAL concern remains open that I can identify. The remaining items are details.

**Concerns**

1. **[detail] {IN-DELTA}** — `PRAGMA page_count`/`freelist_count`/`page_size` availability inside DO-SQLite is asserted (0104 §Defining billable "logical SQLite bytes"; 0105 P0.4) but not anchored in LLP 0014 platform facts, which document only `sql.exec`/`transactionSync`. The formula is arithmetically correct and these PRAGMAs are standard SQLite, and P0.4 is where it would be verified with a `databaseSize` cross-check fallback — so a detail. Fix: note PRAGMA availability on DO-SQLite as a Gate-0 verification item.

2. **[detail] {IN-DELTA}** — The 0104 op-class non-chargeable enumeration omits the LLP 0089 push/read/lockdown provisioning operations (`code.push`/`schema.push`/`permissions.push`, `capabilities.read`, `schema.lockdown`). Safe by construction (unlisted defaults to non-chargeable), so detail; fix by adding a default-non-chargeable note for them.

3. **[detail] {PRE-EXISTING}** — The two scale-envelope ceilings remain formula-only pending Gate 0. By design (Gate-0 outputs + pin-before-Phase-2), so not a defect; the SET can't be fully coherence-checked on actual ceiling values until Gate 0 runs.

4. **[detail] {IN-DELTA}** — The missing-sample estimator's "reproducible" claim is asserted but the estimator method is undefined (only its error bound is a Gate-0 output). Because the customer-favorable policy makes it impossible to overcharge regardless of the method, this is a Phase-0 detail, not a decision defect.

**Cross-document consistency**

- **Transfer boundary:** consistent across 0103 §Transfer and deletion, 0104 §Authoritative account-budget protocol, and 0105 P0.4/Gate 1 (same four-step atomic coordinator boundary + commits-after-cutover-charges-old-owner invariant).
- **0089 stable-ids:** `environment.create` (0103, distinct from 0089 `app.create`) and `environment.inspect` (distinct from LLP 0024's `app.inspect`) stated identically in 0103, 0104 op-class, and 0105; verified against 0089 (which defers `app.inspect` to LLP 0024). Required-0089-amendment flag present and consistent.
- **Cutover fence / scale-ceiling pin / storage formula + `databaseSize` cross-check:** identical across the docs they span (subject to concern 1's platform-fact caveat).
- One minor wording asymmetry (non-blocking): 0104 op-class calls rollback a lifecycle operation the 0103/0104 surface enumerates, while 0103/0105 treat `code.activate` (rollback) as 0089-owned. Reconcilable (0089-owned and surfaced in lifecycle UX); both agree it is non-chargeable.

**Verdicts**

- 0103: READY
- 0104: READY
- 0105: READY
- SET: READY

---

## Round 5 (delta) — 2026-07-28 (/llp-super-refine)

- **Entry revision hashes (revision 5):** 0103 `ec05fc83` · 0104 `3d3751b6` · 0105 `b1d87cc3`.
- **Instruction hash:** `af973354` (`/tmp/sr5/instruction.md`; delta enumerated).
- **Runtime:** Fable via general-purpose subagent (file read access).
- **Blindness:** launched concurrently with the round-5 GPT review; instructed to exclude `llp/reviews/`; instruction-based, self-attested; sealed until both landed. Brief working-notes preamble omitted; review body verbatim.

**Overall assessment**

Revision 5 of the RFC/Spec/Plan triad. The five enumerated round-4 deltas have, in the main, landed correctly and are coherent across the three documents. The prior round's MATERIAL concerns — the compatibility-window escape hatch, the non-atomic app-wide transfer, the un-obligated missing-sample estimator, the op-id split, and the meter/ceiling storage-basis divergence — now read as substantively resolved. The compatibility window is genuinely safe-by-construction (enumerated additive change classes, replay demoted to supplemental, hard drain-and-revoke default). The two-phase multi-coordinator transfer has a real all-coordinator-ack publication point, abort-with-retained-ownership, and unavailable-coordinator handling, stated identically in 0103/0104/0105. The missing-sample estimator is a concrete Gate-0 experiment with a provable worst-case error bound. The storage basis is reconciled: meter and ceiling both on allocated-non-freelist page bytes with index/system-table pages in-band, headroom confined to PITR/slack/margin in both 0103 and 0104. I found no unresolved MATERIAL defect. Residual items are details (one genuine internal-wording inconsistency in 0104 §Summary worth a one-line fix). I recommend the SET READY.

**Concerns**

1. **[detail] {IN-DELTA}** — 0104 §Summary still carries the pre-delta "physical overhead the customer meter does not count" framing. The parenthetical does the corrective work correctly (index/system-table pages ARE counted; PITR/replication/slack are NOT), so the statement is ultimately accurate, but the lead clause is the exact phrasing the delta set out to retire and survives only because the parenthetical rescues it. Wording residue, not a decision defect; the meter definition, meter table row, and §Service limit are all internally consistent with the in-band basis. Resolves by tightening the lead clause to "the physical overhead beyond the metered allocated-non-freelist quantity." Does not block READY.

2. **[detail] {PRE-EXISTING}** — The DB-storage price ($0.25/GB-month) and both scale-envelope ceilings remain unpinned pending Gate 0. By design and correctly gated (formulas, reserved-headroom basis, and pin-before-Phase-2 ratification all named). Deliberately deferred implementation-phase output, not a defect. Resolves at Gate 0.

3. **[detail] {IN-DELTA}** — PRAGMA availability is correctly a Gate-0 verification item with a `databaseSize` cross-check fallback, but `databaseSize` supplies `page_count × page_size` not `freelist_count`, so the fallback measures a strictly larger quantity than the primary meter. The docs treat it only as a cross-check; neither states whether billing on the fallback would over-count freelist space or whether the customer-favorable policy still governs. Gate-0 refinement, not a decision defect (the fallback is a cross-check, not the declared billing source). Resolves by a one-line Gate-0 note that the fallback inherits customer-favorable settlement.

4. **[detail] {IN-DELTA}** — The transfer protocol's "bounded retry window" for an unavailable coordinator is qualitative; its duration is unpinned. The safety property (blocks publication, then explicit abort with retained old ownership) is sound and independent of the specific bound. Phase-0/Gate-1 operational parameter. Detail, not defect.

**Cross-document consistency**

- **Op-id encoding** consistent three ways: 0104 classifies `code.activate` once with promote/rollback modes; 0103 and 0105 render promote/rollback as modes of the one 0089 op. Matches LLP 0089.
- **Storage basis** agrees between 0103 §Interim per-environment scale envelope and 0104 §Service limit / §Defining billable "logical SQLite bytes": billed quantity and ceiling both on allocated non-freelist page bytes with index/system-table in-band; headroom = PITR + compaction/allocation slack + safety margin in both, with explicit no-double-count. 0105 P0.4 measures each component. (Only friction is the 0104 §Summary lead clause — Concern 1, a wording residue, not a cross-doc contradiction.)
- **Compatibility window** agrees between 0103 §Release pinning and cutover fence and 0105 P0.3 (identical enumerated additive change classes; constraint/permission/trigger/default/data-invariant/semantic changes force hard drain-and-revoke; replay supplemental; drain-and-revoke default).
- **Multi-coordinator transfer** stated identically in 0103 §App-wide multi-coordinator transfer protocol, 0104 §Authoritative account-budget protocol, and 0105 P0.4/Gate 1 (global transfer epoch → per-coordinator prepare/fence+ack → publication after ALL ack → abort-with-retained-ownership + unavailable-coordinator bounded retry else abort). New-owner leases required per environment before post-publication admission in all three.
- **Missing-sample estimator** agrees between 0104 and 0105 P0.4/Gate 0 (fault-inject growth+shrinkage, prove worst-case error bound, customer-favorable settlement + credit).

No contradictions found across the three documents.

**Verdicts**

- 0103: READY
- 0104: READY
- 0105: READY
- SET: READY

---

## Round 6 (delta) — 2026-07-28 (/llp-super-refine) — CONVERGED

- **Entry revision hashes (revision 6):** 0103 `0bb0859b` · 0104 `f1b4a06d` · 0105 `f0e7c43d`.
- **Instruction hash:** `57dfbe28` (`/tmp/sr6/instruction.md`; delta enumerated).
- **Runtime:** Fable via general-purpose subagent (file read access).
- **Blindness:** launched concurrently with the round-6 GPT review; instructed to exclude `llp/reviews/`; instruction-based, self-attested; sealed until both landed. Brief working-notes preamble omitted; review body verbatim.

**Overall assessment**

Revision 6 of a tightly-coupled RFC/Spec/Plan cluster that has absorbed five prior rounds of correction. The four delta items land cleanly and cohere across all three documents. The prior round's central MATERIAL risk — the prepare/commit/abort state machine's internal contradiction (prepare-revokes vs. abort-retains) — now reads as resolved: prepare uniformly *freezes* old-owner leases (pausing admission and new-lease issuance without destroying them), commit *revokes/epochs* them, and abort *restores/re-issues* them, stated identically in 0103 §App-wide multi-coordinator transfer protocol, 0104 §Authoritative account-budget protocol, and 0105 P0.4. The participant-set freeze (durable snapshot + serialization of `environment.create`/two-stage `delete`/`restore` against the epoch + publication-time re-validation) closes the TOCTOU hole, with 0105 P0.4 injecting a mid-transfer create/delete/restore. The PRAGMA-as-Gate-0-failure decision is coherent: because `databaseSize` cannot recover `freelist_count` and would over-count, refusing to ship the meter on an over-counting basis (rather than silently falling back) is the correct, customer-favorable call, stated consistently in 0104, 0105 P0.4, and Gate 0. The headroom fix (index/system-table in-band; reserved headroom = PITR + compaction/allocation slack + safety margin) matches across 0103/0104/0105. I find no unresolved MATERIAL defect in any of the three. Remaining items are implementation/Gate-0-owned refinements at detail altitude.

**Concerns**

1. **[detail] {IN-DELTA}** — Serialization enforcement point for the participant-set freeze is asserted but not located. The durable authority that gates `environment.create`/`delete`/`restore` against a live app-level transfer epoch is the control-plane owner-of-record (Universe); neither 0103 nor 0104 pins that Universe's lifecycle path must consult the app's active transfer epoch before admitting a create. The publication-point re-validation catches the divergence and aborts, so not a correctness hole — a Gate-0/implementation obligation (0105 P0.4 already injects the case). Does not block READY.

2. **[detail] {IN-DELTA}** — "Customer-favorable fallback billing path" is under-specified; the default path is "block until resolved," not "fall back," so the under-specification is intentional and altitude-appropriate. Resolves as a Gate-0 output if the contingency arises. Does not block READY.

3. **[detail] {PRE-EXISTING}** — The 20:1 WebSocket frame billing asymmetry is named as a margin-gate input (0104 §Margin gate, traced to LLP 0014) but its interaction with the realtime meter is deferred to the gate. Correctly gate-owned. Does not block READY.

4. **[detail] {PRE-EXISTING}** — Dynamic Workers/Facets beta-prohibition (LLP 0014) is respected: 0103 keeps WfP as the launch boundary and Facets as an evidence-gated future optimization. No conflict; no action required.

**Cross-document consistency**

- **Prepare/commit/abort state machine:** consistent across 0103, 0104, and 0105 P0.4/Gate 1 (prepare freezes, commit revokes/epochs, abort restores; "no partial ownership attribution").
- **Participant-set freeze / TOCTOU:** consistent (snapshot + serialize + publication re-validation; 0105 P0.4 injects mid-transfer create/delete/restore).
- **PRAGMA billing basis:** consistent (missing PRAGMA = Gate-0 failure; `databaseSize` cross-check only).
- **Headroom / storage ceiling:** consistent (index/system-table in-band; headroom = PITR + slack + margin; numeric ceiling a Gate-0 output pinned before Phase 2).
- **Op-class / LLP 0089 authority:** consistent (`code.activate` promote/rollback modes; `environment.create` ≠ 0089 `app.create`; `environment.inspect` ≠ LLP 0024 `app.inspect`).

No contradictions found across the three documents.

**Verdicts**

- 0103: READY
- 0104: READY
- 0105: READY
- SET: READY

**Dual-READY with the GPT family → loop converged on revision 6.**
