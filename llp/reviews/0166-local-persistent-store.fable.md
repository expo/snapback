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
