# Review artifact — LLP 0211, Fable family

Target: `llp/0211-typed-opaque-structured-stored-values.spec.md`

## Round 1 — 2026-08-09

**Provenance.** Reviewer: Claude (Fable 5), fresh agent session, no
orchestrator conversation context (structural blindness). Orchestrator/
reviser: Claude (Fable 5), this repo's super-refine session — did not
review. Revision under review: `0d951fa69` (file sha256 prefix
`7ea0615b656e3166`). Instruction capsule: round1-instructions.md (sha256
prefix `98a817bfd8`), repo-local capsule at `0d951fa69`, excluded-by-
instruction: `llp/reviews/0211*`, scratchpad, run journals. Runtime:
~9.1 min, 57 tool uses. Verdict: **NOT READY**.

**Verbatim review body follows.**

---

Blindness self-attestation: I did not read review artifacts, journals, or the other family's output. I did not open anything under `llp/reviews/` matching `0211*`, any scratchpad/run-journal files, or search for prior reviews of this document.

## Concerns

1. [MATERIAL] Migration case 2 contradicts the Spec's own applier rule, and the "conservative activation-time scan" cannot produce canonical bytes — §Migrations case 2 says "Small tables may use a conservative activation-time scan; substantial tables take LLP 0081's add/copy/validate/publish/retire route." Two paragraphs later the same section pins: "The conservative applier admits no narrowing between structured and any other field type in v1 (evolve by new field plus backfill, the existing posture)." `v.json()` → declared structure is exactly a narrowing between structured and another field type, so the second sentence forbids the route the first sentence offers. Independently, the activation-time-scan admission pattern this leans on (the enum narrowing) is admissible precisely because "a domain narrowing rewrites no rows — the physical column does not move" (`llp/0007-storage-portability.spec.md:902-908`), while case 2 itself states every value must "be rewritten to canonical bytes" — a scan-only activation check cannot do that, and a scan-and-rewrite inside the activation transaction would be a new applier capability the Spec neither specifies nor reconciles with LLP 0081's rule that type changes go add/copy/validate/publish/retire (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:391-395`). As written, the implementation cannot decide which route small-table `v.json()`→typed takes, or whether the applier gains a rewriting scan. Either delete the small-table scan option (all conversions take the 0081 route) or specify the new applier admission explicitly.

2. [MATERIAL] The admitted-leaf inventory is not closed: `v.json`, `v.vector`, `v.principal`, and platform-constructed nodes are unaddressed — §Declaration admits "the LLP 0131 recursive vocabulary — `v.object(...)`, `v.array(...)`, `v.union(...)`, `v.optional(...)`, and the scalar leaves" and refuses only `v.assetRef` and `v.id`/relation references. But the LLP 0131 vocabulary explicitly includes `v.json({maxDepth,maxBytes})` as a leaf (`llp/0131-structured-argument-contracts.spec.md:144-145`): admitting it inside a declared structured value silently reintroduces the unvalidated escape hatch *inside* a "typed, validated" value (with no degraded-contract diagnostic, since the field is declared), while refusing it is a divergence from the grammar the Spec claims to consume unchanged — either way this is a decision the Spec must record. Likewise `v.vector`: the shared authoring gate accepts vector validators before any position branching (`packages/snapback-codegen/index.mjs:6121-6135`), and a vector inside canonical JSON would silently lose its physical representation (BLOB binary64, `src/storage.rs:17646-17658`), dimension enforcement, and vector-index eligibility — exactly the lifecycle/representation-bearing-leaf class the assetRef/v.id refusals exist for. `v.principal` (nominal auth-relevant typing) and `platformSchemaRef` interiors are similarly unnamed. The refusal list must enumerate the closed admitted-leaf set, not gesture at "the scalar leaves."

3. [DETAIL] Whole-column index-declaration refusal is new behavior, not continuation — today an ordinary index declared on a `Json` column is silently accepted by both codegen (`packages/snapback-codegen/index.mjs:1745-1752` checks only field existence and unique/optional) and the Rust schema validator (`src/storage.rs:10466-10481`); only filters (`src/storage.rs:12041-12046`), ordering (`src/storage.rs:17966-17977`), and search-index membership (`src/storage.rs:10541-10573`) refuse. The Summary's "refuse fail-closed exactly as today" holds for the interior surfaces it lists, but §Query surface's "no index declarations" and acceptance item 4's index-declaration refusal are new machinery the implementation must build — worth stating, and worth deciding whether the same refusal (or at least a diagnostic) should retrofit onto plain `v.json()` columns, whose silently-accepted dead indexes are the same trap.

4. [DETAIL] OQ4 is already ruled; adopt it rather than re-open it — LLP 0131 Ruling 2 item 2 pins optionality as omission-not-null with explicit null spelled via a union variant, code-witnessed at the args ingress (`src/args_contract.rs:828-840`). The Spec's OQ4 proposal restates this ruling as an open question. A Spec that "consumes the grammar; it does not extend it" should cite the ruling as decided (it also fixes the durable canonical-byte distinction between `{}` and `{"a":null}`, which should not float). Same for OQ6: the args boundary is already closed-map (`additionalProperties: false`, LLP 0115 CV-4 evidence, `llp/0115:768-769`); since both answers define the durable byte contract and the generated types, both should be pinned by acceptance, and both leans match the landed machinery.

5. [DETAIL] The outermost-node rule's Enum-bounds edge needs its fate stated — `validateStoredLiteralUnion` fail-closes any stored union of string literals violating the domain bounds (2–7 variants, ≤64 UTF-8 bytes, `packages/snapback-codegen/index.mjs:6066-6091`). Under "a bare structured node that is exactly a top-level union of string literals routes to the landed Enum path," an 8-literal or long-literal top-level union routes to Enum and refuses, even though it is plain data the structured path could carry. That reading is decidable and probably intended (it preserves the Enum evolution bound), but the Spec should say it, since it is the one case where admitting structured values makes a previously-refused plain-data shape stay refused.

6. [DETAIL] Interior integral-Real normalization should be named in the write path, not only in acceptance — the LLP 0073 round-trip pin (`src/storage.rs:17874-17883`) covers top-level `Real` columns; inside canonical bytes, JCS spells an integral double as `5`, which reloads as an integer `Number` while the validated in-memory document may hold `5.0`. Acceptance item 3 asserts the property; §Representation's "validate ... canonicalize, enforce bounds, store" should name the in-memory admission-normalization step (the CV-10/0073 analogue) so the design, not just the fixture, owns it.

7. [DETAIL] Per-target and per-writer scope of the central check should be explicit — the enum precedent's central coercion names "inserts, patches, seeds, and every buffered writer" as one guard (`src/storage.rs:17806-17808`), and LLP 0007 requires identical behavior across Rust, Cloudflare, and buffered overlays. Acceptance item 4 proves only the SQLite target plus the schema compiler; the Spec should state that non-local targets and any client-local write lane stay support-false on the `structured_stored_value_v1` fact until they carry the same validate-canonicalize seam, so hosted lanes cannot silently accept structured fields without canonical bytes.

8. [DETAIL] LLP 0044's unqualified withdrawal clause stays in tension until the clarification lands — OQ1 is ruled (asset-reference scope only), but `llp/0044-asset-storage-pipeline.rfc.md:32-33` and `:916-917` still read "the portable vocabulary ships no array table fields" without qualification, and the ruling is recorded only inside this Spec's OQ. Deferring the dated 0044 note to "lands with the implementation" leaves a corpus-visible contradiction between an Accepted RFC and a Review Spec in the interim; landing the note at this Spec's acceptance would be cleaner.

9. [DETAIL] Phase A/B amendment framing — sound as a proposal and consistent with LLP 0007's engine-JSON-predicate cautionary case (`llp/0007:402-412`), but the claim that CV-4b's exit phrase "defined index and sync behavior" is "satisfied by Phase A for the atomic tier" is the 0115 owners' call, not this Spec's; the text mostly respects that ("for the 0115 owners to record, not decided here") — keep the exit-phrase sentence clearly inside the proposal's scope when the 0115 row is amended.

Verified and found accurate (for the record): the silent `v.object` degrade claim (`packages/snapback-codegen/define.mjs:457` sets `fieldType: 'Json'`; `index.mjs:6177` accepts it in the closed map; `index.mjs:1722-1726` emits `field_type: Json`, shape erased; `index.mjs:6184-6187` gives `v.array` the teaching hint; guide `your-first-backend.md:118-119` claims neither is usable); today's non-canonical `serde_json` storage and parseability-only read (`src/storage.rs:17852-17863`, `17639-17645`); the Enum TEXT + central domain-check precedent (`src/storage.rs:17802-17826`, `llp/0007:888-900`); RFC 8785 machinery existing for reuse (`src/rqs.rs:117-202`); ContentDigestV1 hashing logical rows independently of physical encoding (`llp/0081:557-569`); the 0115 decision-sitting maturity ruling "0113's qualification route is the default for new profiles" (`llp/0115:1536-1543`); bounds matching LLP 0131/0108 (depth 16, 1,024 elements, `llp/0131:146-148`) and the 1,024 portable collect cap (`llp/0007:381`); and the 0208 G8 / withdrawal-preservation account (`llp/0208:242-259`, `llp/0044:28-36`).

## Verdict
NOT READY — binding to revision 0d951fa69 (sha256 7ea0615b656e3166)
The slice is well-chosen, the prior-ruling discipline is genuine, the current-state claims are almost entirely code-accurate, and the encoding-identity split plus the trap-avoidance pins do secure the §Migrations forward-compatibility claims. Two unresolved MATERIAL defects block READY: §Migrations case 2 offers a small-table activation-time-scan route that the Spec's own no-narrowing applier rule forbids and that cannot rewrite bytes to canonical form, leaving the `v.json()`→typed path undecidable as specified; and the admitted-leaf inventory is open where it must be closed — `v.json`, `v.vector`, `v.principal`, and platform-constructed leaves inside structured interiors are neither admitted nor refused, though the LLP 0131 vocabulary the Spec consumes contains them and at least two (opaque-JSON interiors, vectors) carry representation or honesty semantics that cannot be left to the implementation. Both are small, bounded revisions; the remaining concerns are DETAIL-class and do not bear on the verdict.

## Round 2 — 2026-08-09 (delta round)

**Provenance.** Reviewer: Claude (Fable 5), fresh agent session,
structural blindness (self-attested caveat recorded verbatim below: a
`git show --stat` listed the two review-artifact filenames; neither was
opened). Reviser: orchestrator, did not review. Revision under review:
`bf5cfa214` (file sha256 prefix `cad95f0810919c00`). Delta round:
instructions enumerated the round-1 delta and required IN-DELTA vs
PRE-EXISTING classification (round2-instructions.md, sha256 in round
record). Runtime ~8.7 min, 62 tool uses. Verdict: **NOT READY — one
MATERIAL, IN-DELTA; zero PRE-EXISTING MATERIAL.**

**Verbatim review body follows.**

---

Blindness self-attestation: I did not read review artifacts, journals, or the other family's output. (I ran `git show bf5cfa214 --stat`, which lists the two `llp/reviews/0211-*` filenames; I did not open or diff either file, nor anything else under `llp/reviews/` or any scratchpad/journal beyond my own instructions file.)

## Concerns

1. [MATERIAL][IN-DELTA] The whole-row live-frame "guarantee" does not follow from the pinned mechanism — §Representation pins "a per-row aggregate ceiling on total structured bytes (proposed 48 KiB) chosen so a whole-row snapshot always fits the repository's 64 KiB live-frame profile," and the §Observation journal/deltas row hardens this into an invariant: "the §Representation aggregate byte ceiling guarantees every such envelope fits the live-frame profile, so no journal or delta surface needs structure-aware behavior." The frame cap is real (`MAX_LIVE_SOCKET_FRAME_BYTES: usize = 64 * 1_024`, /Users/ccheever/projects/snapback/src/server.rs:6779), but the aggregate ceiling bounds only the *structured* contribution to a row. Nothing bounds the rest: stored `v.string()` fields carry no declared byte ceiling (only *order* fields do — `order_field_max_encoded_bytes_exceeded`, src/storage.rs:16500–16517), stored `Json` fields pass through unbounded (`FieldType::Json => Ok(value)`, src/storage.rs:17869), and I found no whole-document byte ceiling on any insert/patch route; the args-side profile maximum is 1 MiB (src/args_contract.rs:44). A row with 48 KiB of structured bytes plus a 40 KiB string is admissible and its snapshot exceeds the frame profile, so "guarantees every such envelope fits" is false as normative text, and the "no structure-aware behavior needed" conclusion is resting on a claim the mechanism cannot deliver. The honest, defensible claim — structured fields add a bounded contribution and therefore keep exact parity with today's `Json`/string delivery posture, in which whole-row fit was never guaranteed either — supports the same design row without the false invariant. As written, the OQ3 implementation fixture ("verifies them against the live-frame profile") is being asked to verify an unverifiable property. Fix is small: restate the sizing rationale and the journal/deltas row as bounding the structured contribution (or extend the mechanism to whole-row accounting if the invariant is actually wanted), and align OQ3's fixture claim.

2. [DETAIL][IN-DELTA] The top-level dispatch table is not fully closed as claimed — it assigns fates to scalar leaves, the three union cases, `v.object`/`v.array`/other unions, and `v.json`, but no row covers an outermost bare `v.literal(...)`, bare `v.null()`, or a tuple-class node. Today these refuse via the closed primitives map (packages/snapback-codegen/index.mjs:6172–6188 admits only string/boolean/number/unknown/object primitives at stored positions); a table presented as "a closed table, not an inference" should say these stay refused rather than leave them to inference.

3. [DETAIL][IN-DELTA] Nullable-scalar steering footgun — under the new dispatch, `v.union([v.string(), v.null()])` at top level is "any other `v.union(...)`" and silently becomes a `Structured` field: canonical-JSON-encoded, no predicates, no index eligibility, when the author almost certainly meant an optional string column (`v.optional(v.string())`). Not a defect in the closed dispatch itself, but this is exactly the class of surprise the Spec's own teaching-diagnostics posture exists for; a note or authoring hint steering scalar-or-null unions toward `v.optional` would be consistent with the rest of the design.

4. [DETAIL][IN-DELTA] §Capability's per-writer scope ("client-local write lanes stay support-false") superficially collides with §Observation and acceptance item 5, which require retained/local client stores and read-your-writes overlays to round-trip structured values through offline/reconnect. The intended reconciliation — client lanes buffer and display logical values but hold no independent durable-admission authority; the server-side validate-normalize-canonicalize seam is the only settlement gate, so support-false means "cannot settle," not "must refuse the schema" — is recoverable from the text but never stated. One sentence would prevent an implementation-phase misreading that local-first clients must refuse apps declaring structured fields (which required-capability propagation could otherwise be read to imply).

5. [DETAIL][IN-DELTA] The hosted-claim-family sentence says minting one "requires its own dated governing amendment" citing LLP 0134; LLP 0134's actual rule locates the act precisely — "Where an id's family kind is not yet in LLP 0113 §4's closed union, adding it is a dated LLP 0113 amendment" (llp/0134-capability-maturity-promotion.spec.md:185–187). Naming LLP 0113 §4 as the amendment's home would make the pointer exact instead of approximately right.

6. [DETAIL][PRE-EXISTING] §Migrations enumerates three cases but not the fourth transition the honesty defect itself creates: an app authored with stored `v.object({...})` today carries `FieldType::Json` in its *installed* manifest (the silent degrade at packages/snapback-codegen/index.mjs:6177, `['object', new Set(['Json'])]`); when this Spec's dispatch flips, regenerating the same source emits `Structured`, which the conservative applier will refuse as a type change — safely fail-closed, and resolvable by the case-2 route or a source rewrite to `v.json()`, but the affected population (schemas already in the degraded half-state) deserves a named row so the flip's deployment consequence is priced, even under the no-current-users posture.

## Verdict

NOT READY — binding to revision bf5cfa214 (sha256 cad95f0810919c00)

The delta is high quality and I verified its load-bearing claims against code and the governing corpus: the closed dispatch matches the shipped stored-union gate (2–7 variants, 64-byte literals, out-of-bounds refusal, packages/snapback-codegen/index.mjs:6050–6091, 1691–1700); the `v.vector`-before-position-branching implementation note is accurate (index.mjs:6121–6137); index-on-`Json` is indeed silently accepted today (index.mjs:1729–1753 checks no field types) so the refusal is honestly disclosed as new machinery; the 0131 adoptions match that Spec's landed rulings (`allowExtra` must be `false` at every position; Ruling 2's omission-not-null projection); the 0081-only conversion route matches "V1 represents a rename or type change as add/copy/validate/publish/retire" and ContentDigestV1's logical-row hashing (llp/0081:391, 550–585); the LLP 0044 clarification landed exactly as described; and the 0134 publication contract is substantially conformant. The single unresolved MATERIAL concern (#1) is IN-DELTA — no MATERIAL concern is PRE-EXISTING: the new per-row aggregate bound is a sound mechanism, but the Spec records a false normative invariant ("guarantees every such envelope fits the live-frame profile") that the mechanism provably cannot deliver while other field families remain byte-unbounded, and a design row plus an acceptance/OQ3 fixture are pinned to it. The fix is a scoped restatement (bound the structured contribution; claim delivery-posture parity with today), after which I would expect this document to be READY; the remaining concerns are implementation-phase details identifying no defective decision.

## Round 3 — 2026-08-09 (final in-budget delta round)

**Provenance.** Reviewer: Claude (Fable 5), fresh agent session,
structural blindness (path-scoped git invocations per hardened
instructions). Reviser: orchestrator, did not review. Revision under
review: `a8e1d75df` (file sha256 prefix `1c43c9121ff96fd4`). Delta round
(round3-instructions.md). Runtime ~7.3 min, 46 tool uses. Verdict:
**NOT READY — one MATERIAL, IN-DELTA (one-sentence disclosure fix);
zero PRE-EXISTING MATERIAL; delta-convergence condition holds from this
family.**

**Verbatim review body follows.**

---

Blindness self-attestation: I did not read review artifacts, journals, or the other family's output. All `git show` invocations carried explicit `-- <path>` arguments scoped to the two LLP documents; I did not read anything under `llp/reviews/` or any scratchpad/journal file other than my own instructions file.

## Concerns

1. [MATERIAL][IN-DELTA] Search `storedFields` "no stored-field type restriction" claim is false at the Rust layer — the §Observation matrix's new disclosure sentence ("current code applies no stored-field type restriction (vector rejects only `Vector`)") is contradicted by `src/storage.rs:10562–10574`, where the Rust schema validator already refuses `FieldType::Json` in search `stored_fields` with `SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID` ("search stored field ... must be a bounded scalar display field"). The claim is accurate for the JS authoring gate (`packages/snapback-codegen/index.mjs` checks only classification and field existence for search storedFields) and accurate for vector on both layers (only `Vector` is rejected: `index.mjs:1900`, `src/manifest.rs:4433–4437`), but "current code" is unqualified, and the Spec demonstrably distinguishes layers when it means both (the index-declaration disclosure names "codegen and the Rust schema validator", which I verified is accurate: neither layer type-checks ordinary index fields — `index.mjs:1731–1752`, `storage.rs:10430–10480`). The paragraph's conclusion survives — excluding `Structured` is still a new refusal, since `FieldType::Structured` would not be matched by the existing `Json` check and the JS gate has no restriction at all — and the pre-existing Rust behavior actually strengthens the exclusion's consistency. But this sentence exists precisely to state the current observation surface honestly (the delta item was minted to correct a disclosure), and as written it asserts that a `v.json()` field can sit in search `storedFields` today, which is false on the Rust target. One-sentence fix: disclose the split (search already refuses `Json` at the Rust validator; the JS gate and the `Structured` case are the new enforcement).

2. [DETAIL][IN-DELTA] "`FunctionArgsContractV1` root" names a record type, not a domain string — the carrier paragraph's parenthetical says the stored-contract hash preimage is "deliberately not LLP 0131's `FunctionArgsContractV1` root". LLP 0131's current hash-witness domain is the string `snapback:function-args:v2` (`packages/snapback-codegen/result-contracts.mjs:47`, which also records that the v1 domain was replaced); `FunctionArgsContractV1` is the record's type name. The domain-separation intent is unambiguous and correct, and `snapback:stored-structured-contract:v1` has no collision anywhere in `src/` or `packages/` (verified by grep). Precision fix at implementation time; no defective decision.

3. [DETAIL][IN-DELTA] Teaching-hint coverage gap for literal-unions-with-null — the new nullable-scalar hint covers top-level `v.union([<scalar>, v.null()])`, but the sibling case `v.union([...string literals, v.null()])` also routes to `Structured` under the dispatch table (today it refuses: `validateStoredLiteralUnion` at `index.mjs:6050–6090` requires every variant be a string literal), silently stepping off the Enum path an author likely wanted via `v.optional(v.union(...literals))`. The dispatch is deterministic, installed apps are protected by the conservative applier's type-change refusal, and refusing pure >7-literal unions to preserve the Enum evolution bound is sound — so no defective decision; a second hint in the same diagnostic family is an implementation-phase addition.

Verified clean (for the record): `v.number` is a real builder mapping to `Real` (`define.mjs:407–412`), so the admitted-list enumeration of four numeric spellings is correct; every "stays refused today" dispatch row checks out against the closed primitives map (`index.mjs:6172–6190`: bare `v.literal`/`v.null`/`v.tuple`/`v.array` all carry primitives outside the map, while `v.object` carries `fieldType: 'Json'`/primitive `'object'` and passes — confirming both the silent-degrade defect and migration case 4's premise); the vector-passes-before-position-branching implementation note is accurate (`index.mjs:6121–6136`); Enum bounds are 2–7 variants / 64-byte literals (`index.mjs:6066, 6089`); `v.string()`/`v.json()` byte bounds are optional (`define.mjs`), and the 64 KiB live-socket frame cap is real (LLP 0131 §Budget, `src/server.rs:6007`), so the restated bounded-structured-contribution/delivery-posture-parity claim is now honest; LLP 0134 §1 does name the plain-registered-boolean route for non-relation local capabilities and locates claim-family additions as dated LLP 0113 amendments; LLP 0113 §4's closed union (`relationActivity`/`hostedEphemeral`/`migration`) contains no stored-field kind; LLP 0131's explicit-null/omission and closed-map rulings exist as adopted; LLP 0007 carries the single-sourced-mapping rule, the conservative applier, and the `arrayContains` silent-scan cautionary case; the LLP 0044 enforcement-paragraph reconciliation (line 952) is consistent with its withdrawal-scope clarification header; all three referenced `issues/` tickets exist; `FieldType` (`src/contract_types.rs:298`) has no `Structured` variant yet.

## Verdict

NOT READY — binding to revision a8e1d75df (sha256 1c43c9121ff96fd4)
One MATERIAL concern, and it is IN-DELTA, not PRE-EXISTING: the round-2 disclosure sentence for search/vector `storedFields` misstates the current refusal surface (the Rust validator already refuses `Json` in search stored fields at `src/storage.rs:10569`), which matters in a section whose normative stake is "anything unlisted is a defect" and in a delta minted specifically to make that disclosure honest; the fix is one sentence and touches no decision. No MATERIAL concern in PRE-EXISTING text: the pre-existing design — closed dispatch, opaque-interior refusal surface, RFC 8785 TEXT encoding with split logical/physical identity, 0081-only conversion routes, asset-ref exclusion under the preserved 2026-07-31 ruling, and the capability posture — verified sound against code and the cited LLPs, so the delta-convergence condition on pre-existing text holds from this family's side; the remaining two concerns are DETAILs identifying no defective decision and are implementation-phase material, non-blocking.

## Loop close-out — 2026-08-09

**Terminal: delta-convergence with an unreviewed tail (3-round budget
exhausted).** Final verdicts bind to revision `a8e1d75df` (sha256
`1c43c9121ff96fd4`): fable NOT READY (1 MATERIAL in-delta), codex NOT
READY (1 MATERIAL in-delta). **Pre-existing text was MATERIAL-clean from
both families in both delta rounds (2 and 3)** — the delta-convergence
condition holds. The two round-3 in-delta MATERIALs (search-storedFields
disclosure split; StoredStructuredContractV1 wire members + hash formula)
plus round-3 DETAILs were fixed in the round-3 close-out revision, whose
delta is **UNREVIEWED** — recorded in the document header. Disposition
ledger: every round-1/2/3 concern from both families is dispositioned in
the revisions its round produced (see the dated Revised entries); no
concern was summarized away; one reviewer claim (codex r2: "v.number is
not a builder") was refuted against code and not applied. Growth: 349 →
~560 lines over the loop, beyond the ~20% guidance, MATERIAL-driven and
disclosed each round. Recommendation to the author: the Spec is ready for
acceptance consideration with the unreviewed-tail caveat; the
implementation phase (authorized separately by the author) proceeds
against the close-out revision and treats both families DETAIL ledgers as
implementation checklist items.
