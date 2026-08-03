# LLP 0166 local persistent store review — Fable family

## Round 1 — 2026-08-03

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent, model
`claude-fable-5`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author Fable session (subagent with no authoring
context) over the working tree at b9fd27af; instructed to read LLP 0166 in
full plus LLP 0155 §Move 2/OQs, LLP 0157 (§Vocabulary, §D2, §D3, §D6, §D7,
§Migration), LLP 0008 DK-9 + dated note, LLP 0080 retention section + dated
note, LLP 0043 (M1, outbox lifecycle, 0157 boundary note), LLP 0053 (rules
0166 cites), LLP 0090 (ladder, channels, `rqsEligible`, store lifecycle),
LLP 0161 OQ5 + §3, LLP 0162 §Non-goals/§1, and to spot-check the cited code
facts (`rqs-store.mjs`, `outbox-shared.mjs`, `client-store.mjs`,
`manifest.rs`); instructed not to read anything under `llp/reviews/`
concerning 0166. Orchestrated by the Fable session that authored the draft,
which therefore does not count as a reviewer; this artifact records the
independent review verbatim below.

---

## 1. Overall assessment

**NOT READY** — confidence **0.75**.

This is a strong v0.1: the ownership discipline is genuinely clean (no
second identity, witness, or interface is minted anywhere; every
destructive transition routes through LLP 0053), every repo-level fact I
checked verifies against the tree (store name, `DATABASE_VERSION`, budget
constants, outbox caps, `rqsEntryKey`/`retainedQueryKey`,
`rqs_eligible_digest_kind`, the Expo `durable: false` posture, the
file-carrier SQLite comment, the `resumedAt`/`savedAt` eviction order, the
VersionError skew posture), and the three-address-family model is honest
about the shipped population's lack of plan identity rather than papering
over it. What keeps it out of READY is contract exactness — the thing a
Move-2 owning Spec exists to provide. The carried LLP 0080 amendment mints
a retention class the Accepted LLP 0157 classification layer cannot
represent and that §D3's own persistence-authority list omits, so the
acceptance-lands amendment set is incomplete on the Spec's own mechanics;
the registration record's cross-field semantics (source × priorityClass,
multi-registration merge, per-source durability, which arms participate)
are open to implementer guessing; the single-writer store's composition
with multi-tab `active` registrations — the shipped store's hardest
real-world case — is unspecified; and the OQ1 adoption path omits an owner
fact (LLP 0080's no-anonymous-retention rule) that would make the staged
adoption a capability regression. No finding rises to contradiction of an
Accepted owner, so nothing is BLOCKING, but the MATERIAL set is exactly
the kind of gap the loop exists to close before this becomes a stable
contract.

## 2. Strengths

- **Scope and authority (§Scope, §Summary).** The owns/does-not-own split
  is exact and matches the owners as they stand today: LLP 0157 §D7's
  records and operations are consumed byte-for-byte, LLP 0043's custody
  and LLP 0053's dispositions are composed rather than amended, and the
  Spec correctly distinguishes what is landed (the 0043/0053 boundary
  notes at `llp/0043-offline-replay-retention.rfc.md:536-547` and 0053's
  Revised header; the 0043/0012/0095 identity amendments dated
  2026-08-03) from what it carries (§D7's DK-9/0080 texts). No unlanded
  amendment is claimed as landed.
- **§D1's OQ5 answer.** The middle-option ruling is well argued: the
  atomicity obligations (settlement-before-exposure, wipe of
  retained+outbox in one transaction, fenced CAS across fragments and
  product state) genuinely cannot span IndexedDB databases, and the
  shipped budget/lock/GC machinery on `snapback-rqs-store.v1` is real
  (`packages/snapback-client/rqs-store.mjs:30-43`).
- **§D3's address-family table.** Recording that the shipped `rqsEligible`
  population has no `PlanHashV1` and no completeness proof — and refusing
  to reclassify it by inference, routing that through OQ1 as an owner
  proposal under 0157 §D1's growth-stop rule — is exactly the honesty
  0157's Vocabulary demands. The "single-table" characterization is
  derivable from LLP 0080 §4 (relational plans are never
  `authorityIndependent` in v1), so the population claim is sound.
- **§D3/§D5 barrier-vs-eviction separation.** "Eviction is never a
  substitute for a barrier" plus the S7 probe (a barrier-pending record is
  not evictable-to-skip the barrier) is the sharpest security content in
  the document and correctly consumes 0157 §D7 op 7's no-stranding rule.
- **§D6.** The three-lane model is faithful to the owners: the outbox
  protocol rule and the 2026-08-01 retained-render note are transcribed
  correctly from LLP 0090 D3, the lease-family adoption rules match
  0043's boundary note word-for-word, and the no-composite-resume-
  credential fact matches 0157 §D4 item 3.
- **§D8.** The P1–P9 classification is defensible per row, consistent with
  LLP 0162's Non-goals (client store excluded, OQ5 left to this document)
  and with 0161's own text (the P6 split leans on the journal-replay fact
  OQ5 itself cites; P7 cites the same LLP 0126 prior art). The "nothing
  pulled forward" sequencing answer is correct given the verified
  0043/0012/0095 amendments.
- **§Executable acceptance.** S1–S8 are real oracles, not vibes; S4's
  byte-compatibility bar against the shipped `rqs-resume-suite.mjs`
  (exists in tree) and S5's crash-at-every-write-boundary case are the
  right successor-store obligations.
- **§D9 bundle accounting** discharges LLP 0155 Move 2's explicit
  0145-reconciliation obligation with figures that match LLP 0145 §F2
  exactly (16.5 / 7.8 / 6.7 kB,
  `llp/0145-client-bundle-architecture.research.md:414-417`).

## 3. Concerns

1. **MATERIAL — the carried LLP 0080 amendment mints a retention class the
   Accepted LLP 0157 layer cannot express, and §D3 omits it too.** §D7's
   amendment adds `fragment-evaluated-snapshot-v1` to LLP 0080's closed
   retention set at this Spec's acceptance. But Accepted LLP 0157 §D2 pins
   `retention: "none" | "opaque-authorized-snapshot-v1"` as the exact
   closed union in both `NodeCapabilityBindingV1` and
   `PlanCapabilityClassificationV1`
   (`llp/0157-composition-algebra-and-completeness.spec.md:322-324,
   341-343`), values enter `NodePlanHashV1`/`PlanHashV1` preimages, and
   §D4 rule 1 refuses a mismatched binding. So on acceptance the class
   exists in 0080 but no plan can ever carry it — the identity layer
   refuses — until a dated LLP 0157 amendment widens the union, which the
   §Acceptance-path lands list (0008, 0080, plus 0043/0053/0090 boundary
   notes) does not include. Compounding this, §D3's persistence
   condition 2 (the closed retention-authority list) also never names the
   new class, so even this Spec's own retention law has no branch that
   admits a `fragment-evaluated-snapshot-v1` plan post-amendment. Why it
   matters: the Spec's acceptance mechanics land an inert amendment and
   leave its own §D3/§D7 internally disconnected; an implementer cannot
   tell which document must move before the class is bindable.
   Resolution: add the dated LLP 0157 classification-union amendment (or
   an explicit statement that the class becomes bindable only via a
   future 0157 dated amendment, named in §D7's ship gate), and extend §D3
   condition 2 to name the class with its inherited custody.

2. **MATERIAL — `QueryRegistrationV1` cross-field semantics are not closed
   (§D2, §D5).** The record carries both
   `source: "active"|"preload"|"programmatic"` and
   `priorityClass: "active"|"preload"|"background"`, but no constraint
   relates them: is `source:"active", priorityClass:"background"` valid,
   refused, or meaningful? §D2's hydration order keys on `priorityClass`;
   §D5's lifecycle keys on `source` ("≥ 1 `active`-source registration"),
   so the two axes have divergent load-bearing consumers and no stated
   coupling. Worse, registration is "idempotent at the address" with a
   count — but when multiple registrations at one address disagree on
   `idleTtlClass`, `retentionRequest`, or `priorityClass`, no merge rule
   exists (§D5 TTL says "its registration's `idleTtlClass`", singular).
   Per-source durability is also unpinned: `active` registrations "exist
   while the subscription does" (transient), `preload` presumably
   re-derives at boot from the manifest, `programmatic` is presumably
   durable — but the Spec never says which registration facts persist
   across restart, which S1's "the retained set equals the registration
   set at every step" needs to be decidable. Finally, §D2's "otherwise the
   legacy alias key its arm already uses" leaves ambiguous whether
   Contract-arm `retainedQueryKey` records (a separate artifact per
   §D3/§D9) participate in this store's registration set at all. Why it
   matters: this is the Spec's central new record, and every one of these
   is a guess an implementer must make. Resolution: state validity
   constraints (or derive `priorityClass` from `source` and drop the
   field), define the multi-registration merge (e.g., strongest-wins per
   axis), pin per-source durability, and state explicitly that the v1
   registration set covers the `qmk1` and legacy-resume families only.

3. **MATERIAL — multi-tab composition of registrations with the
   single-writer store is unspecified (§D1, §D2, §D5).** §D1 consumes the
   shipped Web Locks single-writer discipline (non-holders "read and
   adopt, never write"). But registrations are durable store writes: a
   non-writer tab's `active` `liveQuery` subscription cannot durably
   register, so under §D5's lifecycle its materialization is not `active`
   in the store and is eligible for release/eviction while a live tab is
   rendering it — the exact case the shipped store handles by adoption.
   S1's sync-set-fidelity oracle is also writer-relative and doesn't say
   so. Why it matters: two contending tabs are the first Move-2
   carrier-exit leg (0157's transcribed gate); a store that evicts what a
   non-writer tab is showing, or a spec silent on it, will fail that gate
   ambiguously. Resolution: specify how non-writer registrations reach
   the sync set (writer proxies them via observed adoption, or non-writer
   registrations are volatile with an explicit no-eviction-while-observed
   rule), and add the two-tab case to S1.

4. **MATERIAL — the 0157 §Migration tension is not reconciled (§D6).**
   Accepted LLP 0157 §Migration says existing RQS retained snapshots
   "migrate to materialization-key identity where their recorded
   plan/args/activation facts prove it, or fall back to fresh sync; a
   migration that cannot prove identity discards retained state rather
   than mislabeling it"
   (`llp/0157-composition-algebra-and-completeness.spec.md:1845-1849`).
   §D6 instead keeps the legacy resume population indefinitely under
   LLP 0090's rules ("they never adopt `qmk1` in v1"). A good-faith
   reading reconciles these — not-migrating is not mislabeling, and the
   population provably has no identity facts to migrate on — but the Spec
   never says this, and an adversarial reading of 0157's discard sentence
   conflicts with indefinite coexistence. Why it matters: this is the
   Spec's declared-successor seam against its Accepted upstream; the
   reconciliation must be on the record, not in the reviewer's head.
   Resolution: add one §D6 sentence reconciling with 0157 §Migration
   explicitly (coexistence-under-own-labels satisfies never-mislabel; the
   migrate-or-discard rule governs any attempted adoption), and include
   it in the planned dated 0090/0157-facing boundary notes.

5. **MATERIAL — OQ1's adoption path omits the anonymous-retention
   consequence (§D3, §D6, OQ1).** LLP 0080 pins that anonymous results
   have no admissible v1 retention — `opaque-authorized-snapshot-v1`
   requires a server-resolved authenticated principal for the lease, and
   all-public plans are `retention: "none"` until LLP 0053 defines an
   anonymous lease class
   (`llp/0080-portable-relational-queries-and-projections.rfc.md:373-380`).
   The `rqsEligible` population is precisely public/authority-independent,
   and its current durable retention authority is the LLP 0090 Channel-B
   rules. If OQ1 registers a `single_table_v1` node class and the
   population adopts `qmk1`, §D3's persistence conditions give it no
   retention authority: it isn't the legacy population anymore, and
   0080's class is unreachable for anonymous principals — so the staged
   adoption would silently retire the shipped offline-public-dashboard
   capability. Why it matters: the Spec stages an adoption path whose end
   state is a capability regression it never names. Resolution: state in
   §D6/OQ1 that adoption additionally requires either the Channel-B
   retention authority traveling with the family or an anonymous
   lease/retention class landing in 0053/0080 first.

6. **MATERIAL — outbox cap values are attributed to LLP 0043, which does
   not state them (§D3).** "(LLP 0043: 1,024 records / 4,096 pending
   acknowledgements)" — those values exist only as shipped code constants
   (`packages/snapback-client/outbox-shared.mjs:23-25`,
   `OUTBOX_MAX_RECORDS = 1024`, `OUTBOX_MAX_PENDING_ACKS = 4096`);
   LLP 0043's text contains neither number (its 1,024 is the unrelated
   server-side per-fingerprint ledger cap,
   `llp/0043-offline-replay-retention.rfc.md:334`). The
   refuse-at-capacity posture is correctly 0043's. Why it matters: the
   review standard treats an unverifiable owner-document claim as at
   least MATERIAL, and a future 0043 editor cannot find the values they
   allegedly own. Resolution: cite the constants as the shipped
   implementation values under 0043's posture (or land them in 0043 via
   the planned boundary note).

7. **MATERIAL — `wipe` semantics are underspecified against 0053's
   preserved-bookkeeping rules (§D1, §D5) and the §D6 handle key (§D1).**
   §D1 defines `wipe` as clearing retained state and outbox atomically;
   §D5 adds it is the identity barrier's tool. Unstated: whether `wipe`
   preserves the store-wide `query_instance_id` allocator high-water
   (LLP 0053 requires never-reuse and allocator survival across
   compaction/retirement), the fence/tombstone/barrier high-waters
   0053's delete rules preserve, and what happens to the LLP 0157 §D6
   local-row-handle HMAC key — 0157 pins it "destroyed with the store";
   if `wipe` preserves it, predecessor and successor identity epochs mint
   comparable handles across an authority barrier. Why it matters: `wipe`
   is the one operation that runs exactly at identity boundaries, where a
   wrong default is a replay or correlation hole. Resolution: one §D1
   paragraph — `wipe` preserves allocator and barrier/tombstone
   high-waters per LLP 0053, rotates (destroys and re-mints) the handle
   key, clears everything else.

8. **NIT — "the routes-manifest `persist: false` opt-out" reads as shipped
   surface (§D2).** The per-manifest-entry opt-out is designed in
   LLP 0090 D3 but unshipped; the shipped surrogate is the per-call
   `persistResume` client option, whose own comment calls it a
   "client-option stand-in for the per-manifest-entry `persist: false`"
   (`packages/snapback-client/index.mjs:7211`). Reword to "the designed
   per-manifest-entry opt-out (LLP 0090 D3) and its shipped
   `persistResume` stand-in."

9. **NIT — S2 pins to "this Spec's tables exactly," but the answer matrix
   exists only as §D4 prose.** Either add the consolidated family ×
   credential × outbox × connectivity table §S2 implies, or reword S2 to
   cite §D4's regimes.

10. **NIT — §D2's establishment concurrency bound (v1 default 4) is not
    marked dated-amendable**, unlike §D3/§D5's constants, and §D8's
    sequencing parenthetical "the 2026-08-03 identity/retention
    amendments" is loose enough to be misread as the (unlanded) 0080
    retention amendment — name the 0043 §LLP 0162 amendment and the 0043
    §LLP 0157 boundary explicitly.

11. **NIT — idle-grace anchor corner (§D5).** `"default"` grace runs
    "from last authoritative establishment," so a record released long
    after its last establishment is evictable immediately on release.
    That appears deliberate (credential-family alignment) but should be
    stated, since "14 days of grace" will otherwise be read as
    release-anchored.

## 4. Suggestions

- Add the consolidated answer-matrix table (concern 9) — it would also
  make S2 mechanically checkable and is the single highest-leverage
  exactness addition.
- In §D3, give the legacy families' mapping into the successor eviction
  clock one explicit sentence (legacy "last authoritative establishment"
  := `resumedAt`, falling back to `savedAt` for never-resumed entries),
  matching the shipped comparator
  (`packages/snapback-client/rqs-store.mjs:212-214`).
- §D7 could state in its own voice (not only inside the 0080 amendment
  quote) that evaluation admission is per-plan via the new retention
  class — the contract currently implies it transitively.
- Consider naming the lock-unavailable diagnostic per carrier
  (`SNAPBACK_RQS_STORE_LOCK_UNAVAILABLE` at `rqs-store.mjs:251` vs DK-9's
  `SNAPBACK_CLIENT_STORE_LOCK_UNAVAILABLE`) under the same placeholder
  rule §D7 already applies to codes.
- S5 could add a grace-clock leg: do in-grace `released` records survive
  a format migration with their clocks intact?

## 5. Open questions the document should carry but does not

1. The multi-registration policy-merge rule and the source/priorityClass
   coupling (concern 2) — if not closed in text, it must at least be an
   OQ.
2. Multi-tab registration composition under the single-writer discipline
   (concern 3).
3. Whether Channel-B retention authority travels with OQ1 adoption, or an
   anonymous lease/retention class must land first (concern 5).
4. Handle-key rotation and allocator/bookkeeping survival at `wipe`
   (concern 7), if the author prefers deferring to an owner ruling rather
   than closing it in §D1.
5. Registration-fact durability per source class across restart (folds
   into concern 2).

## 6. Recommended next step

Apply the MATERIAL fixes — concern 1 first (extend the acceptance-lands
list with the dated LLP 0157 classification amendment and integrate the
class into §D3's authority list), then 2/3 (close the registration record
and multi-tab composition in text), 4/5 (one reconciliation sentence
each), 6/7 (citation and `wipe` paragraph) — and run round 2 of the
dual-family loop on the revised draft. Nothing here challenges the
commission's shape or the §D1 physical answer; this is convergence work,
not redesign, and I would expect a clean round 2 if the
registration-record semantics come back closed.

---

## Round 2 — 2026-08-03

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent, model
`claude-fable-5`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author Fable session (subagent with no authoring
context) over the working tree at 34bddf62 (v0.2); instructed to read the
revised document in full, audit both round-1 artifacts for actual
resolution in the current text, hunt fix-introduced defects in the new
machinery, and re-verify every load-bearing repo/owner fact against the
tree (all verified accurate — see the review's own verification preamble).
Orchestrated by the authoring session, which does not count as a reviewer;
recorded verbatim below.

---

**Provenance correction (2026-08-03):** the round-2 body below was
appended after Codex round 3 flagged that this artifact had been
truncated at the provenance separator — the orchestrating session had
recorded the header but not the body. The text below is the reviewer's
round-2 final message, verbatim and unedited; the v0.3 revision was
applied from this same text.

---

# LLP 0166 v0.2 — Round 2 review (author-family / Fable)

Reviewed fresh over the worktree at `/Users/ccheever/projects/snapback-0166` (HEAD 34bddf62, v0.2). All repo citations below are worktree-relative. Every load-bearing shipped-code fact restated by v0.2 was re-verified against the tree: `snapback-rqs-store.v1` / `DATABASE_VERSION = 2` / 32 MiB / 256 entries (`packages/snapback-client/rqs-store.mjs:30-43`), the `{rows, meta, token}` byte formula (`rqs-store.mjs:202`), the `resumedAt`-then-`savedAt` comparator with never-resumed-first (`rqs-store.mjs:212-215`), `SNAPBACK_RQS_STORE_LOCK_UNAVAILABLE` (`rqs-store.mjs:251`), `entries`/`outbox` object stores (`rqs-store.mjs:169-172`), `snapback-rqs-store-file.v2` (`packages/snapback-client/rqs-store-file.mjs:75`), outbox caps 1,024/4,096 (`packages/snapback-client/outbox-shared.mjs:23-25`), `persistResume = true` default and `pendingIntentsAtSeed` (`packages/snapback-client/index.mjs:7213,7537`), `routes.manifest.json` (`packages/snapback-codegen/authoring-validation.test.mjs:862`), the LLP 0157 closed retention unions (`llp/0157-...spec.md:322-324,342`), the LLP 0157 golden/near-miss vectors (`llp/0157:625`), the 0043 M1 conditions and LLP 0157/LLP 0162 boundary sections (`llp/0043:110-163,536-572`), the 0080 no-anonymous-retention rule and dated note (`llp/0080:373-396`), the 0090 D3 outbox-rendering note and indefinite-offline rule (`llp/0090:742-788`), and DK-9 plus its dated note (`llp/0008:458-521`). All accurate.

## 1. Overall assessment

**NOT READY — confidence 0.78.** This is a genuinely strong revision: all nine Codex BLOCKING findings are structurally repaired (the LLP 0157 classification amendment with a correct rotation crosswalk, a coherent closed `result-transform.v1` model, a closed registration record with a per-axis merge lattice, a real multi-tab broker, a total two-axis lifecycle, an executable 15-row answer table, fresh-sync-only lease convergence, canonical budget formulas with a deterministic tie-break), and every owner-document fact I checked is now cited correctly. What keeps it out of READY is one residual instance of a round-1 BLOCKING and two fix-introduced exactness defects in the new machinery: the §D5 legacy grandfathering (the Codex-7 repair) directly contradicts §D2's sync-set rule, Guardrail 1, and oracle S1 as written — S1 and S4 cannot both pass on a store containing grandfathered legacy entries — so the "declared unchanged and normatively changed" defect survives in narrower form; the gated evaluation profile silently pulls optimistic-overlay-over-retained-base behind per-plan reclassification (which rotates plan identity) without stating that consequence or the boundary against the ungated 0107/0114 layer surface; and the release-grace lattice is ambiguous at exactly the point S3 tests. All three are one-to-three-sentence repairs, not redesign — this is a convergence round away from READY, not a structural round.

## 2. Round-1 resolution audit

| Finding | Verdict | Note |
| --- | --- | --- |
| Codex-1 (B, 0157-unrepresentable class) | resolved | dated 0157 amendment carried (§D7), acceptance path names it, §D3 cond. 2 names the class, crosswalk covers rotation |
| Codex-2 (B, evaluation semantics) | resolved | closed `result-transform.v1`; changed-args, no-witness-digest, closed refusals; residue is new concern 2 |
| Codex-3 (B, registration record) | resolved | identity, ownerContext, per-source durability, merge lattice, scope serialization, custody all closed; residue is NIT 8 |
| Codex-4 (B, multi-tab) | resolved | writer ledger, liveness reaping, forwarding, handoff window, S1 two-tab legs |
| Codex-5 (B, lifecycle not total) | resolved | orthogonal axes, total precedence, retiring/retired per 0157, qmk1 grace-vs-guardrail fixed |
| Codex-6 (B, no answer matrix) | resolved | 15-row closed table, `refused` restored per 0157, legacy-lease row assigned; residue is NIT 6 |
| Codex-7 (B, legacy lifecycle contradicted) | **partial** | the 0090 contradiction itself is fixed (shipped comparator, no TTL, no 0090 amendment), but the grandfathering now contradicts §D2/Guardrail 1/S1 — see new concern 1 |
| Codex-8 (B, lease migration atomicity) | resolved | fresh-sync-then-fenced-retirement only; atomic arm declared not exercisable; S5 rewritten; OQ5 |
| Codex-9 (B, budget determinism) | resolved | canonical formulas, address-byte tie-break, values marked provisional under OQ4 |
| Codex-10 (M, wipe scope) | resolved | §D1 exact scope; client-wide vs grant/query; strand rules; S7 grant leg |
| Codex-11 (M, P8 conflation) | resolved | split verified against `llp/0043:549-572`; "Move 2 does not depend" stated |
| Codex-12 (M, P9 overstated) | resolved | reclassified partial; OQ11 |
| Fable-1 (M, class unbindable) | resolved | same repair as Codex-1 |
| Fable-2 (M, registration cross-fields) | resolved | `priorityClass` deleted, priority derived, lattice closed, lease-family exclusion explicit |
| Fable-3 (M, multi-tab) | resolved | broker + S1 legs |
| Fable-4 (M, 0157 §Migration tension) | resolved | explicit reconciliation sentence, rides the dated boundary note |
| Fable-5 (M, OQ1 anonymous retention) | resolved | precondition in §D3 and OQ1 |
| Fable-6 (M, outbox-cap attribution) | resolved | re-cited as shipped constants under 0043's posture |
| Fable-7 (M, wipe survivals/handle key) | resolved | allocator + high-waters survive, handle key rotates |
| Fable-8 (N, persist:false wording) | resolved | exact requested wording |
| Fable-9 (N, S2 table) | resolved | table exists; S2 executes it |
| Fable-10 (N, concurrency bound / §D8 parenthetical) | resolved | dated-amendable; amendments named exactly |
| Fable-11 (N, grace anchor) | resolved | release-anchored, explicit |

## 3. New concerns

1. **MATERIAL — grandfathered legacy entries contradict the sync-set rule, Guardrail 1, and S1.** §D2 includes the legacy-resume family in the v1 registration set and rules "nothing unregistered is retained beyond grace"; Guardrail 1 repeats it document-wide; S1's oracle asserts "the hydrated and retained set equals the registration set plus in-grace releases at every step". But §D5's grandfathering — correctly added to resolve Codex-7 — gives legacy entries "no release grace, no 14-day TTL" under LLP 0090's indefinite rule, and S4 asserts "legacy entries never acquire grace, TTL, or demand semantics". The shipped store's normal steady state — an entry persisted by a since-ended subscription (`persistResume` default true, no TTL in `rqs-store.mjs`) — is unregistered, not in grace, and retained indefinitely. §D2/Guardrail/S1 require it GC'd after grace; §D5/S4 forbid that. S1 and S4 cannot both pass on any store containing grandfathered content, and an implementer must guess which rule governs. **Resolve:** scope §D2's retention/grace clause, Guardrail 1's middle clause, and S1's equality to the `qmk1` family (or "governed families"), and name "grandfathered legacy entry under LLP 0090's lifecycle" as the nameable retaining reason so the inspection obligation stays total.

2. **MATERIAL — the gated profile silently captures optimistic-overlay-over-retained-base, and the adoption cost is unstated.** §D7's closed operator set includes "optimistic-overlay application … recomputed over the retained base", and the contract admits a plan "only by carrying the `fragment-evaluated-snapshot-v1` retention class". Under the current-law paragraph (opaque decode only), that composition is the *only* path to rendering optimistic layers over retained fragments — so any future optimistic-over-retained UX (the Move 3/4 direction) requires per-plan reclassification, which by this Spec's own crosswalk rotates `NodePlanHashV1` → `PlanHashV1` → `QueryMaterializationKeyV1` and forces fresh establishment at a new address. That is a heavy, correct-but-nowhere-stated consequence; alternatively, if overlay application was not meant to be class-gated, the operator set contradicts the admission rule. The shipped behavior (retained render is PRE-intent, no overlay — `llp/0090:742-762`) is consistent with the gate, so the text is coherent; the boundary and the cost are what's missing. **Resolve:** one §D7 sentence drawing the boundary (overlay application over live/current in-memory results remains the 0107/0114 owners' ungated surface; overlay recomputation over a *retained* base is inside this gate) and naming the reclassification-rotates-identity adoption cost — or remove overlay application from the gated operator set with an explicit rationale.

3. **MATERIAL — the release-grace lattice is ambiguous at exactly the point S3 tests.** "The governing `idleTtlClass` is the maximum the releasing registrations held" does not pin the evaluation set: the registrations live immediately before the final release, or every registration that released since the address was last demanded? (Address holds A=`pinned`, B=`default`; A releases at t0, B at t1 — the two readings give "exempt from GC forever" vs "14 days".) And the `pinned` arm's parenthetical "(held until explicitly unregistered)" describes a registration that has, by definition, just been unregistered — the actual end state (released-`pinned` records are immortal against background GC yet first in line under pressure as `undemanded` step 1) must be reverse-engineered from three sentences. Divergent implementations produce different S3/carrier-parity outcomes, against the Spec's own identical-on-every-carrier bar. **Resolve:** pin the evaluation set (e.g., the merge in force immediately before the final release) and restate `pinned`'s post-release meaning in one direct sentence.

4. **NIT — `wipe` "clears … all three families' sections in this domain" is internally contradictory:** the legacy lease family has no section in this domain — §D1's composition table lists none and the lease store is "deliberately not absorbed in v1." Say "both resident families' sections plus the outbox," and note the lease artifact is cleared by its own owner as an LLP 0059 coordinator participant (per 0157 op 7).

5. **NIT — the handoff-deferral scope is worded differently in §D2 and §D5.** §D2 defers "eviction of `undemanded` records" then states over-budget commits "refuse instead of evicting"; §D5 says "step 1 is deferred and over-budget commits refuse instead." The full-refusal reading (no pressure eviction of any step during the window) is the safe one — a record that is really `demanded-active` but not yet re-announced, while holding a `programmatic` registration, presents as `demanded-idle` and would be exposed to step-2/3 eviction under the partial reading. State the full-refusal rule once, explicitly.

6. **NIT — answer-table rows 11 and 15 put "no render" in the answer/freshness column** instead of a closed class (`unknown`); S2 executes this table, so every row's answer cell should be total over the closed class set.

7. **NIT — the eviction algebra is total only for materialization commits.** §D5 gives materialization commits a cross-section order into the legacy section (after steps 1-2), but a legacy commit "evicts within the legacy section" with no stated branch for exhaustion — the derivable reading (evict-within-legacy, then refuse per §D3; never reclaim `qmk1` records) should be one explicit sentence, since it also implies legacy commits can starve behind undemanded `qmk1` bytes.

8. **NIT — `source` × `ownerContext.kind` coupling is unstated.** The producers table implies `active`↔`subscription`, `preload`↔`route`, `programmatic`↔`api`, but `QueryRegistrationV1`'s refusal rules cover only unknown fields and out-of-set values, not cross-field mismatches (`source:"programmatic"` with `ownerContext:{kind:"subscription"}`). One validity sentence.

9. **NIT — §D6's lease-convergence sentence shifts the owners' non-renderability window while claiming to restate it.** LLP 0043's boundary note and LLP 0157 §Migration have the non-adoptable record "coexist[ing] non-renderably **until** fresh sync creates the new address, then retires"; 0166 keeps it renderable under M1 (answer row 14) until the fresh sync lands, going non-renderable **once** the new address establishes. Defensible — v1 attempts no adoption, so no record enters the migration-pending state — but the dated LLP 0043 boundary note at acceptance should pin the window explicitly so the three texts don't read as conflicting.

## 4. Suggestions

- Name who supplies `result-transform.v1` programs (the LLP 0051 widget-refresh/hook seam; Move 3 consumers), or fold the transform authoring surface into OQ8 — the model is closed but its invoker is implied only.
- Pair concern 1's fix with an S1 variant run against a store pre-populated with grandfathered legacy entries, asserting they are excluded from the sync-set equality while remaining inspectable with their grandfathering reason.
- State explicitly that the legacy section's address-byte tie-break composes *after* the shipped comparator (S3 implies it; §D5's "byte-unchanged" invites the opposite reading for exact-timestamp ties).
- §D2's honest-degradation bullet covers the non-writer side only; add the writer's obligation when the cross-context channel is down but the lock is held (ledger treats unreachable contexts as reaped after the liveness rule, not silently live).
- In the LLP 0157 amendment text, consider stating that the served-manifest/codegen producers emit the new value only for owner-reclassified plans — the crosswalk implies it; one clause would close Codex-1's original "manifest/codegen mapping" ask completely.

## 5. Recommended next step

Keep Draft; apply the three MATERIAL repairs — concern 1 (scope §D2/Guardrail 1/S1 to governed families and name the grandfathered retaining reason: this also finishes Codex-7), concern 2 (one boundary-and-cost sentence in §D7), concern 3 (pin the grace-lattice evaluation set and restate `pinned` post-release) — plus whichever NITs are cheap in the same pass, then run round 3 as a focused delta review of §D2's rule/Guardrails/S1, §D5's grace-and-eviction text, and §D7's operator-set paragraph rather than another full-document round. Nothing here reopens the amendment set, the broker, the answer table, or the §D1 physical answer; with concern 1 closed I would expect round 3 to converge READY.

---

## Round 3 — 2026-08-03

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent, model
`claude-fable-5`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author Fable session (subagent with no authoring
context) over the working tree at 5bfcf869 (v0.3); focused round auditing
round-2 resolution and probing the round-2 repairs, with owner/repo
spot-checks (its own preamble lists them; all verified). Note: this
reviewer ran against the tree state in which the round-2 Fable artifact
body was still truncated (restored at 46127881 while this round was in
flight); its concern 1 records that state and is resolved by the
restoration. Orchestrated by the authoring session, which does not count
as a reviewer; recorded verbatim below.

---

1. **Overall assessment**: **NOT READY — confidence 0.85.** V0.3 is a genuine, verifiable repair of round 2, not a cosmetic one: all ten Codex round-2 findings resolve in the current text, and every load-bearing owner/repo fact I checked is accurate against the tree (`snapback-rqs-store.v1` / `DATABASE_VERSION = 2` / 32 MiB / 256 / the `resumedAt`-then-`savedAt` comparator / `rqsEntryRecordBytes` `{rows, meta, token}` at `packages/snapback-client/rqs-store.mjs:30-43,199-215`; `SNAPBACK_RQS_STORE_LOCK_UNAVAILABLE` at `:251` vs DK-9's spelling at `llp/0008…rfc.md:503`; outbox 1,024 / 256 KiB / 4,096 at `packages/snapback-client/outbox-shared.mjs:23-25`; `snapback-rqs-store-file.v2`, corrupt-bytes-preserved, and the SQLite-swap comment in `rqs-store-file.mjs`; LLP 0053's per-`client_store_id` namespace and compaction-surviving store-wide allocator at `llp/0053…rfc.md:923,959,971,1583-1591`; LLP 0043's non-renderable-until-fresh-sync boundary order at `llp/0043…rfc.md:536-547`; LLP 0157 op 1 "allocates **or loads**" and op 7's LLP 0039/0053 barrier participants; LLP 0090's "v1 persists no auth-scoped RQS resume state", the `persist` opt-out design at `:777`, and the 2026-08-01 retained-render note; `persistResume = true` at `packages/snapback-client/index.mjs:7213`; LLP 0145 §F2's 16.5/7.8/6.7 kB rows). What keeps it out of READY is one process defect and three new MATERIAL text defects: the Fable round-2 review artifact has no body, so its 3 MATERIAL findings are unauditable; the grace-lattice repair contradicts its own S3 oracle; the `retentionRequest` repair is unpinned through release grace, formally contradicting §D5's grace custody at the most common lifecycle state; and the broker's one-partition-per-context announce cannot express the multi-grant tenants §D1 itself names. All four are cheap, targeted fixes; none challenges the architecture, the §D1 physical answer, or any owner boundary.

2. **Round-2 resolution audit**

| Finding | Status | Notes |
| --- | --- | --- |
| Codex r2-1 (B, transform algebra) | **resolved** | Closed `TransformPlanV1`, fixed total pipeline (base → overlay → filter → order → limit), projected-field-only ordering, output encoding, closed refusals; parity target is a dual-runtime reference of the *transform*, never the LLP 0080 source-row pipeline. Edge residues are NIT-grade (N8). |
| Codex r2-2 (B, `retentionRequest` opt-out) | **resolved** | Now §D3 necessary condition 3 with a defined demanded-case downgrade. A new adjacent gap at the *grace* state is N3 (fix-introduced, reported separately). |
| Codex r2-3 (B, broker protocol) | **resolved** | Closed message records, monotone revisions, heartbeat/reap, authority/fence binding, forward-ack idempotency, full handoff suppression, per-carrier qualification with honest file-carrier degradation. Residues N4/N6/N7. |
| Codex r2-4 (B, eviction removes+preserves) | **resolved** | Payload-compaction split preserves identity/`QueryAuthorizationState`/registrations exactly as LLP 0053 §GC requires (verified); same-instance rehydration is expressible via 0157 op 1's load path and the §D3 transition table. |
| Codex r2-5 (B, convergence order) | **resolved** | Close-predecessor-first now matches LLP 0043's boundary-note order word-for-word; crash cuts are monotone and each cut is detectable from the durable migration-closed disposition; the permanent-data-gap outcome is 0043's own posture. |
| Codex r2-6 (B, `wipe` topology) | **resolved** | Atomic claim limited to resident sections; the lease artifact is a separate LLP 0059 barrier participant (consistent with 0157 op 7's participant model); unparseable reset = store-identity rotation, consistent with 0053's per-`client_store_id` allocator scoping. |
| Codex r2-7 (M, legacy envelope) | **resolved** | Budgets partitioned; shipped constants/comparator/byte formula kept byte-exact with **no** added tie-break; no-cross-section rule verified consistent across D3/D5/S3/S4; "no LLP 0090 amendment because no 0090-governed behavior changes" is now true. |
| Codex r2-8 (M, lease answer class) | **resolved** | `lease-authorized-retained` in §Vocabulary and row 14; no LLP 0157 completeness claim. |
| Codex r2-9 (M, accounting) | **resolved** | Payload-only projection, proofs counted once at the storing fragment record, exclusions enumerated and cap-bounded, 512-registration cap, 256 KiB outbox record cap recorded as implementation constants. Byte-bound residue = N5. |
| Codex r2-10 (M, inspection) | **resolved** | `StorePolicyInspectionV1`: versioned, partition-bound, redacted, explicitly additive beside LLP 0157 §D6. |
| Fable r2-1..9 (3 M + 6 N) | **unauditable** | The artifact body is missing (N1). The Revised header's claimed corresponding fixes — row 14 + rows 11/15 `unknown`, governed-families scoping, grace-lattice pin, `StorePolicyInspectionV1`, `source`×`ownerContext` validity, manifest-emission clause, operation-term disambiguation — are all **present in the current text** (each verified), but the findings themselves cannot be checked against their record. |

Round-1 residuals: all seven Fable r1 concerns and all four NITs verify as closed in v0.3 (0157 classification amendment carried with crosswalk; registration record closed; broker; §D6's explicit 0157-§Migration reconciliation; the OQ1 anonymous-retention precondition in §D3/OQ1; outbox caps re-cited as implementation constants; the `wipe` paragraph; `persistResume` stand-in wording; the answer table; dated-amendable concurrency bound and exact §D8 amendment names; release-anchored grace).

3. **New concerns**

1. **MATERIAL — the Fable round-2 review artifact has no body.** Exact defect: `llp/reviews/0166-local-persistent-store.fable.md` ends at line 340 with the Round-2 method preamble and a separator; commit 5bfcf869 added only 21 lines to it (the preamble) versus 84 for the Codex artifact, while the commit message, the Revised header, and §Status all claim both round-2 artifacts are recorded verbatim. Why it matters: LLP 0005's provenance rule and this round's own READY bar ("no unresolved round-2 MATERIAL") are unverifiable for 3 MATERIAL findings, and the document's Status claim is currently false. What resolves it: recover the round-2 Fable review text from the producing session and append it verbatim; if genuinely unrecoverable, record that loss explicitly in the artifact and Status, and note that round 3 re-covered its claimed scope.
2. **MATERIAL — S3's grace-lattice oracle contradicts the D2/D5 pin rule (fix-introduced).** Exact defect: D2 (lines 407-410) and D5 (792-794) pin the ensuing grace class to "the per-axis maximum over the registration set as it stood immediately before that final release." In S3's pin case (lines 1354-1356), A (`pinned`) releases at t0 and B (`default`) at t1; the set immediately before the final release is {B}, whose maximum is `default` — yet S3 requires `pinned`, citing the same rule. Why it matters: the normative rule and its executable oracle give opposite answers; a conformant implementation fails S3 and vice versa. What resolves it: pick one semantics — episode-maximum (max over every registration live at any point since the address last became demanded; rewrite D2/D5) or last-snapshot (correct S3's expected class to `default`).
3. **MATERIAL — effective `retentionRequest` is unpinned through release grace, so §D3's persistence predicate contradicts §D5's grace custody.** Exact defect: D2's lattice evaluates "over the currently live registrations"; with zero live registrations the `retentionRequest` maximum is `"none"`, so every graced record fails §D3 condition 3 while satisfying condition 4 — under the strict reading its payload must be reclaimed at the next maintenance pass, making release grace (and `pinned`'s post-release exemption) vacuous. The pin-at-release sentence covers only `idleTtlClass`, and the D2 downgrade transition covers only the "still demanded" case. Why it matters: the two normative sections give opposite outcomes at the exact state the grace feature exists for; this is the same defect class as round-2's C2-2, introduced by its own repair. What resolves it: pin `retentionRequest` at final release exactly as the grace class is pinned (grace preserves the pre-release effective policy on both axes), and add an S1/S3 leg asserting a durable-requested record's payload survives release into grace.
4. **MATERIAL — the broker cannot express a multi-partition context's demands.** Exact defect: `DemandAnnounceV1` carries one `authorityPartitionDigest`, the ledger keys full-set replacement by `contextId`, and "a demand naming an address outside that partition refuses." §D1's own scoping treats each grant as an authority partition and names LLP 0055 multi-grant agent clients as tenants of this store; a non-writer multi-grant context therefore cannot keep addresses in a second partition demanded — they drift `undemanded` and become compactable while rendered. Why it matters: this is a closed protocol an implementer cannot extend without guessing, and the failure mode is silent eviction exposure for a client class the Spec itself supports; blast radius is narrow (single-process agent writers bypass the broker; the file carrier already degrades honestly), but browser-carrier qualification makes the protocol normative. What resolves it: either state the one-partition-per-context invariant and why it holds for every broker-riding context, or scope announces by `(contextId, partition)` with full-set replacement per pair.
5. **NIT — durable registrations are count-capped but byte-unbounded.** `canonicalArgs` and the byte-preserved `functionReference` persist in `storeMeta` outside every byte budget; 512 × unbounded is not "total accounting." Adopt an outbox-style per-registration byte ceiling with refuse-at-cap.
6. **NIT — liveness closure edges.** State that any well-formed announce refreshes the heartbeat even when its revision is ignored as duplicate/lower; qualify "empty keep-alive announce" (an empty set at a higher revision *releases everything* — a keep-alive for a context with demands is a same-set re-announce); reword "at most every 15 seconds" to interval-at-most-15-seconds.
7. **NIT — the handoff early-exit condition is undecidable.** "Every previously known live context re-announces" requires a prior-context roster the store is never required to persist; implementations degenerate to the 30-second window. Persist the roster in `storeMeta` or define reconciliation as window-only.
8. **NIT — `TransformPlanV1` closure edges.** Order direction is unstated (ascending implied, never said); `limit`'s domain is unconstrained (require a non-negative integer or refuse); and "LLP 0051 canonical scalar ordering" actually pins string Unicode-scalar order and numeric normalization, not null/absent placement or cross-type comparison — state that the conformance corpus pins those and that non-scalar or mixed-type order-field values refuse (cheap: LLP 0080 v1 projects only schema-typed scalar leaves).
9. **NIT — S1's equality sentence needs the per-family split the Vocabulary already implies.** For the legacy-resume family only hydration is governed, so a released legacy registration's entry legitimately persists under LLP 0090's lifecycle (as a grandfathered entry) outside the equality; S1 currently reads as if the registered-equals-retained equality covers both governed families symmetrically.

4. **Suggestions** (non-blocking)

- Name durable-registration destruction explicitly in §D1's `wipe` "what it clears" list (currently derivable only from §D2's "store reset" release clause).
- State what the compacted stub does with `productState.heldProofs` references — cleared with the stored proofs, or explicitly dangle-safe — so the "product-state skeleton" is exact.
- Give the four broker message records the same unknown-field/closed-set refusal sentence `QueryRegistrationV1` has.
- Anchor grace clocks for releases occurring during handoff suppression (start at suppression end) with one clause.
- Say who consumes `TransformHashV1` (corpus fixture identity / inspection), so the definition is not an orphan.
- S5 could add an unparseable-store-during-migration leg: a corrupt store encountered mid-migration takes the identity-rotation path, never a partial migrate.

5. **Recommended next step**

Repair in this order: restore the Fable round-2 artifact body (concern 1) so the loop's record is whole; then apply concerns 2-4 — each is a one-to-three-sentence normative fix plus one oracle leg (pick the grace-pin semantics and make D2/D5/S3 agree; pin `retentionRequest` through grace; state or widen the broker's partition scoping). Fold the NITs at author discretion. Because every Codex round-2 finding verifies as resolved and the remaining defects are narrow residues of the round-2 repairs, a targeted round-4 **delta** review scoped to §D2 (lattice + broker), §D3 condition 3, §D5 grace, and S1/S3 — rather than another full pass — should suffice; on dual-family READY the LLP 0130 SD-4 standing rule applies within this commission's scope.

---

## Round 4 — 2026-08-03

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent, model
`claude-fable-5`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author Fable session (subagent with no authoring
context) over the working tree at 048a1852 (v0.4); focused delta round
auditing round-3 resolution and probing the changed text, with owner
spot-checks (its preamble lists them; all verified by the reviewer).
Orchestrated by the authoring session, which does not count as a
reviewer; recorded verbatim below.

---

1. **Overall assessment**: **NOT READY — confidence 0.85.** V0.4 is a genuine and near-complete application of round 3: every structural repair landed as described, and every owner fact I spot-checked verifies against the tree — LLP 0053's terminal retirement is exactly the transition §D6 now uses (`active → retiring` is durable, crash-recoverable, and rejects every render/materialization/frame input, `llp/0053-authorization-invalidation.rfc.md:1062-1087`; LLP 0157's event table carries the same begin/finalize rows at `llp/0157-composition-algebra-and-completeness.spec.md:1010-1011`); the carried LLP 0155 amendment quotes §Query execution's commissioned sentences verbatim (`llp/0155-local-sync-product-direction.rfc.md:695-700`) and defers source-row evaluation behind the OQ2 gate that actually owns the projection-aware authority design (`:1356-1362`); the compacted-stub same-instance claim is expressible through LLP 0157 op 1's "allocates **or loads**" path (`:1376-1377`) with no §D3 event forcing a new instance short of retirement; the class rename is complete (no stale `fragment-evaluated-snapshot-v1` anywhere); and the restored Fable round-2 body is present verbatim with its dated provenance-correction note (46127881). What keeps this round out of READY is two narrow, fix-introduced MATERIAL consistency defects of exactly the class rounds 2–3 caught: the new blocker-held custody state is absent from the document's own retaining-reason law (§D2's rule sentence, the Vocabulary sync-set entry, and Guardrail 1 are false as written against §D3's mechanism), and S6's "mixed-type refuse" leg contradicts §D7's now-total type-rank comparator while the filter operators' comparison semantics remain unbound. Both are one-to-three-sentence repairs; nothing touches the architecture, the amendment set, the broker, or any owner boundary.

2. **Round-3 resolution audit**

| Finding | Status | Explanation (partial/unresolved only) |
| --- | --- | --- |
| Codex B1 (0155 commission narrowing) | resolved | |
| Codex B2 (TransformPlanV1 totality / overlay parity) | partial | The grammar, per-field direction, total order comparator, limit domain, row-sequence restriction, and the overlay parity split all landed. Residue in B2's own scope: the filter step never states which comparator `lt`/`lte`/`gt`/`gte` use or what a cross-type filter comparison does, and the new S6 leg contradicts the order comparator — see concern 2. |
| Codex B3 (broker lifecycle) | resolved | Residues are NIT-grade (concerns 3, 4). |
| Codex B4 (retention/grace/blocker totality) | resolved | The asked-for machinery (both axes pinned last-snapshot, grace as an explicit condition-3 leg, blocker-held custody with inspection reason and discharge transition) is all present; the stale reason enumerations around it are a new defect, tracked as concern 1, not as B4 unresolved. |
| Codex B5 (migration-closed → terminal-retirement-begins) | resolved | Verified ownable: 0053's retirement steps 1–2 give durable non-renderability at begin time; crash cuts hold as stated; S5 updated. |
| Codex M6 (wipe storeMeta projection) | resolved | |
| Codex M7 (D3 scoping vs legacy) | resolved | |
| Codex M8 / Fable M1 (artifact restoration) | resolved | |
| Fable M2 (grace pin vs S3) | resolved | Last-snapshot adopted; S3's first case corrected to `default`, converse case added; D2/D5/S3 agree. |
| Fable M3 (retentionRequest through grace) | resolved | |
| Fable M4 (broker multi-partition) | resolved | |
| Fable N5 (registration byte cap) | resolved | |
| Fable N6 (liveness closure edges) | resolved | |
| Fable N7 (handoff roster) | resolved | |
| Fable N8 (transform closure edges) | partial | Direction, limit domain, and type-rank/non-scalar rules landed; the suggested "mixed-type refuse" wording survived into S6 against the comparator the author actually chose — same residue as B2, concern 2. |
| Fable N9 (S1 per-family split) | resolved | |
| Fable suggestions ×6 | resolved | All six adopted (wipe clears durable registrations; stub clears `heldProofs`; broker closed-record refusals; suppression-end grace anchor; `TransformHashV1` consumers; S5 corrupt-mid-migration leg). |
| Codex suggestions ×4 | resolved | Class renamed; broker crash/idempotency legs in S1; blocker trace in S3; the converged repairs left unchanged. |

3. **New concerns**

1. **MATERIAL — blocker-held custody is missing from the document's retaining-reason law.** §D3 defines blocker-held custody (`retainingReason: safety-blocker`, `llp/0166-local-persistent-store.spec.md:689-694`) and the inspection union models it (`:1009-1010`), and the state is reachable with zero registrations and no running grace (predicate condition 4 fails while pending intent holds the payload — the ordinary offline-pending-mutation case). But §D2's rule sentence still says the inspection names "the **one** non-registration reason, 'grandfathered legacy entry…'" (`:383-385`), the Vocabulary sync-set entry says released records outlive the sync set "**only** inside §D5's grace" (`:213-215`), Guardrail 1 enumerates exactly three nameable reasons — registration, running grace, grandfathered-legacy (`:1441-1443`) — and S1's qmk1 equality ("the hydrated-and-retained set equals the registration set plus in-grace releases at every step," `:1483-1485`) admits no blocker-held carve-out. A conforming store holding a safety-blocker payload violates Guardrail 1 and §D2 as written. Fix: add `safety-blocker` to both reason enumerations (or point them at §D5's closed `retainingReason` union), qualify the Vocabulary sentence, and scope S1's equality "plus blocker-held records named by inspection."

2. **MATERIAL — S6's "mixed-type refuse" contradicts §D7's total comparator, and filter comparisons are unbound.** §D7 step 4 defines one **total** scalar comparator in which mixed scalar types order by type rank (`null < boolean < number < string`); the only ordering refusal is a non-scalar value (`:1200-1207`). S6 nevertheless requires the corpus to exercise "the type-rank comparator (null/boolean/number/string, **mixed-type refuse**)" (`:1566-1568`) — under the normative rule, mixed types order, they do not refuse. And step 3 ("the conjunction of the `basic-v1` comparisons," `:1198-1199`) never states which relation `lt`/`lte`/`gt`/`gte` use: the step-4 total comparator, numeric/same-type-only with refusal, or false-on-mismatch. Two implementations can diverge on `{op:"lt", value: 5}` against a string-valued field while each claims conformance, and the corpus leg cannot be authored without deciding for the spec. Fix: bind the filter ordering operators to the step-4 comparator (and `eq`/`ne`/`in` to canonical-value equality), or define cross-type filter comparisons as refusals — then correct S6's parenthetical to match the choice.

3. **NIT — `RegisterReleaseV1` is partition-unbound where `RegisterForwardV1` is partition-validated.** Forward carries `authorityPartitionDigest` and the writer validates address-in-partition; release carries only `registrationId` (`:522-527`). State whether release validates the releasing context's partition against the registration's address, or record that release is deliberately partition-unbound (inspection redaction already withholds cross-partition ids, so the exposure is narrow — but the asymmetry should be on the record).

4. **NIT — refusal granularity is inconsistent across the broker rules.** A non-`active` source in `demands` "refuse[s] the message" (`:539-542`) while a cross-partition demand "refuses the entry" (`:561-562`). Entry-level refusal lets a malformed full-set replace half-apply at an advanced revision. Pin one granularity — message-level is the revision-coherent choice.

5. **NIT — blocker-discharge compaction timing is stated two ways.** §D3 says blocker-held custody "ends the moment the blockers discharge, whereupon compaction runs" and S3 tests "compacts exactly at blocker discharge" (`:692-694`, `:1536-1539`), but the equivalent §D2 downgrade path reclaims "at the next writer maintenance pass" (`:463-465`). Pin whether discharge-time compaction is synchronous with the discharging commit or lands at the next pass, and align S3's expectation.

6. **NIT — `writerGeneration`'s `wipe` treatment is unstated.** §D1's storeMeta projection clears registrations, policy/budget facts, and the roster while preserving named high-waters (`:346-359`); the monotone-per-store `writerGeneration` is in neither list. Monotone counters belong with the preserved high-waters.

4. **Suggestions** (non-blocking)

- Make §D5's `retainingReason` union the single source of truth for the reason vocabulary and have §D2/Guardrail 1 cite it rather than re-enumerate — this is the second round in a row an enumeration went stale against the mechanism.
- One §D7 sentence naming all three comparison families explicitly (canonical-value equality for `eq`/`ne`/`in`; the total comparator for order and — per the concern-2 decision — range filters; refusal for non-scalars) would close the whole comparator surface.
- Once concern 3 is decided, add the release-partition probe to S1's broker legs.
- §D6 could note that convergence step (1) is initiated only under a connected convergence attempt, since the acknowledged data-gap window otherwise spans arbitrary offline periods — product-cost clarity, not a correctness defect.

5. **Recommended next step**

Apply the two MATERIAL repairs — concern 1 (add safety-blocker to the §D2/Vocabulary/Guardrail-1 reason law and qualify S1's equality) and concern 2 (bind the filter comparison semantics and correct S6's parenthetical) — plus whichever NITs are cheap in the same pass. Both MATERIALs are localized consistency fixes with no architectural reach, so a **micro-delta round 5** scoped to exactly: §D2's rule paragraph, Vocabulary/Guardrail 1, S1's equality sentence, §D7 steps 3–4, and S6 — rather than another full delta — is proportionate. If both families verify those spot repairs clean, this document is at the READY bar; nothing else in v0.4 stands between it and convergence.

---

## Round 5 — 2026-08-03

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent, model
`claude-fable-5`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author Fable session (subagent with no authoring
context) over the working tree at 9ebfa344 (v0.5); micro-delta round
auditing round-4 resolution and probing the v0.5-changed text, with owner
spot-checks (LLP 0053 strand rules, LLP 0157 §D3 closed vocabulary — both
verified by the reviewer). Orchestrated by the authoring session, which
does not count as a reviewer; recorded verbatim below.

---

# LLP 0166 v0.5 — Round 5 review (author-family / Fable)

1. **Overall assessment**: **NOT READY — confidence 0.88.** V0.5 is a genuine, near-complete application of round 4: of the seventeen tracked round-4 findings and suggestion sets, fourteen verify as fully resolved in the current text — including the whole comparator surface (the three comparison families are now bound in §D7 step 3, S6's parenthetical is corrected to type-rank ordering with non-scalar refusal), the §D6 pending-intent precondition with its connected-attempt initiation and S5 leg, the unified retaining-reason law with §D5's union as the cited single source of truth across §Vocabulary/§D2/Guardrail 1/S1, the exact blocker-custody precedence, the de-duplicated pressure order, the payload-compaction event registered in the carried LLP 0157 amendment (I verified LLP 0157 §D3's vocabulary is closed at `llp/0157-composition-algebra-and-completeness.spec.md:988`, so the amendment is the right shape), discharge timing pinned to the next maintenance pass in both §D3 and S3, `writerGeneration` in §D1's survivals, and all eight suggestions. What keeps the round out of READY is three narrow residues of exactly the fix-introduced class this loop keeps catching, each a one-to-three-sentence repair: the broker's no-resurrection guarantee for released registrations outruns the bounded state that must implement it (B1 residue), one stale entry-level refusal sentence survives against the new "message-level everywhere" rule (N4 residue), and the document claims in three places that the provisional constants surface as inspection ceiling fields when the closed `StorePolicyInspectionV1` record has no fields for most of them (M7 residue). Nothing touches the architecture, the amendment set, the answer table, or any owner boundary; the owner facts I newly relied on (LLP 0053's discard-only dependent queue custody and strand rules, `llp/0053-authorization-invalidation.rfc.md:1066,1275,1854`; LLP 0157 §D3's closed event vocabulary) verify against the tree.

2. **Round-4 resolution audit**

| Finding | Status | Explanation (partial/unresolved only) |
| --- | --- | --- |
| Codex B1 (broker durable lifecycle) | partial | The machinery landed whole: `RegisterReleaseV1` carries `authorityPartitionDigest` with identical writer-side validation for forward and release, the fence language is corrected to what registration commits actually touch (the `storeMeta`-not-payload parenthetical is coherent), the reaped-context memory (256) and consumed-request memory (1,024) persist across restart, and release is idempotent. Residue: the flat guarantee that a fresh forward naming a released `registrationId` refuses — and the header's "delayed announces and forwards cannot resurrect … released registrations" — is not implementable beyond the 1,024-outcome window from any state the spec defines. See concern 1. |
| Codex B2 (filter semantics + S6 contradiction) | resolved | |
| Codex B3 (retirement vs pending-intent) | resolved | Precondition, refuse-and-wait with settlement/explicit-discard per the owner's strand rules, connected-attempt initiation, and the S5 pending-intent leg all present and owner-consistent. |
| Codex M4 (blocker custody vs reason law + precedence) | resolved | |
| Codex M5 (pressure order pinned duplication) | resolved | Step 1 excludes `pinned`; S3 aligned. |
| Codex M6 (compaction vs LLP 0157 closed vocabulary) | resolved | The carried amendment registers the payload-compaction event with the correct preserved/discarded split; "no other semantics change" is now true of the amendment. |
| Codex M7 (roster/accounting bounds + 16 KiB formula) | partial | The 64-live-context ceiling with refuse-and-run-volatile, the JCS byte formula, and the prose accounting closure all landed. Residue: the reaped-context (256) and consumed-request (1,024) ceilings — and the 16 KiB per-registration ceiling — have no fields in the closed inspection record, though the Revised header, §D5, and OQ4 claim the constants surface there. See concern 3. |
| Codex suggestions ×4 | resolved | `effectiveRetentionRequest` field; envelope-`contextId` equality in the refusal list; `addressKey` rename; every listed broker fixture case is an S1 leg. |
| Fable M1 (reason-law unification) | resolved | |
| Fable M2 (S6 contradiction + filter binding) | resolved | |
| Fable N3 (release partition binding) | resolved | Including the suggested S1 cross-partition-release probe. |
| Fable N4 (refusal granularity) | partial | The normative sentence ("message-level everywhere," revision not consumed, no partial set) landed at `llp/0166-local-persistent-store.spec.md:582-588`, but the full-set-announce bullet still ends "a cross-partition demand refuses the entry" (`:613`) — a direct contradiction. See concern 2. |
| Fable N5 (discharge timing) | resolved | |
| Fable N6 (writerGeneration at wipe) | resolved | |
| Fable suggestions ×4 | resolved | Single-source-of-truth note; the one-sentence three-family comparator binding; the S1 release probe; the §D6 connected-attempt note. |

3. **New concerns**

1. **MATERIAL — the released-registration no-resurrection guarantee outruns the persisted state.** §D2 states flatly that "a *fresh* forward naming a released `registrationId` refuses" (`llp/0166-local-persistent-store.spec.md:641-645`) and the Revised header promises delayed forwards "cannot resurrect … released registrations" (`:18-19`). Implementing that refusal requires the writer to remember which `registrationId`s were released; the only defined state is the consumed-request memory, bounded at the last 1,024 outcomes. A duplicate forward delayed past that window — or any forward naming a long-released id — is indistinguishable from a legitimate first-time forward and would commit, resurrecting a released durable registration that then persists and re-hydrates payload until explicitly released. The parallel reaped-context bullet honestly analyzes its overflow ("a bounded, self-healing window," `:600-603`); the consumed-request memory gets no such analysis, and its failure mode is *not* self-healing — nothing lapses a resurrected durable registration. An unbounded released-id set is not an out: §D3's total accounting bounds `storeMeta` by exactly the named caps. Fix (sentence-scale): either add a bounded released-registration memory with the same overflow honesty, or scope the refusal guarantee to the consumed-request window and record the residual hazard the way the reaped-context bullet does.

2. **MATERIAL — §D2 contradicts its own refusal-granularity rule.** The granularity paragraph says a cross-partition demand "refuse[s] the whole message — its revision is not consumed, and no partial set applies" (`:582-588`); the full-set-announce bullet says "a cross-partition demand refuses the entry" (`:611-613`). Both cannot hold. Two conforming writers diverge on the same announce — one applies the set minus the bad entry at the advanced revision, the other applies nothing and leaves the revision unconsumed — which is demand-state divergence with compaction-exposure consequences, the exact hazard N4 named. Fix: one word — "refuses the entry" → "refuses the whole message" (or delete the trailing clause; the granularity paragraph already covers it).

3. **MATERIAL — the constants-surface-in-inspection claim is false against the closed record.** Three places claim the provisional constants are observable as inspection ceiling fields: the Revised header ("the broker memories get ceilings surfaced in inspection," `:42-44`), §D5 ("The provisional §D2/§D3/§D5 constants surface as this record's ceiling fields," `:1105-1107`), and OQ4 ("they surface in the policy record so revision is observable," `:1773-1774`). The closed `StorePolicyInspectionV1` record (`:1052-1091`) surfaces `byteCeiling`/`recordCeiling`/`fragmentCeiling`, `durableCeiling`, and `liveContextCeiling` only — no fields exist for the 256 reaped-context memory, the 1,024 consumed-request outcomes, the 16 KiB per-registration ceiling, or the grace/heartbeat/handoff/concurrency values OQ4 lists. No behavioral hazard follows (the record is closed, so implementations cannot diverge), but a conforming implementation cannot make those three sentences true, and OQ4's revision-observability promise — the stated justification for shipping provisional values — is broken for most of them. Fix in either direction: add the missing ceiling fields (a `broker.reapedContextMemoryCeiling`/`consumedRequestCeiling` pair and `registrations.perRecordByteCeiling`, plus deciding whether cadence values surface), or narrow all three claim sites to the custody ceilings that actually surface.

4. **NIT — reason-selection precedence is underivable-in-corner-cases.** S8 requires each address to carry exactly one `retainingReason`, but the union does not order itself when several kinds hold at once: a blocker-held payload during a `"none"`-pinned grace (release-grace vs safety-blocker), or a compacted stub still named by a live durable registration (registrations vs instance-bookkeeping — the stub comment "held only for fences/frontiers/registrations" muddies this by naming registrations inside the bookkeeping reason). One sentence pinning the precedence (registrations > safety-blocker > release-grace > instance-bookkeeping, or whatever the author intends) would close it.

5. **NIT — the `in` operand is formally non-scalar.** Step 3 refuses "a **non-scalar** value … in a filter operand," while the record admits `op: "in"` with "a nonempty array of scalars." The intended reading (the array shape is admitted by the record; the element rule governs) is recoverable from context, but one clause — "for `in`, each *element* must be a scalar" — would remove the literal contradiction.

4. **Suggestions** (non-blocking)

- Prefer the additive direction for concern 3 (add the fields) — it keeps OQ4's observability promise intact rather than shrinking it, and S8's ceilings-match-constants leg then covers the broker memories for free.
- If concern 1 takes the windowed-guarantee route, mirror the reaped-context bullet's phrasing so the two memories read as one design pattern; if it takes the released-id-memory route, add the corresponding overflow sentence and an S1 note that the corpus does not exercise overflow (or a synthetic overflow leg).
- The transient between a `"none"`-pinned release and its next-maintenance-pass reclamation could name its inspection reason explicitly (release-grace with an immediate deadline, or a note that the row may briefly show the pre-release reason) — folds into NIT 4's precedence sentence.
- When concern 2's one-word fix lands, S1's broker legs could add the malformed-announce probe (one bad entry ⇒ nothing applies, revision unconsumed) so the granularity choice is oracle-backed, not prose-only.

5. **Recommended next step**

One more micro-delta spot-repair pass: concerns 1–3 are each sentence-scale with no architectural consequence, and NITs 4–5 are optional single clauses. Then a round-6 delta round confined to those edits should be able to return dual READY — the round-4 machinery is otherwise fully and faithfully landed, and I found no defect in the v0.5-changed text beyond the three residues above.

---

## Round 6 — 2026-08-03 (no review received)

The round-6 Fable review run over ac606e5c (v0.6) was interrupted before
producing any assessment; per LLP 0005, no review is recorded and none is
counted. The Fable family's next actual review is Round 7.

---

## Round 7 — 2026-08-03

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent, model
`claude-fable-5`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author Fable session (subagent with no authoring
context) over the working tree at b58b3c5f (v0.7); micro-delta round
confined to the round-6 repairs, plus re-verification of the Fable
round-5 findings across the intervening revisions. Orchestrated by the
authoring session, which does not count as a reviewer; recorded verbatim
below.

---

All verification is complete. Here is my round-7 review.

---

# LLP 0166 v0.7 — Round 7 review (Fable family)

**Reviewer:** fresh non-author Fable session over the worktree at `/Users/ccheever/projects/snapback-0166`; micro-delta round confined to the round-6 repairs, plus re-verification of the Fable round-5 findings. Owner facts: the v0.7-changed text relies on no owner fact not already verified in prior rounds (the tombstone/pair machinery is document-internal; the multi-grant multi-partition premise and the LLP 0043/0053/0157 boundaries are unchanged from v0.6); no new spot-checks were required.

1. **Overall assessment**: **READY — confidence 0.87.** V0.7 is a complete and correct application of Codex round 6. The overflow analysis is now the true one — the release-before-first-forward residue is stated as depending only on tombstone eviction, with the two-memory condition correctly confined to replay of a previously consumed forward, and S1 no longer repeats the false bound and instead exercises the exact 1,024/1,025 boundaries; tombstones are keyed `(authorityPartitionDigest, registrationId)`, created only atomically with a successful `released` outcome (refused releases leave none), release-of-unknown is honestly partition-only, and the no-cross-partition-preemption property both follows from the key shape and is oracle-backed in S1; the unsafe 30-second suppression exit is gone from the normative text — suppression ends only on per-pair re-announce or affirmative liveness reap, bounded by the 45-second expiry from `WriterHelloV1`, with the partial-handoff/no-early-timeout S1 leg present; and pair accounting closes (64-context/128-pair ceilings with refuse-and-run-volatile, `livePairCount`/`livePairCeiling`, `identifierByteCeiling`, `messageByteCeiling` in inspection, and the §D3 `storeMeta` bounds sentence enumerating every broker ceiling). All five Fable round-5 findings remain resolved in v0.7, with M1's resolution actually strengthened by the corrected analysis. What remains is two genuine NITs — a stale "30-second handoff window" phrase surviving in OQ4's constants list (the only reference left to the removed mechanism) and one ambiguous simile in the rewritten overflow sentence — both single-phrase repairs with no implementable divergence: §D2's normative prohibition, the closed inspection record, and S1's timeout leg are unambiguous and mutually consistent. Under the stated bar — no BLOCKING, no unresolved MATERIAL from any round, remainder honestly NIT-class — this document is READY.

2. **Round-6 resolution audit**

| Finding id | Status | Explanation |
| --- | --- | --- |
| Codex R6 M1 (overflow analysis false) | resolved | §D2 (`llp/0166-local-persistent-store.spec.md:708-717`): residue "depends **only on the tombstone window**"; two-memory condition confined to replay of a previously consumed forward; S1 (`:1733-1736`) exercises the 1,024th/1,025th-oldest boundaries and verifies documented residue behavior rather than assuming it. |
| Codex R6 M2 (release-of-unknown / tombstone keying) | resolved | Tombstones keyed `(authorityPartitionDigest, registrationId)` (`:694-700`), created only atomically with a successful `released` outcome; refused releases leave none (`:696-697`, `:1732-1733`); release-of-unknown validation explicitly partition-only with its rationale (`:698-699`); different-partition forwards unaffected — no preemption (`:703-705`), with the S1 same-id-different-partition leg (`:1730-1732`). |
| Codex R6 M3 (timeout ends suppression early) | resolved | The 30-second exit is removed from §D2: "There is no independent timeout exit" (`:738-744`), suppression bounded by the 45-second expiry from `WriterHelloV1`; S1 partial-handoff leg pins no-early-timeout (`:1738-1742`); `heartbeatExpiryMs` is annotated as the suppression bound (`:1168`). One stale *reference* to the removed mechanism survives in OQ4 — see new concern 1 (NIT; the normative repair itself is complete). |
| Codex R6 M4 (pair/inspection bounds not total) | resolved | 64-context/128-pair roster ceilings with refuse-and-run-volatile (`:730-733`); `livePairCount`/`livePairCeiling` beside the context metrics (`:1155-1156`); `identifierByteCeiling`/`messageByteCeiling` in the `constants` object (`:1170-1171`); §D3's `storeMeta` bounds sentence enumerates all broker ceilings (`:922-926`). |
| Codex R6 suggestion 1 (boundary legs) | applied | S1 `:1733-1736`. |
| Codex R6 suggestion 2 (livePair metrics) | applied | `:1155-1156`. |
| Codex R6 suggestion 3 (S1 timeout branch) | applied | `:1738-1742`. |

**Fable round-5 findings, re-verified in v0.7** (all were addressed in v0.6; this confirms they survive the v0.7 edits):

| Finding | Status | Explanation |
| --- | --- | --- |
| F-R5 M1 (no-resurrection guarantee outran bounded state) | resolved | The bounded released-registration memory (1,024, OQ4-provisional) exists with overflow honesty; v0.7's corrected analysis (`:708-717`) supersedes v0.6's incorrect two-memory bound, so the resolution is now also *true*, not just present. |
| F-R5 M2 (entry-level vs whole-message refusal) | resolved | The announce bullet reads "a cross-partition demand refuses the whole message (the message-level rule above)" (`:660-661`); grep confirms no surviving "refuses the entry" outside the header's historical changelog. |
| F-R5 M3 (constants-surface claim false) | resolved | All broker memory counts/ceilings, `perRecordByteCeiling`, and the `constants` cadence object now exist in `StorePolicyInspectionV1` (`:1147-1172`); every OQ4-listed constant surfaces except the phantom 30-second value, which should be deleted, not surfaced (new concern 1). |
| F-R5 N4 (retaining-reason precedence) | resolved | Fixed precedence `registrations > release-grace > safety-blocker > instance-bookkeeping` with the `"none"`-pinned elapsed-deadline transient (`:1197-1205`). |
| F-R5 N5 (`in` operand formally non-scalar) | resolved | "the `in` container is the **sole permitted array operand**", per-element scalar rule (`:1400-1407`); S6 exercises the non-scalar-element-refuses / container-admitted split (`:1811-1813`). |
| F-R5 suggestions ×4 | applied | Additive inspection direction taken and completed in v0.7; overflow phrasing mirrored with S1 coverage; transient reason folded into the precedence sentence; malformed-announce S1 leg present (`:1742-1743`). |

3. **New concerns**

1. **NIT — OQ4 still lists the removed "30-second handoff window" among the v1 provisional constants** (`llp/0166-local-persistent-store.spec.md:1898`). This is the only surviving reference to the mechanism v0.7 removed: §D2 now forbids any independent timeout exit, the inspection `constants` object correctly has no field for it, and no conforming implementation can diverge — but OQ4's closing sentence ("they surface in the policy record so revision is observable") is false for this one phantom value, and enumerating it as a dated-amendable tunable quietly keeps the removed mechanism nameable. Fix: delete the phrase "30-second handoff window;" (the suppression bound is already the listed 45-second expiry, as `heartbeatExpiryMs`'s comment records).

2. **NIT — the rewritten overflow sentence's trailing simile is misattachable** (`:715-717`): "bounded and recoverable, though not self-healing, like the reaped-context window" grammatically lets "like the reaped-context window" attach to "not self-healing," contradicting that bullet's own "a bounded, self-healing window" (`:649-651`). Intended reading is clearly "bounded and recoverable like the reaped-context window, though — unlike it — not self-healing." One word ("unlike the reaped-context window" after "not self-healing," or a comma-restructure) closes it.

4. **Suggestions** (non-blocking)

- When deleting OQ4's phantom constant, consider a parenthetical in OQ4 noting the handoff-suppression bound is not an independent constant but the heartbeat expiry — it preempts a future reader "restoring" the missing value.
- S1's pair-ceiling behavior (the 129th live pair refusing and running volatile-online) is normative at `:730-733` but has no explicit oracle leg; the existing cap-leg pattern (513th registration) extends naturally if the author wants the ceiling oracle-backed.

5. **Recommended next step**

Land the two one-phrase NIT repairs (OQ4 phrase deletion; the "unlike" restructure) as editorial fixes — no re-review round is warranted for them. This is the Fable family's READY; per the loop's convergence rule, pair it with the Codex family's round-7 verdict: if Codex also returns READY on this micro-delta, the loop has converged and LLP 0130 SD-4's standing rule (or Charlie's decision) governs acceptance, which then lands the four §D7 carried amendments and the three boundary notes in their owning documents.

---

## Round 8 — 2026-08-03

**Reviewer family:** Anthropic Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent, model
`claude-fable-5`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author Fable session (subagent with no authoring
context) over the working tree at 32428d31 (v0.8); micro-delta round
confined to the round-7 repairs, additionally verifying that the
pair-liveness repair adopted from Codex round 7 does not change the
family's round-7 READY. The run was interrupted once by a session
restart and resumed from its own transcript over the unchanged tree.
Orchestrated by the authoring session, which does not count as a
reviewer; recorded verbatim below.

---

All verification is complete. Here is my round-8 review.

---

# LLP 0166 v0.8 — Round 8 review (Fable family)

**Reviewer:** fresh non-author Fable session over the worktree at `/Users/ccheever/projects/snapback-0166` (commit 32428d31, v0.8, working tree clean); micro-delta round confined to the round-7 repairs, per the loop's stopping rule. Owner facts: the v0.8-changed text (pair-level reconciliation deadlines, the validation-sentence exception, the overflow simile, the S1 legs, OQ4) is entirely document-internal broker machinery; the multi-grant multi-partition premise (LLP 0055) and every owner boundary it touches are unchanged from the v0.6/v0.7 verifications, so no new owner spot-checks were required and none were performed on trust — the two facts newly *restated* in v0.8 (the 45-second heartbeat expiry as the sole suppression bound; full-set-per-pair announce semantics) were re-verified against §D2's own liveness and announce bullets (`llp/0166-local-persistent-store.spec.md:670-691`, `:684-691`).

1. **Overall assessment**: **READY — confidence 0.90.** V0.8 is a complete and correct application of round 7, and the pair-liveness repair adopted from the Codex MATERIAL findings is sound — it strengthens, not weakens, the basis for my family's round-7 READY. The repair does exactly what the defect demanded: reconciliation reaping is now **pair-scoped** with each roster pair carrying its own deadline (the 45-second heartbeat expiry anchored at `WriterHelloV1`, `:762-766`), so pair A's heartbeat traffic can no longer hold suppression open indefinitely while pair B stays silent — the previously false "bounded by 45 seconds" claim is now actually true, since every roster pair has either re-announced or been affirmatively reaped by t+45s. The soundness rationale is stated and valid: announces are full-set per `(contextId, partition)` pair, so a pair left silent through the entire window is an affirmative absence signal rather than an unknown (`:766-770`), and the handoff/ordinary split is explicit — pair-scoped deadlines exist only for reconciliation, ordinary liveness stays context-scoped (`:773-776`). Critically, the repair introduces no new hole I could find: a wrongly pair-reaped demand has only custody consequences (volatile demands released, grace anchored at suppression end), never authority consequences; nothing bars a reaped *pair* from re-appearing on a later announce (only reaped `contextId`s enter the ignore memory), so the failure mode is self-correcting; and all pair deadlines share one anchor, so reconciliation completes at a single bounded instant. Both of my family's round-7 NITs are applied exactly as specified, both Codex suggestions and both Fable suggestions landed, and S1 now exercises the precise scenario that falsified v0.7 (pair A heartbeating, pair B silent, `:1774-1778`). The one residue I found is a genuine NIT — the client-side re-announce-on-hello obligation is asserted inside the soundness rationale rather than stated as a normative client rule — with no implementable divergence and a benign, self-correcting worst case. Under the stated bar, this document remains READY, now on a sounder protocol than the one I judged READY at round 7.

2. **Round-7 resolution audit**:

| Finding id | Status | Explanation |
| --- | --- | --- |
| Codex R7 M1 (45-second handoff bound false for multi-partition contexts) | resolved | Reconciliation reaping is pair-scoped with a per-pair deadline — the 45-second expiry from `WriterHelloV1` — reaping a silent pair *as a pair* even while its context stays live via another pair's traffic (`:762-768`); "no independent timeout exit and no context-wide hostage state" (`:770-771`); the ordinary-liveness/handoff split is explicit (`:773-776`); S1's partial-handoff leg now pins exactly the falsifying scenario: pair A re-announcing and heartbeating, pair B silent until its own pair deadline reaps it, context still live, pair A's demands intact (`:1773-1778`). |
| Codex R7 M2 / Fable R7 NIT 1 (phantom "30-second handoff window" in OQ4) | resolved | OQ4's constants list carries only the real values (15/45-second heartbeat/expiry, `:1935`); grep confirms "30-second" survives nowhere outside the Revised header's historical changelog (`:19`, `:39`); the closing parenthetical states the suppression bound is the heartbeat expiry applied per roster pair, not an independent constant (`:1941-1944`), so the every-listed-constant-surfaces claim is now true. |
| Codex R7 N3 / Fable R7 NIT 2 (misattachable overflow simile) | resolved | Restructured to "bounded and recoverable like the reaped-context window, though, unlike that window, not self-healing" (`:736-738`) — the exact repair both families specified; no longer contradicts the reaped-context bullet's "bounded, self-healing window" (`:669`). |
| Codex R7 suggestion 1 (named overflow schedules in S1) | applied | S1 names and exercises both schedules at the exact 1,024/1,025 boundaries: *release-before-first-forward* (tombstone alone governs, with the documented recreate-and-recover residue verified) and *previously-consumed-forward replay* (consumed-outcome eviction additionally required) (`:1765-1771`). |
| Codex R7 suggestion 2 (name the release-of-unknown exception in the validation sentence) | applied | "the writer validates the same way for both — with one stated exception, a release naming an unknown id, whose validation is necessarily partition-only (detailed below)" (`:696-699`); consistent with the detailed tombstone rule it forward-references. |
| Fable R7 suggestion 1 (OQ4 parenthetical preempting a restored constant) | applied | `:1941-1944`. |
| Fable R7 suggestion 2 (129th-live-pair oracle leg) | applied | S1: "the 129th live pair refuses and runs volatile-online" (`:1778-1779`). |

3. **New concerns**

1. **NIT — the client's re-announce-on-hello obligation is asserted only inside the soundness rationale, never stated as a normative client rule.** The pair-reap soundness argument rests on "a live context re-announces every pair it still demands" (`:767-768`), but §D2's client obligations as written require only *some* well-formed message every 15 seconds (context-scoped keep-alive, `:682-687`) and a full-set re-announce after a wrongful *context* reap (`:663-666`). A conforming-but-literal multi-pair client that heartbeats via pair A alone would have pair B wrongly reaped at every writer handoff. The consequence is strictly custody-scoped and self-correcting — demands released, grace anchored at suppression end, and nothing bars the reaped pair from re-appearing on its next announce (only reaped `contextId`s enter the ignore memory) — so no authority, boundedness, or hostage consequence exists, and no implementable divergence in the *writer* follows. One sentence closes it: on observing `WriterHelloV1`, a context must re-announce each of its pairs' full sets within the heartbeat interval. This does not change the verdict.

4. **Suggestions** (non-blocking)

- When adding the re-announce-on-hello sentence, a clause noting that a reconciliation-reaped *pair* (unlike a reaped context) may simply re-announce and re-appear — no fresh `contextId` needed — would preempt an implementer conflating the pair reap with the context-reap ignore rule; the text currently implies this ("updated as pairs appear and reap," `:750-751`) without saying it.
- The phrase "can never end while a live pair's demands are absent from the rebuilt ledger" (`:772-773`) uses "live pair" in the full-set-announce sense the preceding sentence defines (a pair that has demonstrated liveness by re-announcing). It is anchored by its context, but if the paragraph is ever edited, "unreconciled pair" would be the drift-proof spelling.

5. **Recommended next step**

This is the Fable family's READY, re-affirmed over the v0.8 pair-liveness repair — the two round-7 NITs are applied and the repair adopted from Codex's round-7 MATERIALs introduces no defect that would change the verdict. Per the loop's convergence rule, pair this with the Codex family's round-8 verdict on its own MATERIAL repairs: if Codex also returns READY, the loop has converged dual-READY and LLP 0130 SD-4's standing rule (or Charlie's decision) governs acceptance, which then lands the four §D7 carried amendments and the three boundary notes in their owning documents. The single NIT above is a one-sentence editorial tightening an author may land without a further review round.
