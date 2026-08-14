# LLP 0255 — three-family super-refine run journal

## Authorization, bounds, and topology

- **Invoked:** 2026-08-13 by Charlie Cheever via `/llp-super-refine` for
  `llp/0255-tiny-data-surface-v1-api.spec.md` ("Do the same
  /llp-super-refine process we did on the 0255 spec"), renewing the
  LLP 0254 run's authorized variations for this target:
  1. the three-family reviewer pool — Claude family (Claude Fable 5 at
     **max** reasoning effort), Grok family (Grok 4.6 at xhigh), GPT
     family (Codex `gpt-5.6-sol` at xhigh);
  2. the **pool-exit rule**: once the Claude family returns READY on a
     revision, Claude leaves the pool and later convergence is judged
     over the remaining two families;
  3. the **orchestrating session acts as the author** for loop rulings,
     recorded here verbatim; acceptance is not a loop ruling and this
     run never sets `Accepted` or beyond.
- **Provenance of the target:** the entering draft was authored earlier
  today by Codex `gpt-5.6-sol` (xhigh) as lead author under this
  session's Phase 0 charter (LLP 0254 implementation program), in the
  `phase0-lane` worktree at base `e15064b46`. Codex is therefore a
  co-author of the entering draft; its loop reviews come from fresh
  blind Codex instances, the same separation the 0254 and 0250/0251
  runs used. The Claude-family reviewer shares a model family with the
  orchestrating reviser; the reviewing instances are fresh and wrote no
  revision (author-authorized deviation, as in the 0254 run).
- **Families and runtimes (verified available in the 0254 run earlier
  today, same CLIs):** Claude — headless Claude Code CLI 2.1.231,
  `--model claude-fable-5 --effort max`, tools restricted to
  Read/Glob/Grep; Grok — Grok CLI, `grok-4.6`,
  `--reasoning-effort xhigh`, `--disable-web-search`; GPT — Codex CLI
  0.147.0, `gpt-5.6-sol`, `model_reasoning_effort=xhigh`, read-only
  sandbox. An unavailable specified reviewer stops the loop; none
  substituted.
- **Topology:** one single-target cluster, three families in lockstep on
  one shared capsule per round.
- **Bounds:** three rounds (skill default), six reviewer launches per
  family including voids, and approximately 20% net growth over the
  entering revision (64,741 bytes → ceiling ≈ 77.7 KB).
- **Status authority:** the target entered as Draft (pre-transition
  SHA-256
  `aad3b98a660581d810344157b2d840797b81d729efcecbb9825f952f6406ba1b`,
  64,703 bytes). The authorized `Draft → Review` transition was applied
  before round 1 (header + Status section wording only) and is this
  loop's only status transition.
- **Revision identity:** the target is untracked in the primary
  checkout, so revisions are bound by full SHA-256. r1 SHA-256:
  `8d7d63ff8459e9e8fcca086e5fb4ea280423d6ef011135fe4435321a2db69358`
  (64,741 bytes).

## Disclosure and blindness

The human invoker's instruction renews the external-reviewer selection
from the 0254 run (OpenAI Codex, xAI Grok), authorizing the unredacted
target and repository review context to those services; the
Claude-family review stays within Anthropic. **Outbound inventory per
round:** the public tracked repository exported at the recorded base
commit (which now includes the landed LLP 0253/0254 and their landed
review corpora — history of other documents, not of this target), the
complete unredacted target revision, and `REVIEW_INSTRUCTIONS.md`.
Excluded structurally: every review artifact for LLP 0255 (none exist;
verified zero in the capsule), this run journal, orchestrator notes,
`.git` metadata, `.agent-local-secrets.md`, credentials, and every other
gitignored or untracked file.

All three reviewers execute on the shared machine where the parent
checkout remains technically readable, so capsule-only reading is
additionally instruction-enforced and self-attested; that residual is
disclosed here. The Claude lane is tool-restricted to Read/Glob/Grep;
the Codex lane runs in a read-only sandbox; the Grok lane runs with web
search disabled. Reviews are mutually blind by construction: concurrent
launches against one capsule containing no review of this target,
artifacts written only outside the capsule. The instructions state
explicitly (a lesson from the 0254 rounds) that no earlier revision of
the target exists in the capsule and that the root
`REVIEW-CANDIDATE-r*.md` / `final-cli.log` files are unrelated tracked
repository files.

## Round 1 — 2026-08-13

- **Revision r1:** SHA-256
  `8d7d63ff8459e9e8fcca086e5fb4ea280423d6ef011135fe4435321a2db69358`
  (64,741 bytes), Status: Review.
- **Capsule base:** repository export at origin/main
  `e15064b46dd4afdfc57603a3cc079e67096cca72` (the LLP 0254 landing) plus
  the r1 target overlay; 11,291 files including the instructions; zero
  `llp/reviews/0255*` files present.
- **Capsule inventory SHA-256** (sorted per-file SHA-256 list, hashed):
  `73d50b7ca674cfc14f86b0d80fdb481bfd89526f937c6d8c5b6d2282849f4b30`.
- **Instruction SHA-256 (`REVIEW_INSTRUCTIONS.md`):**
  `6ba2498e8e4f1a3e460a54417d807bd2740b21534b53c32d057557b780c72593`.
- **Lens:** Spec-grade readiness review — contract closure and
  implementability against shipped code, cross-LLP amendment
  scrutiny (LLP 0065 fill, 0218/0043 custody+ambiguity, 0238
  vocabulary, the no-0157/0108/0004-amendment claim), LLP 0254
  conformance — plus a bounded implementer probe (author the `todos`
  declaration and enumerate everything it generates; state the complete
  `db.useQuery` admission pipeline). Identical instructions for all
  three families.
- **Launches (concurrent, after this record was persisted):** Claude
  family — headless `claude -p --model claude-fable-5 --effort max`,
  tools restricted to Read/Glob/Grep, launch 1; GPT family —
  `codex exec --skip-git-repo-check -m gpt-5.6-sol
  -c model_reasoning_effort=xhigh -s read-only` in the capsule,
  launch 1; Grok family — `grok -p -m grok-4.6 --reasoning-effort xhigh
  --output-format plain --disable-web-search --permission-mode auto` in
  the capsule, launch 1.
- **Grok outcome:** received and written verbatim to the grok artifact
  on receipt. **NOT READY** (5 MATERIAL, 5 DETAIL; direction retained)
  bound to r1; hash and byte count verified in-capsule. MATERIAL set:
  (1) S2/S5.3/S6.1's exact function-slot match is unsatisfiable — the
  reused `defineOwnedCrud` list/get carry `documents` result contracts
  while S5.3 makes every data query a `DataPageV1` cursor page and S6.1
  requires equal `resultContractHash`, so the "existing-generated" match
  path is empty by construction (three named resolutions offered);
  (2) the hashed query core is not closed — `DataFilterTemplateV1` is
  used but never defined, filter-array ordering and scalar-vs-`{eq}`
  canonicalization are unpinned, and the cursor is simultaneously
  outside the QMK preimage (S4.3) and a slot argument (S6.2), which is
  either a silent LLP 0157 preimage change or a page-aliasing bug;
  (3) multi-chunk `db.transact` (2..16 chunks) has no replayable
  LLP 0043 function identity — needs an S6-parallel resolution rule
  (one chunk = the generated mutation's reference; several = one
  synthesized ordinary Mutation) rather than a second wire authority;
  (4) sync-on silently bundles LLP 0065-disclaimed retention — S4.2's
  `retained` boolean has no default-false pin gated on the named 0065
  OQ5/0243/0053 lease + convergence-fixture package; (5) S3.2's
  `intentId` mints a second settlement primary key beside the shipped
  `clientMutationId`/sequence identity — must be pinned byte-for-byte
  identical with the outbox record keeping `sequence`. DETAILs: a dated
  0253 Appendix A splice for `.data`/`.sync`; generated `get` has no
  tiny doorway; the fail-closed no-drop table points at 0253's authored
  key matrix instead of the generated function record; S3.3 overreaches
  0238 D4's hook grammar; four prose-only leaves
  (`DataCursorV1`/`DataQueryExplainV1`/`AuthorityCaptureV1`/
  `DataDiagnosticV1`) plus cursor-nullity and provisional-id
  reconciliation. Implementer probe: the declaration/generation
  enumeration is determinate (its table matches Appendix A1 + S3.1
  fill); admission steps 2/6/7/9 are UNDERDETERMINED per MATERIALs 1–2.
  Positive verification: S0's shipped-code citations all check out
  (no-`.data` builder, visibility warn-not-fail, `listIndex` refusal,
  QMK preimage, six-arm `QueryState`, `settled|queued` dispatch, no
  `dataSync` key, umbrella exports). Grok launches: 1 of 6.
- **GPT outcome:** received and written verbatim to the codex artifact
  on receipt. **NOT READY** (6 MATERIAL; direction retained) bound to
  r1, hash verified in-capsule. MATERIAL set: (1) the synthesized query
  identity is self-referential — `normalizedDataQueryId` hashes a core
  containing `resolution.functionId`/`exportedName`, but a no-match
  query's exported name embeds a prefix of that same id; no fixed point
  exists (resolve via an acyclic pre-resolution template witness, the
  0253 bootstrap-projection pattern); (2) the descriptor/admission
  boundary is not a closed protocol — undefined
  `DataFilterTemplateV1`/`DataCursorV1`/`DataQueryExplainV1`, no slot
  algorithm, and no request carrier (the shipped `/query/<name>` posts
  only `args`/`auth`/`read_set`, so "server admits the witness" is
  unimplementable as written; a security-boundary defect); (3)
  multi-chunk transactions have no authoritative execution carrier
  (shipped wire = one Mutation reference + one `clientMutationId` per
  request; sequential calls violate atomicity; unversioned batch
  endpoints violate 0254's non-goals); (4) the online-only ambiguity
  amendment requires a settlement ledger while S7.2's
  `target-no-settlement-ledger` reason admits online-only exactly where
  it is absent; the 0043 refusal-ledger transitions are unspecified;
  `intentId` vs `clientMutationId` equality unstated; (5) operation
  contracts and capability facts are not frozen — shipped delete lowers
  to a `{kind:"unknown"}` result contract; no deterministic derivation
  table for `retained`/`offlineCustody`; (6) the LLP 0238
  reconciliation silently amends D3's handle grammar (state-bearing
  listener vs no-arg `subscribe`) and removes React `refresh` without
  the promised replacement facade. Implementer probe: declaration and
  generated surface determinate (matches Grok's enumeration; the
  Appendix A query "should resolve to the existing `todos.list`");
  result/refusal contracts, capability facts, synthesized identity, and
  the full admission pipeline UNDERDETERMINED per the MATERIALs.
  Deviations disclosed (skill-file read; failed OS-cache accesses from
  a `strings` invocation). GPT launches: 1 of 6.
- **Claude outcome:** received and written verbatim to the claude
  artifact on receipt. **NOT READY** (2 MATERIAL, 7 DETAIL; direction
  retained) bound to r1 (recorded identity). MATERIAL set: (1) the
  synthesized-query witness is circularly defined — the hashed core
  embeds `resolution.exportedName`, which for synthesized members embeds
  16 hex digits of the witness itself; no fixed point is constructible
  (fix: hash the pre-resolution template core, then derive name →
  resolution, with `resolution` moved out of the hashed core); (2) two
  closed-grammar terms — "structured or relation fields" (S5.2) and
  "relation-incarnation field" (S1.2) — are undefined and ambiguous
  over ordinary `v.id` foreign-key fields (LLP 0110, which owns the
  relation-incarnation stamp, is uncited), so conforming
  implementations can disagree on eligibility and filter admission.
  DETAILs: promotion `--format familiar` can never preserve generated
  prediction for owner writes (say it); the 0253 `.sync()` disposition
  change rides outside the S3 amendment protocol; `capabilities.
  retained` derivation unspecified (false-in-v1 pin needed); generated
  `get` has no tiny-doorway route; the `intentId` ↔ `clientMutationId`
  identity is implied never stated; appId enters the "profile-neutral"
  cores via `functionId` (state the fixed-appId equality condition or
  move ids to envelopes); the new `public-read.v1` read profile's
  soundness ownership (LLP 0065 OQ2 / LLP 0080) is unnamed;
  `DataDiagnosticV1` alias untyped. Its probe: the authoring surface
  and generation enumeration are DETERMINED (matching both other
  families); the A1 query resolves to `todos.list` in its reading;
  admission is determined to Spec altitude with the wire form and
  explain locus as implementation-phase residuals. It also verified
  every S0 ground-truth citation it checked as accurate at the cited
  lines, and endorsed the S3 amendment discipline as "a model for the
  corpus". Claude launches: 1 of 6.

### Round 1 result

**No READY verdict; Claude remains in the pool.** All three families
retain the direction explicitly — zero DIRECTION-DISSENT. The MATERIAL
union clusters cleanly: (A) the self-referential synthesized query
identity (GPT M1 + Claude M1, independent discoveries of the same
cycle); (B) function-slot matching vs the reused CRUD result contracts
(Grok M1 — the other two families' probes assumed the A1 exact match
works, which Grok's result-contract evidence refutes; no factual
contradiction, Grok simply went one layer deeper); (C) query
descriptor/admission closure incl. the undefined template/cursor/
explain types, slot algorithm, and wire carrier (Grok M2 + GPT M2 +
Claude M2's undefined eligibility terms); (D) the multi-chunk
transaction identity/carrier (Grok M3 + GPT M3); (E) retention/
capability freezing incl. the sync-retention bundling and the delete
result contract (Grok M4 + GPT M5 + Claude D5); (F) settlement
identity and the online-only ambiguity ledger (Grok M5 + GPT M4 +
Claude D7); (G) the 0238 D3/D4 reconciliation completeness (GPT M6 +
Grok D9). Altitude splits (MATERIAL vs DETAIL) exist on E/F/G but no
family disputes another's facts. Proceeding to the r2 revision
(reviser: the orchestrating session) applying the full union.

## Revision r2 — 2026-08-13 (reviser: the orchestrating Claude session)

- **r2 SHA-256:**
  `3c532efdc4ac7edafcd4f71153e34ad36dc093dd8bcdd155e3b633ebf7dcfdf2`
  (77,400 bytes; +19.6% net over the entering revision, inside the ~20%
  budget with almost no headroom — a further round needing growth will
  require an author-delegate allowance, disclosed in advance as in the
  0254 run). `./ref-check` 0 errors at r2.
- **Synthesis (the full round-1 union):** cluster A (self-referential
  identity) → resolution moved out of both hashed cores with a normative
  acyclic construction order; cluster B (unsatisfiable exact match) →
  the read contracts named as this Spec's own `data-resource.v1` page
  profile with S6.1 candidates drawn from the data lowerer's operations;
  cluster C (protocol closure) → closed `DataFilterTemplateV1`/
  `DataCursorV1`/`DataQueryExplainV1`, slot algorithm, scalar→`eq`
  canonicalization, cursor-as-`after`-argument (inside the QMK preimage,
  no 0157 amendment), the route-to-catalog wire rule, and the LLP 0110
  definitions of the two ambiguous terms with bare-`v.id` admissibility;
  cluster D (transaction identity) → new S7.1b: chunk-mutation vs
  synthesized-batch resolution (`data.tx_<hex16>`, one HostPlan, one
  `clientMutationId`, LLP 0043 replay as one ordinary mutation);
  cluster E (retention/capabilities) → `retained:false` v1 pin with the
  named admission path, deterministic capability derivation, closed
  delete contract, corrected S1.3 wording; cluster F (settlement
  identity/ledger) → `intentId` = canonical `clientMutationId`
  byte-for-byte, ledger-gated dispatch with `target-no-settlement-ledger`
  removed from the reason enum, and the LLP 0043 refusal-ledger
  extension; cluster G (0238) → D3-conformant notify-only subscribe,
  S3.3 scoped to D4, refresh routed via `db.watch`. DETAILs: S3.5
  successor disposition for 0253; no-drop table re-pointed at the
  canonical function record; get-route pinned out of the tiny builder
  with the concept-count note; familiar-promotion refusal stated;
  app-neutral cores (appId only in envelopes); `AuthorityCaptureV1` and
  `DataDiagnosticV1` pinned to existing owners; provisional-id
  reconciliation; `transactionCatalog` in the semantic input.

## Round 2 — 2026-08-13 (delta round)

- **Revision:** r2 as above. Topology unchanged: three families (no
  READY in round 1), lockstep, one shared capsule.
- **Capsule:** APFS clone of the round-1 capsule (same base
  `e15064b46dd4afdfc57603a3cc079e67096cca72`) with the r2 target
  overlaid and round-2 instructions replacing round-1's; zero
  `llp/reviews/0255*` files. In-capsule target hash verified equal to
  r2. Inventory SHA-256:
  `108098949a3764c4ec243124ca81b3d4a2b372d7d37f3f1a1a2bdfbe5e4402bf`.
- **Instruction SHA-256:**
  `128c3cc314a3f414c25d73ade5e54462fd99fb65cc00546dfa5081e7779d7e5f`.
- **Lens:** delta round (19-item r1→r2 delta enumerated; IN-DELTA vs
  PRE-EXISTING classification required), adversarial focus on the new
  text (including whether one HostPlan can express a 16-chunk batch in
  the shipped plan machinery), plus a bounded implementer probe: the
  full `db.useQuery` admission path including wire binding, and the
  complete identity/replay story for a three-chunk `db.transact`.
- **Launches (concurrent, after this record was persisted):** Claude
  family — same headless max-effort configuration, launch 2; GPT
  family — same codex invocation, launch 2; Grok family — same grok
  invocation, launch 2.

### Author ruling — 2026-08-13 (mid-round 2, before any round-2 verdict landed)

The human author ruled: **"you can let this spec grow a bit larger than
we normally budget."** This supersedes the ~20% guideline for this loop:
subsequent revisions may exceed it without a separate delegate allowance.
The reviser applies it prudently — contract-closure substance only, exact
net growth disclosed at each revision record, and an escalation back to
the author if a revision would run far beyond "a bit" (the reviser reads
the ruling as comfortable headroom to roughly one-third over the entering
revision). The ruling arrived while round 2 was in flight and changes no
capsule or instruction bytes; it governs revision budgeting only.

- **GPT outcome:** received and appended verbatim to the codex artifact
  on receipt. **NOT READY** (7 MATERIAL, 1 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained) bound to r2, hash and size
  verified in-capsule. MATERIAL set, all against r2's new text: (1) the
  S7.1b closed batch-result tuple is not expressible by the shipped
  HostPlan machinery — one `return_value`, no array/tuple `ValueExpr`
  constructor, and standard plans reuse internal binding names
  (`__standardOwnedRow`) that concatenation would collide, so the
  synthesis needs a reviewed evaluator extension or a closed record
  result plus deterministic alpha-renaming and a worst-case 16-chunk
  ceiling proof; (2) chunk `operationHash` is undefined and its shipped
  namesake embeds appId/implementation/activation — defeating the
  app-neutral-core claim; (3) `settlementIdentity` drops LLP 0043's
  required axes (function identity, canonical input, auth fingerprint,
  authority instance); (4) `AuthorityCaptureV1` names the wrong corpus
  artifact — the shipped name is LLP 0059's process-fence capture (which
  carries the `custodyRevision` axis LLP 0043 deliberately excludes),
  not 0043's three durable records; (5) the slot→generated-parameter-
  name mapping and absent-`after` encoding are undefined, and the list
  contract says "no public arguments" while the read profile adds
  optional `after`; (6) with `target-no-settlement-ledger` removed,
  target replay incapability has no representable custody reason
  (replay ≠ ledger); (7) two r2 leftovers (S5.4 conditional-retention
  sentence; the Acceptance retained-transitions line) contradict the
  new unconditional `retained:false` pin. DETAIL: the promised
  fail-closed no-drop table is asserted but not enumerated. Probes: A
  and B both fail pending those fixes; the delta list verified honest;
  no pre-existing MATERIAL. GPT launches: 2 of 6.
- **Grok outcome:** received and appended verbatim to the grok artifact
  on receipt. **NOT READY** (3 MATERIAL, 2 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained) bound to r2, hash and size
  verified in-capsule. MATERIAL set: (1) the `data-resource.v1` read
  profile is not expressible as an ordinary generated Query — shipped
  result kinds are Documents/Records only (`Value` illegal on queries),
  single-table `QueryPlan` never mints a cursor (`QueryOutput.cursor`
  absent for non-relational queries), keyset pagination is a separate
  first/next helper family gated on a unique index, and S5.3's
  `(order,_id)` continuation is exactly LLP 0065's still-open OQ1 —
  while S3.4 declines the LLP 0004 amendment that would authorize any of
  it and S2 still says list has "no public arguments" (three named
  resolutions; converges with GPT M5's contradiction); (2) the S7.1b
  batch **writes** are feasible on shipped machinery (multi-step plans
  within the 64-step ceiling in one storage transaction — cited) but the
  closed result tuple is not (`ValueExpr` has no array constructor;
  `v.tuple` caps at 8; mutation results are document/value only) — pin a
  record-based lowering (`c<position>` keys, `results.value(v.object)`,
  TS tuple view, 0-based positions) or file the evaluator amendment;
  (3) the wire rule never names the slot→argument-name function (range
  needs two names; a field named `after` collides; omitted-vs-null
  `after` changes the QMK preimage) — publish the closed naming table
  and pin list's args contract. DETAILs: the S3.2 refusal-ledger pin
  silently inverts LLP 0043:374-375 (quote and supersede; name
  `offline_mutation_replay` as the dispatch predicate); catalogue
  admission not closed (no transaction not-catalogued code; position
  radix unstated; `AuthorityCaptureV1` lives in LLP 0059 not 0043 —
  GPT M4 at DETAIL altitude; the no-drop table still not enumerated —
  GPT D8; the S5.4 retention leftover — GPT M7; S3.4/S3.5 ordering).
  Probes: admission stated to the wire with three defective
  underdeterminations; the three-chunk replay story otherwise closed
  and 0043-conformant. Grok launches: 2 of 6.
- **Claude outcome:** received and appended verbatim to the claude
  artifact on receipt. **NOT READY** (2 MATERIAL IN-DELTA; 6 DETAIL —
  5 IN-DELTA, 1 PRE-EXISTING; zero PRE-EXISTING MATERIAL; direction
  retained) bound to r2 (recorded identity; full 1,582-line read).
  MATERIAL: (1) S2's list "no public arguments" contradicts the read
  profile's optional `after` — load-bearing because page 2 of an
  exact-matched template invokes the same member with `after` and would
  refuse at shipped argument validation (fix: every data read's
  argument contract is exactly `{after?}` / `{id}`); (2) the slot
  parameter names are never pinned though they enter canonical
  arguments, the QMK preimage, and the Swift byte-identical goldens
  (fix: pin the naming grammar in S6.2). DETAILs: S7.1b is expressible
  — a `Record` return over post-write `Get` bindings with records-kind
  contracts carries the closed result (narrowing GPT M1 to the "tuple"
  wording and agreeing with Grok's record lowering) — but the natural
  lowering exactly saturates `MAX_PLAN_STEPS=64` at 16 update chunks
  and the Spec must name the shipped bounds and per-chunk step budget;
  the cursor's `argsDigest` is self-referential as written and S12 has
  no cursor refusal code; the `SNAPBACK_DATA_CUSTODY_UNAVAILABLE` next
  action is dead advice for ledgerless targets; read operations'
  mandatory `custody` value is unspecified; the `data.` namespace
  reservation misses authored dotted exports; the S5.4/Acceptance
  retention leftovers (PRE-EXISTING-classified, same facts as GPT M7);
  an editorial cluster (S3.4/S3.5 order, positional-vs-named arguments
  note, the store-cap sentence's record-vs-row comparison). Its probes
  state both paths end-to-end with the named gaps as the only blockers,
  and its direction assessment flags one product consequence for the
  author's eyes: v1 leaves familiar applications with no owner-write
  promotion path, making the future familiar×tiny 2×2 depend on a
  familiar grammar change (stated in the Spec, deferred to the D9
  Plan). Claude launches: 2 of 6.

### Round 2 result — delta-convergence condition met; one round remains

**Zero PRE-EXISTING MATERIAL across all three families** — the delta
condition holds at round 2, with every MATERIAL in r2's own new text.
The families converge rather than conflict: the read-profile executor
gap (Grok M1, Claude C1, GPT M5's contradiction half), the batch-result
lowering (GPT M1's infeasibility, narrowed by Grok M2's write-half
evidence and Claude C3's record-return construction to a
record-not-tuple fix plus named bounds), the wire naming grammar (Grok
M3, GPT M5, Claude C2), the identity artifacts (GPT M2 `operationHash`,
GPT M3 settlement axes, GPT M4/Grok-D5 `AuthorityCaptureV1`
misreference), the custody vocabulary (GPT M6, Claude C6), and the
retention leftovers (GPT M7, Claude C8, Grok D5). **Author-delegate
ruling:** proceed to revision r3 closing the full in-delta union under
the author's growth allowance, then run round 3 as the final delta
round of the budget.

## Revision r3 — 2026-08-13 (reviser: the orchestrating Claude session)

- **r3 SHA-256:**
  `2d5476688b623745f53182cbb1b3831822777a7244144d3935085d6a00d14be4`
  (85,877 bytes; +32.6% net over the entering revision — beyond the
  ordinary ~20% guideline under the author's recorded mid-round growth
  ruling, disclosed exactly). `./ref-check` 0 errors at r3.
- **Synthesis (the full round-2 union):** reads rehomed onto shipped
  `documents` contracts with `DataPageV1` as facade and a new dated
  S3.4 LLP 0004/0065-OQ1 keyset-continuation amendment (replacing the
  no-0004-amendment overclaim; old S3.4 → S3.6, narrowed; ordering
  fixed); every read's args contract pinned (`{after?}` / `{id}`); the
  batch result lowered to a closed record over post-write bindings with
  named shipped ceilings and deterministic binding renaming; the closed
  slot-naming grammar; chunk `planHash` replacing the app-scoped
  `operationHash`; the full LLP 0043 settlement tuple;
  `DurableReplayAuthorityV1` (0043's three records) replacing the
  misreferenced 0059 fence capture; dispatch-time `targetCustody` with
  the core custody kept intrinsic; nullable custody for reads; the 0043
  refusal-sentence supersession quoted and scoped with named target
  predicates; `argsDigest` de-circularized; retention leftovers
  scrubbed (S5.4 + Acceptance); cursor and transaction-catalogue
  refusal codes added; the `CUSTODY_UNAVAILABLE` action split; the
  `data.` namespace reservation extended; the no-drop disposition table
  enumerated; the store-cap sentence corrected.

## Round 3 — 2026-08-13 (final delta round)

- **Revision:** r3 as above. Topology unchanged: three families (still
  no READY), lockstep, one shared capsule. Final round of the budget.
- **Capsule:** APFS clone of the round-2 capsule (same base
  `e15064b46dd4afdfc57603a3cc079e67096cca72`) with the r3 target
  overlaid and round-3 instructions; zero `llp/reviews/0255*` files.
  In-capsule target hash verified equal to r3. Inventory SHA-256:
  `ffc057c71d318f19ca155905bdbb4aa5902518be0771f58eb75b7760f6502065`.
- **Instruction SHA-256:**
  `2a3226c2f5324ebffcbb51a959eadec1bcf8503487a65719942ab33aca5e5637`.
- **Lens:** final delta round (13-item r2→r3 delta enumerated;
  IN-DELTA/PRE-EXISTING required), adversarial focus on the S3.4
  amendment's `QueryOutput` characterization, the facade/contract split,
  the record-return construction, the new identity fields, and the
  naming grammar; probe = exact wire bytes for A1 pages 1 and 2, and
  the full three-chunk identity/custody/replay story with ceiling
  arithmetic.
- **Launches (concurrent, after this record was persisted):** Claude
  family — same headless max-effort configuration, launch 3; GPT
  family — same codex invocation, launch 3; Grok family — same grok
  invocation, launch 3.

### Author ruling — 2026-08-13 (mid-round 3, before any round-3 verdict landed)

The human author ruled: **"you can do up to 3 additional rounds if it
will make the spec better."** The round budget extends from three to up
to six (launch cap correspondingly 12 per family, voids included), with
the extension explicitly conditional: additional rounds run only when
they buy real fix-verification — that is, when a round leaves MATERIAL
in-delta concerns whose fixes deserve reviewed verdicts rather than an
unreviewed terminal label. The loop still ends early on convergence
(all pooled families READY on one revision, with the authorized Claude
pool-exit rule unchanged), on a delta-rule convergence the reviser
judges complete, or on a detail-horizon stop; the reviser will not run
extra rounds to churn altitude-dispositionable detail. Round 3, already
in flight, is therefore no longer necessarily terminal.

- **GPT outcome:** received and appended verbatim to the codex artifact
  on receipt. **NOT READY** (4 MATERIAL, all IN-DELTA; zero PRE-EXISTING
  MATERIAL; direction retained) bound to r3, hash and size verified
  in-capsule. It confirms the two big r3 constructions are sound on
  shipped machinery (documents/facade split; `ReturnValue::Expr(Record)`
  batch return) and its probes produce exact wire bytes (page 1 `{}`;
  page 2 `{"after":"<C1>"}`) and the full three-chunk ceiling
  arithmetic. MATERIAL set: (1) r3's `settlementIdentity` neither covers
  LLP 0043/0133's complete ledger identity (input fingerprint spans
  `{args, readSet, ctxLedger}` plus lane/implementation/claims/skew) nor
  coexists with the shipped wire field of the same name
  (`settlementIdentity:{implementationHash,activation}` in generated
  IR) — rename the projection and reference the server-derived
  identity; (2) the "ledger-bearing but replay-incapable" target state
  is unrepresentable — `offline_mutation_replay` IS the ledger
  advertisement in the shipped registry, so the
  `online-only-target-no-replay` branch is unreachable without a new
  owner-ratified capability; (3) the S12 missing-store remediation
  ("use a declared online-only operation") contradicts S3.2's mandatory
  durable observation — a durable client store must be required for
  every data write; (4) `DataCursorV1` carries no MAC/mint proof, so
  `lastKey` is caller-rewritable — weaker than the shipped HMAC'd
  standard-pattern cursor; reuse the established cursor-key authority
  and state mint-failure and key-retention dispositions. GPT launches:
  3 of 12 (extended cap).
- **Grok outcome:** received and appended verbatim to the grok artifact
  on receipt. **NOT READY** (1 MATERIAL, 3 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained) bound to r3, hash and size
  verified in-capsule. Its MATERIAL: `DataPageV1` is simultaneously the
  client facade and the hashed result contract across S2/S3.4/S6.1 —
  pin three layers once (hashed function contract = shipped
  `documents`/`document` kinds; executor/wire = `QueryOutput` with
  cursor **absent** on exhaustion, never JSON null; `DataPageV1` =
  facade only, excluded from every hash preimage) and use those nouns
  everywhere. DETAILs: the no-drop table misses shipped
  `FunctionDefinition` fields (`kind`, `apiExposure`, `publicInline`,
  `authorityProfileDependence`, `syncabilityClass`,
  `permissionEpochBumps`, `bundleEntrypoint`, `uses`, `runtime`;
  `authScopeField` rides under `readSetSummary`); the S2 "every data
  read" args sentence needs scoping to resource-lowered list/get (S6.2
  descriptors carry slot keys); the transaction `canonicalArguments`
  array vs the named wire object leaves two legal digest preimages —
  pin the digest over the JCS named object. Its probes validate the
  rest to exact wire bytes and ceiling arithmetic (9 steps for the
  three-chunk form), and it explicitly endorses S3.4's scoping inside
  LLP 0254's non-goals. Cross-family altitude/fact note: Grok accepted
  the ledger-bearing-but-replay-incapable target state that GPT's
  registry-level evidence shows is unrepresentable; the r4 fix follows
  GPT's stronger evidence (require `offline_mutation_replay` for every
  v1 data write). Grok launches: 3 of 12 (extended cap).
- **Claude outcome:** received and appended verbatim to the claude
  artifact on receipt. **NOT READY** (1 MATERIAL, 6 DETAIL — all
  IN-DELTA; zero PRE-EXISTING MATERIAL; direction retained) bound to r3
  (recorded identity; full 1,715-line read; ~30 code citations verified
  accurate). Its MATERIAL independently converges with GPT M2, same
  registry citation: `OfflineMutationReplay` support is defined as
  `client_mutation_settlement_ledger_registered`, so S3.2's two
  predicates are one advertisement bit, the
  `online-only-target-no-replay` value is unmintable, and S7.2's
  degradation sentence conflicts with its own admission rule inside
  ratification-bound amendment text. It also **adjudicates GPT M4's
  cursor-MAC dispute on the facts**: the transparent cursor is sound
  for the v1 policy classes — every bound field except `lastKey` is
  server-recomputable, and a forged `lastKey` only repositions the
  caller inside their own policy-composed bounded query, equivalent to
  an already-admissible range filter — so the repair is to fix the
  "server-minted" claim and add the mint-failure disposition, not to
  make a MAC a security boundary. DETAILs: the missing-store
  remediation loop (GPT M3 at DETAIL altitude); no named mint-failure
  disposition (shipped precedent
  `SNAPBACK_STANDARD_PATTERN_CURSOR_MINT_UNAVAILABLE`); S3.4's relation
  to `single_table_v1`'s no-public-cursor class unstated; the
  collision-refusal scope (per-table vs per-template) undetermined; the
  `data.` reservation's zero-resource interaction unstated; two
  residual facade/canonical phrases (Grok M1 at DETAIL altitude).
  Claude launches: 3 of 12 (extended cap).

### Round 3 result — delta condition met a third time; extended budget continues

**Zero PRE-EXISTING MATERIAL across all three families for the third
consecutive round.** MATERIAL union: the capability-registry collapse
(GPT M2 + Claude C1, independent same-citation discoveries; Grok's
probe accepted the unrepresentable state — GPT/Claude's registry
evidence governs), the settlement-identity rename/completeness (GPT
M1), the durable-store requirement (GPT M3, Claude C2-DETAIL), the
cursor authenticity claim (GPT M4, resolved per Claude's
repositioning-equivalence analysis as a claim/disposition fix), and the
three-layer facade/contract pin (Grok M1, Claude C7-DETAIL). Under the
author's extended-rounds ruling this is a productive fix-verify cycle:
**author-delegate ruling — revise r4 closing the union (following
GPT/Claude on the registry, Claude on the cursor), then run round 4 as
a verification delta round.** Growth will run slightly past the
one-third reading of the author's allowance (~+37% est.); disclosed
here and at the r4 record rather than trimming reviewed content.

## Revision r4 — 2026-08-13 (reviser: the orchestrating Claude session)

- **r4 SHA-256:**
  `66bc954966e29f57efc4914538100a65581dafd18b7673e423f1ffda2794a7a8`
  (90,194 bytes; **+39.3% net over the entering revision** — past the
  reviser's one-third reading of the author's "a bit larger" allowance;
  every addition is a round-3 review-demanded fix, the exact figure is
  disclosed here and in the next user-facing summary, and the author
  may order trimming). `./ref-check` 0 errors at r4.
- **Synthesis (the full round-3 union):** the registry collapse
  (GPT M2 + Claude C1 — one advertisement, `targetCustody` reduced,
  the S7.2 degradation cell removed, the future registry amendment
  named); `ledgerIdentity` rename + completion against LLP 0133 with
  the shipped `settlementIdentity` wire field untouched (GPT M1) and
  the named-object digest preimage pinned (Grok D4); the durable-store
  requirement for every data write (GPT M3 + Claude C2); the cursor
  authenticity claim rescoped per Claude's repositioning-equivalence
  adjudication of GPT M4, with the mint-failure disposition and S12
  rows (Claude C3); the three-layer noun pin applied at every site
  (Grok M1 + Claude C7); the S3.4 exhaustion/absent fix and
  `single_table_v1` class exclusion (Grok M1 + Claude C4); the no-drop
  table completed over the shipped `FunctionDefinition` fields
  (Grok D2); the S2 scope fix (Grok D3); the collision rule
  table-scoped (Claude C5); the `data.` reservation made conditional
  (Claude C6).

## Round 4 — 2026-08-13 (verification delta round; extended budget)

- **Revision:** r4 as above. Topology unchanged: three families,
  lockstep, one shared capsule. Round 4 of up to 6 per the author's
  extension.
- **Capsule:** APFS clone of the round-3 capsule (same base
  `e15064b46dd4afdfc57603a3cc079e67096cca72`) with the r4 target
  overlaid and round-4 instructions; zero `llp/reviews/0255*` files.
  In-capsule target hash verified equal to r4. Inventory SHA-256:
  `6dd25b345c207d7960950735b198035b79898574c9de876928912046feb56150`.
- **Instruction SHA-256:**
  `7000adbe7597200633a507d2f08a04411534453f75f18d71064e4e3e6cd99354`.
- **Lens:** verification delta round (12-item r3→r4 delta enumerated;
  IN-DELTA/PRE-EXISTING required); adversarial focus on the registry
  collapse, `ledgerIdentity` completeness/collision-freedom, the cursor
  reasoning's soundness for both policy classes, layer-noun
  consistency, and no-drop completeness; probe = the complete v1
  target-capability story and the three-chunk ledger identity
  field-by-field.
- **Launches (concurrent, after this record was persisted):** Claude
  family — same headless max-effort configuration, launch 4; GPT
  family — same codex invocation, launch 4; Grok family — same grok
  invocation, launch 4.

### Author ruling — 2026-08-13 (mid-round 4, before any round-4 verdict landed)

The human author ruled: **"length allowance can be 2.5x."** The growth
budget for this loop is now 2.5× the entering revision (64,741 bytes →
ceiling ≈ 161.9 KB), superseding both the ~20% guideline and the earlier
"a bit larger" allowance and its one-third reading. r4's +39.3%
(90,194 bytes) sits well inside the new ceiling, retiring the
trim-or-escalate question flagged at the r4 record. The reviser still
adds only review-demanded or contract-closure substance — the ceiling is
headroom, not a target — and continues to disclose exact net growth at
every revision record. The ruling changes no in-flight capsule or
instruction bytes.

- **Grok outcome:** received and appended verbatim to the grok artifact
  on receipt. **NOT READY** (2 MATERIAL, 2 DETAIL IN-DELTA + 1 DETAIL
  PRE-EXISTING; zero PRE-EXISTING MATERIAL; direction retained) bound
  to r4, hash and size verified in-capsule. It endorses every r4
  architectural decision and digs into the settlement executor to prove
  two closures incomplete: (1) `ledgerIdentity` is still not mintable
  or comparable — the shipped `mutation_input_fingerprint` is SHA-256
  over **key-sorted JSON** of `{args, readSet, ctxLedger}` with the
  `settlement` object omitted iff default (not the Spec's JCS/domain
  scheme); `readSet`/`ctxLedger` sources are unpinned;
  `authorityFingerprint` is the shipped `auth_fingerprint` over request
  `AuthInput` and is not derivable from `DurableReplayAuthorityV1`; two
  different "keys" are both called the settlement key while the shipped
  lookup is find-by-`clientMutationId` then compare
  function/auth/authority-instance/input-fingerprint/issuance — split
  the client replay key from the server ledger identity, pin the real
  fingerprint, name the digest domain string, and state the
  `MutationSettlement` default; (2) the r4 "canonical kinds" list makes
  `get → document` unrepresentable — `document` is a mutation-side
  kind, shipped query admission accepts only `documents`/`records`, and
  JSON null violates a `document` contract — hash get as `documents`
  (0-or-1 row, facade projects `[]→null`), spell delete as
  `{kind:"value", value: Null}`, and tighten S6.1's parenthetical to
  list-shaped candidates. DETAILs: the cursor "semantically equivalent"
  phrase overclaims (own S3.4 says the compound tie-break is
  inexpressible as a filter — say "no additional privilege"; the
  security claim itself is verified sound); the no-drop table needs a
  `retentionClass: absent` row and `requires` moved to S11;
  (PRE-EXISTING) the resource-read args sentence should list the two
  shapes. Grok launches: 4 of 12.
- **GPT outcome:** received and appended verbatim to the codex artifact
  on receipt. **NOT READY** (3 MATERIAL, all IN-DELTA; zero PRE-EXISTING
  MATERIAL; direction retained) bound to r4, hash and size verified.
  Converges with Grok on all three topics and deepens each: (1)
  `ledgerIdentity` — the server ledger compares the invocation **name**,
  not the `{appId}:` function id; the fingerprint algorithm is the
  shipped canonical-JSON scheme with no domain prefix and a conditional
  `settlement` nesting; the issuance-bearing identity path
  (`operationIdentityProtocol:1`, artifact-generation comparison) is
  neither included nor forbidden; the two-keys contradiction stands —
  define the server identity field-for-field or stop calling the client
  assertions the server tuple; (2) the no-drop table's
  `requiredCapabilities` row points at a nonexistent core member,
  `EffectCeilingV1` (version/basis/indexed reads/write ops/host
  ops/authorization inputs) is collapsed to `"read"|"write"` despite the
  copied-from-canonical claim, `readSetSummary.mode`/`primaryTable` are
  unaccounted, and a top-level iterator cannot catch subfield loss —
  carry the exact canonical records or define lossless derivations with
  recursive parity; (3) the cursor "range-filter equivalence" is false
  (strict continuation needs the disjunction the shipped keyset lowerer
  emits; the tiny grammar cannot author the `_id` tie-break) — replace
  with an explicit suffix/non-widening proof plus named negative cases
  (another owner's boundary, nonexistent tuples, duplicate/null order
  values, both directions), or require a MAC; the security conclusion
  itself is not disputed, the proof is. GPT launches: 4 of 12.
- **Claude outcome:** received and appended verbatim to the claude
  artifact on receipt. **NOT READY** (1 MATERIAL, 6 DETAIL — 5
  IN-DELTA, 1 PRE-EXISTING; zero PRE-EXISTING MATERIAL; direction
  retained) bound to r4 (recorded identity; full 1,778-line read). It
  verifies the four pressed checks substantially pass — the predicate
  collapse is registry-exact, the rename collision-free on every
  carrier, the cursor scoping sound (adding the no-existence-oracle
  observation), the three nouns consistent everywhere, and all 36
  shipped `FunctionDefinition` fields disposed — and isolates the
  settlement-key contradiction (line 852 vs 877 vs S3.2) as its sole
  MATERIAL with a one-sentence repair, noting the single-chunk case
  proves the witness is not server key material. DETAILs:
  `canonicalArgsDigest`'s lead phrase wrongly includes `after` for
  paged reads (the parenthetical is right); `Related` omits the
  now-load-bearing LLP 0133/0058/0059; the binary write gate's
  deployment reach is unstated — Cloudflare serves zero tiny data
  writes and the non-durable Expo File/Directory adapter serves zero
  while S9 plans an Expo reexport (correct, fail-closed, must be
  named); the S2 get-sentence contradicts its own parenthetical; the
  no-drop `requires` entry names a field the shipped record lacks;
  (PRE-EXISTING) the schema-field collision refusal uses a query-shape
  code whose next action doesn't fit. Claude launches: 4 of 12.

### Round 4 result — convergent; one more fix-verify cycle authorized

**Zero PRE-EXISTING MATERIAL across all families for the fourth
consecutive round.** The three families converge on one topic map:
(A) the ledger-identity contract — Claude's minimal-repair reading of
the two-keys contradiction plus Grok/GPT's executor-level proof that
the fingerprint, name-vs-id comparison, `MutationSettlement` default,
and issuance-path disposition must be pinned to shipped bytes; (B)
no-drop completeness over the canonical records (`requiredCapabilities`
member, `EffectCeilingV1`/dependency summaries carried whole with
recursive parity, `retentionClass`, `requires` relocation); (C) the
cursor proof rewritten as suffix/non-widening with named negative
cases (GPT M3 + Grok D3; Claude's soundness verification supplies the
no-existence-oracle limb); (D) `get`/`delete` re-kinded onto
representable contracts (Grok M2). Claude's deployment-reach DETAIL is
adopted as a named consequence. **Author-delegate ruling:** revise r5
closing the full union, then run round 5 (of the authorized 6) as the
verification round.

## Revision r5 — 2026-08-13 (reviser: the orchestrating Claude session)

- **r5 SHA-256:**
  `02afe7cfa8fd784c1741b7d8f0ea040d99c265c0348100f6c279a27e6ce8ea1b`
  (93,254 bytes; +44.0% net over the entering revision, inside the
  author's 2.5× ceiling). `./ref-check` 0 errors at r5.
- **Synthesis (the full round-4 union):** the ledger-identity
  restructure (Grok M1 + GPT M1 + Claude C1) — `ledgerIdentity` replaced
  by the client-only `replayKey`, the server settlement identity
  described as server-rebuilt (name comparison, server-derived auth
  fingerprint, authority instance from the durable descriptor, the
  shipped key-sorted-JSON input fingerprint with omit-iff-default) with
  the three v1 pins (default `MutationSettlement`; IR-filled
  `readSet`/`ctxLedger`; issuance carrier out of v1), the settlement-key
  sentence repaired per Claude's minimal fix, and the
  `canonicalArgsDigest` domain string named and `after`-exclusive
  (Claude C2); no-drop completeness (GPT M2 + Grok D4 + Claude C6) —
  `effectCeilingClass` as a named derived classification with the full
  canonical records riding whole under a recursive parity assertion,
  `requiredCapabilities` on every operation with
  `offline_mutation_replay` pinned on writes, `retentionClass: absent`,
  `requires` relocated; the cursor suffix/non-widening proof with the
  named negative cases (GPT M3 + Grok D3 + Claude's no-existence-oracle
  limb); `get`/`delete` re-kinded inside the shipped grammar with S6.1
  narrowed to list-shaped candidates (Grok M2, Grok D5, Claude C5); the
  deployment-reach consequence named (Claude C4); the collision refusal
  re-routed to `SNAPBACK_DATA_RESOURCE_INELIGIBLE` (Claude C7); Related
  gains LLP 0058/0059/0133 (Claude C3).

## Round 5 — 2026-08-13 (verification delta round; extended budget)

- **Revision:** r5 as above. Topology unchanged: three families,
  lockstep, one shared capsule. Round 5 of the authorized 6.
- **Capsule:** APFS clone of the round-4 capsule (same base
  `e15064b46dd4afdfc57603a3cc079e67096cca72`) with the r5 target
  overlaid and round-5 instructions; zero `llp/reviews/0255*` files.
  In-capsule target hash verified equal to r5. Inventory SHA-256:
  `3c94f040d3002ab70a7dbd21fd7b04de127cbe7663eb37e3a77e4ef3106cc3dd`.
- **Instruction SHA-256:**
  `e791e6890d26320160de34fd637abdf0ae6dcecf47062fe781a6958b7eb87176`.
- **Lens:** verification delta round (10-item r4→r5 delta enumerated;
  IN-DELTA/PRE-EXISTING required); adversarial focus on the
  server-rebuilt settlement identity vs the shipped comparison, the v1
  pins, the re-kinded contracts, the suffix proof, and the recursive
  no-drop assertion; probe = the exact server-side duplicate-settlement
  comparison for a three-chunk batch, plus confirmation the pagination
  and target-capability stories stand.
- **Launches (concurrent, after this record was persisted):** Claude
  family — same headless max-effort configuration, launch 5; GPT
  family — same codex invocation, launch 5; Grok family — same grok
  invocation, launch 5.
- **Grok outcome:** received and appended verbatim to the grok artifact
  on receipt. **NOT READY** (1 MATERIAL, 3 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained) bound to r5, hash and size
  verified in-capsule. The MATERIAL: r5's "always send the default
  `MutationSettlement`" pin collides with the shipped generated-IR
  carrier — `prepareGeneratedMutationIrV1` always emits
  `settlementLane:"re-derive"` + codegen-owned `settlementIdentity` and
  `settlementClaims`, so real data writes take the include-settlement
  branch of the fingerprint, and r5's own "continues to carry
  generation pinning into the fingerprint's claims" sentence requires
  exactly that branch; resolution (A) — pin v1 to the shipped
  IR-derived settlement, keep omit-iff-default as the algorithm, name
  the compared members, drop "always default". DETAILs: the full
  canonical records are said to ride via `FunctionReference`, which the
  shipped reference object does not carry — retarget the disposition at
  the function-manifest record; the delete contract must be spelled
  `{kind:"value", value:{kind:"null"}}`; the issuance exclusion must be
  doorway-enforced (strip/refuse `operationIssuance` on data writes
  regardless of the host client's `operationIdentityProtocol`
  constructor flag). Probe (a) produced the complete five-row server
  comparison table; probe (b) confirms pagination and target stories
  unchanged. Grok launches: 5 of 12.
- **GPT outcome:** received and appended verbatim to the codex artifact
  on receipt. **NOT READY** (3 MATERIAL, 1 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained) bound to r5, hash and size
  verified in-capsule. MATERIAL set: (1) putting
  `offline_mutation_replay` into every write's canonical
  `requiredCapabilities` converts the stated dispatch gate into an
  artifact-wide deployment gate — codegen unions function requirements
  into the target artifact requirement and activation refuses install
  without them, so a data resource would not deploy on Cloudflare at
  all, contradicting the read-capable deployment-reach sentence;
  resolve via a named dispatch-scoped requirement projection (or choose
  undeployability explicitly); (2) the same settlement contradiction
  Grok found — its conditional second arm ("if `settlementIdentity`
  must travel, remove the default pin and specify the exact
  contribution") coincides with Grok's resolution (A), which the r6
  revision adopts; (3) "documents constrained to zero-or-one row"
  cannot encode cardinality in the shipped contract (`documents` has
  only table/document; bounds exist on `records`) — use `records` with
  `{minItems:0, maxItems:1}` or make the cardinality a plan invariant
  outside the hash; delete's explicit null contract is a lowering
  change the "unchanged" claim must acknowledge. DETAIL: state the
  authority-instance mapping chain (durable `authority.
  authorityDescriptor` → wire top-level `authorityDescriptor` →
  server-derived expected instance). Probes: the six-step settlement
  procedure and both standing stories confirmed determinate modulo its
  concerns 1–2; the cursor proof verified sound. GPT launches:
  5 of 12.
- **Claude outcome:** received and appended verbatim to the claude
  artifact on receipt. **NOT READY** (1 MATERIAL, 2 DETAIL — all
  IN-DELTA; zero PRE-EXISTING MATERIAL; direction retained) bound to r5
  (recorded identity; full 1,815-line read; the settlement-comparison,
  fingerprint, registry, Expo-adapter, ceiling, and kind-restriction
  citations all re-verified at the cited lines). Its MATERIAL is the
  definitive form of the round's shared defect: the "always default
  `MutationSettlement`" pin is impossible on the prediction-exact path —
  the shipped client throws on any optimistic layer without
  `settlementLane:"re-derive"`, and the IR carrier unconditionally
  emits the lane-L record — so the pin must split by prediction class:
  prediction-`none` writes carry the default (omit branch);
  generated-exact writes carry the deterministic codegen-owned lane-L
  record (`re-derive`, `settlementIdentity`, `settlementClaims` incl.
  `mints`, IR `boundedSkew`), included in the fingerprint, with
  determinism from outbox byte custody plus LLP 0133's fail-closed
  identity. DETAILs: the shipped comparison has a fifth member —
  operation-issuance equality, trivially `absent == absent` in v1 but
  the enforcement of the issuance exclusion; and the issuance exclusion
  creates a third zero-writes deployment class (coverage-active
  targets refuse identity-less mutations with
  `SNAPBACK_OPERATION_IDENTITY_REQUIRED`) that the reach paragraph must
  name. Its direction assessment: "a one-paragraph repair plus two
  DETAIL sentences should make r6 READY." Claude launches: 5 of 12.

### Round 5 result — one shared MATERIAL, resolutions unified; final round authorized

**Zero PRE-EXISTING MATERIAL across all families for the fifth
consecutive round.** The round's MATERIAL union: (1) the settlement pin
(all three families; Claude's split-by-prediction-class resolution
subsumes Grok's include-branch (A) and the conditional second arm of
GPT's (B)); (2) the `requiredCapabilities` deployment-gate conversion
(GPT M1 — the codegen union/activation evidence governs; resolve via a
dispatch-scoped projection so artifacts stay deployable read-capable);
(3) the get-cardinality encoding (GPT M3 — `records` with
`{minItems:0, maxItems:1}` carries the cardinality in the hashed
contract; delete's explicit null contract acknowledged as a named
lowering specialization in Grok's `{kind:"value", value:{kind:"null"}}`
spelling). DETAIL union: the carrying-vehicle retarget (Grok D2), the
doorway-enforced issuance strip (Grok D4) with Claude's fifth-member
and coverage-active-class sentences, and the authority-instance mapping
chain (GPT D4). **Author-delegate ruling:** revise r6 closing the full
union, then run round 6 — the final authorized round — as the
verification round.

## Revision r6 — 2026-08-13 (reviser: the orchestrating Claude session)

- **r6 SHA-256:**
  `6a75927becf51b8e02b494c0a033aa10a4df3bf088b7fc20646ce7ed801ad404`
  (95,344 bytes; +47.3% net over the entering revision, inside the
  author's 2.5× ceiling). `./ref-check` 0 errors at r6.
- **Synthesis (the full round-5 union):** the settlement pin split by
  prediction class per Claude's resolution (subsuming Grok's (A) and
  GPT's conditional arm) with the compared members named and the
  "always default" sentence deleted; the write-capability gate made
  dispatch-scoped (`dispatchRequiredCapabilities`) with canonical
  `FunctionDefinition.requiredCapabilities` unchanged so artifacts
  deploy read-capable (GPT M1); `get` re-kinded to bounded `records`
  `{0..1}` and delete's null contract spelled as the shipped node with
  the lowering specialization acknowledged (GPT M3 + Grok D3); the
  carrying vehicle retargeted to the canonical function-manifest record
  (Grok D2); the issuance exclusion doorway-enforced with the fifth
  comparison member named (Grok D4 + Claude D2); the coverage-active
  third zero-writes class named for the D9 Plan (Claude D3); the
  authority-instance mapping chain stated (GPT D4).

## Round 6 — 2026-08-13 (final verification delta round)

- **Revision:** r6 as above. Topology unchanged: three families,
  lockstep, one shared capsule. The final round of the authorized six.
- **Capsule:** APFS clone of the round-5 capsule (same base
  `e15064b46dd4afdfc57603a3cc079e67096cca72`) with the r6 target
  overlaid and round-6 instructions; zero `llp/reviews/0255*` files.
  In-capsule target hash verified equal to r6. Inventory SHA-256:
  `902324a85775be28d59ca5421db734f29ad6bce57d87ca890accd6b17fb95acb`.
- **Instruction SHA-256:**
  `b7e3bc738a16d1736129f1a81b4be3d0ac2f1d2bd78ff2a3f7903253fb8e59ee`.
- **Lens:** final verification delta round (7-item r5→r6 delta
  enumerated; IN-DELTA/PRE-EXISTING required); adversarial focus on the
  split settlement pin against both shipped carrier branches, the
  dispatch-scope split's deployability claim, and the bounded-`records`
  get contract; probe = the fingerprint preimages for a generated-exact
  batch and a prediction-`none` write, plus the deployment story.
- **Launches (concurrent, after this record was persisted):** Claude
  family — same headless max-effort configuration, launch 6; GPT
  family — same codex invocation, launch 6; Grok family — same grok
  invocation, launch 6.
- **Grok outcome:** received and appended verbatim to the grok artifact
  on receipt. **NOT READY** (1 MATERIAL, 3 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained) bound to r6, hash and size
  verified in-capsule. The MATERIAL is leftover cleanup the r6 edit
  missed: the S2 lead sentences ("reads keep the shipped canonical
  `documents` result contracts"; "not a new result kind"; "mutations
  reuse the CRUD lowering contracts unchanged") and S3.4's amendment
  paste ("read results remain canonical `documents`") still carry the
  pre-r6 claims and contradict the r6 pins below them (`get` →
  `records{0..1}`; the delete specialization) — following the lead
  mints different hashes than following the pins, and ratifying S3.4 as
  written would copy the stale claim into LLP 0004. DETAILs: the get
  `[]→null` projection has no named owner on the only consumption path
  (canonical consumers see the 0..1 array); the coverage-active class
  is a post-transport server refusal (`SNAPBACK_OPERATION_IDENTITY_
  REQUIRED`), not the S12 custody door, and D9 must not treat
  coverage-activated stores as write-capable; the facade must be bound
  to the IR-compose doorway for every generated-exact write including
  online-only (the shipped `queue:false` degrade would produce the
  prediction-`none` fingerprint and no paint). Its probe produced both
  fingerprint preimages byte-exactly (settlement included for
  generated-exact; omitted for prediction-`none`) and the four-row
  deployment table, all verified against the shipped carrier. Grok
  launches: 6 of 12.
- **GPT outcome:** received and appended verbatim to the codex artifact
  on receipt. **NOT READY** (3 MATERIAL, all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained) bound to r6, hash and size
  verified in-capsule. MATERIAL set: (1) "prediction class" is not a
  well-defined settlement-branch selector — the hashed core's
  `prediction` is generation-stable while S7.2's degradation language
  describes runtime installation, so one static template could flip its
  hashed core, synthesized name, and fingerprint branch with local
  state; resolve by making core `prediction` a generation-stable
  capability, representing invocation-time installation separately as
  presentation state, and branching settlement on the persisted
  generation-stable class frozen in durable custody; (2) the lane-L
  byte pin misstates the shipped optional-field serialization —
  `boundedSkew` is forbidden on data members and thus absent (never
  `null`-hashed), `now` appears only when present, `mints` only when
  nonempty; state the typed-server serialization exactly; (3) the same
  stale S2/S3.4 prose Grok found (shared MATERIAL). Its probe
  reproduces both fingerprint preimages byte-exactly with the
  optional-field rules applied and the four-class deployment story.
  GPT launches: 6 of 12.
- **Claude outcome:** received and appended verbatim to the claude
  artifact on receipt. **NOT READY** (1 MATERIAL, 4 DETAIL — all
  IN-DELTA; zero PRE-EXISTING MATERIAL; direction retained) bound to r6
  (recorded identity; full 1,841-line read; every substantive r6 pin
  verified code-exact, including the settlement split against the
  IR/store-runtime/fingerprint sources, the five-member comparison, the
  dispatch-scope split against the shipped requirement union, and all
  three zero-writes classes; "the remaining defect is editorial
  residue, not design"). Its MATERIAL is the same stale S2 prose the
  other families found, with the added observation that delta item 5's
  "replaced" claim was inaccurate (replaced at one site, left standing
  at another). DETAILs: `dispatchRequiredCapabilities` unspecified for
  reads and its S6.1 equality role loose; "query admission accepts only
  documents/records" over-narrows shipped admission (the exact gate is
  the authored-contract check); the prediction-class selector needs its
  static anchor stated against S7.2's runtime prose (GPT M1 at DETAIL
  altitude, same resolution); "deploy read-capable on ledgerless
  targets" overstates for the current Cloudflare v8 manifest (which
  also lacks v2 function requirements) — phrase as "adds no new
  artifact requirement". Claude launches: 6 of 12.

### Round 6 result — loop terminal; delta convergence held throughout

Final-round verdicts on r6: **Grok NOT READY (1 MATERIAL), GPT NOT
READY (3 MATERIAL), Claude NOT READY (1 MATERIAL)** — every concern
IN-DELTA, and **zero PRE-EXISTING MATERIAL in all six rounds** (18
delta-classified reviews). The round-6 MATERIAL union: the shared stale
S2/S3.4 result-contract prose (all three families), the
generation-stable prediction-class anchor (GPT M1, Claude D4 with the
same resolution), and the exact lane-L serialization rules (GPT M2,
implicitly confirmed by Claude's probe). The six-round budget is
exhausted; per LLP 0010 §2 the remaining in-delta fixes take the
terminal path: **applied as final revision r7, labeled unreviewed.**
The authorized Claude pool-exit rule never triggered (no READY verdict
in any round). No family dissented from the direction in any of its
eighteen reviews.

## Revision r7 — 2026-08-13 (final, UNREVIEWED)

- **r7 SHA-256:**
  `888bd87ec431516cf08be4ab5aa211254bdc9fd70b2c1d57632d1173c91127cc`
  (97,196 bytes; +50.1% net over the entering revision, inside the
  author's 2.5× ceiling). `./ref-check` 0 errors at r7.
- **Fixes applied (the round-6 union):** the S2 lead reconciled with
  the re-kinds (list-scoped `documents` claim; "no result kind outside
  the shipped grammar"; the stale "unchanged" sentence deleted) and the
  S3.4 paste scoped to keyset-profile list results; the settlement
  branch anchored to the frozen generation-stable prediction class
  (presentation never changes the branch/core/name) with the
  IR-compose doorway bound for every generated-exact write including
  online-only, and the exact lane-L serialization rules stated
  (`now` when present, `mints` when nonempty, `boundedSkew` absent for
  data members); get's v1 public presentation pinned to the hashed
  zero-or-one array with the `[]→null` projection assigned to a future
  point-read surface; the coverage-active class marked a
  post-transport server refusal never folded into the custody door;
  `dispatchRequiredCapabilities` pinned `[]` for reads with the S6.1
  equality member named; the admission-gate wording corrected to the
  authored-contract check; the deployability claim rephrased as "adds
  no new artifact requirement".

## Final report

- **Rounds run:** 6 (3 default + 3 author-extended). Launches: Claude
  6/12, GPT 6/12, Grok 6/12 — no voids, no failed launches.
- **Verdict binding:** the loop's final verdicts bind to **r6**
  (`6a75927becf51b8e02b494c0a033aa10a4df3bf088b7fc20646ce7ed801ad404`):
  all three families NOT READY with every concern IN-DELTA. **A later
  unreviewed revision exists: r7** as above. Earlier rounds' verdicts
  bind their own hashes (r1 `8d7d63ff…`, r2 `3c532efd…`, r3
  `2d547668…`, r4 `66bc9549…`, r5 `02afe7cf…`), all NOT READY.
- **Convergence claim, scoped:** the loop converged under the LLP 0010
  §2 delta rule — zero PRE-EXISTING MATERIAL across all three families
  in all six rounds — with the round-6 in-delta fixes applied in
  unreviewed r7. No unanimous READY was achieved on any single
  revision; the trajectory narrowed monotonically (round-1 MATERIAL
  union of 13 → 11 → 6 → 6 → 5 → 5, with round 6's union reduced to
  one shared editorial-residue defect plus two serialization/anchor
  pins), and the final round's reviews each independently verified the
  substantive contract set code-exact.
- **Direction:** retained unanimously in all eighteen reviews; zero
  DIRECTION-DISSENT.
- **Author rulings during the loop:** growth allowance ("a bit
  larger", then 2.5×), round-budget extension (up to 6), both applied
  and disclosed at each revision record.
- **Proposed next step:** the document stays in `Review`. Its own
  Status section gates implementation on S3 ratification: the
  proposed-pending amendments to LLP 0065 (S3.1 sole-candidate fill),
  LLP 0218/0043 (S3.2 declared custody, ambiguity, refusal ledger),
  LLP 0238 (S3.3 query-state vocabulary), and LLP 0004/0065-OQ1 (S3.4
  keyset continuation), plus the S3.5 disposition offered to LLP 0253,
  are the author's ratification calls, alongside acceptance of this
  Spec and the threshold freeze of the LLP 0256 evaluation Plan. The
  author may also commission a short single-family delta review of
  r6→r7 to lift the unreviewed label, as was done for LLP 0254.
  Acceptance remains the author's act alone; this loop recommends and
  does not apply it.
