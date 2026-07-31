# LLP 0126 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit b50690ec, mutually blind (no llp/reviews/
artifacts for LLP 0126 read)
**Target SHA-256:** `c9bcf8155a3602867c50a41f34f7ce703ec5d59fd3e24192c9f4cbec6d93e60c`
**Instruction SHA-256:** `f4582d729ac4602b7ae5d3fe80e85edfaeeeb639dc7658f63fb3365ce698fc24`
**Status:** completed

Verification basis for this round: every code claim in "What Snapback has
today" and the approach-9 ingredient list was re-checked against the
working tree directly (file and line); the prior-art citations were
re-checked against LLP 0022/0082/0083/0084/0085; the diary quotations
were re-checked as exact substrings against Diaries 0027/0028/0029/0030/
0039; the owning-document claims were re-checked against LLP 0003, 0008,
0012, 0013, 0034, 0043, 0051, 0053, 0059, 0064, 0073, 0074, 0080, 0081,
0090, 0107, 0110, 0111, 0114, 0115, 0116, 0118, 0120, 0123, and 0125.

## 1. Overall assessment

This is close to the bar and misses it on verifiable accuracy, not on
analysis. The analytical work is genuinely strong: nine approach
families that cover the field I can construct, an honest breakage
inventory for the flagship embedded-runtime lane, a decision-free option
space whose every option carries its evidence-model consequence, and an
unusually disciplined "nothing is measured" boundary (finding 11) that
keeps empirical questions named rather than answered. The code-verified
section is exceptional — I re-checked roughly twenty path-and-line
claims (`src/manifest.rs:6100-6101`, `src/storage.rs:10402/10468/
10609-10620`, `packages/snapback-client/index.mjs` at 125-131, 309-311,
3498-3513, 4902-4906, 4977, 6452-6508, 7978-7993, 9053-9066,
`rqs-store.mjs:271`, `external-store.mjs` 382-390, `src/live_wire.rs`
receipts, `src/main.rs`, `Cargo.toml`, the 31-global allowlist in
`packages/snapback-codegen/inline-handlers.mjs`, the runtime packages,
the ~48 MB binary) and every one is accurate.

But the bar is "no flaws," and the document has a small cluster of
flaws that pre-empirical work could and should have caught, because
every one is contradicted by a source the document itself cites:
InstantDB is placed in the cold-boot-has-nothing family that LLP 0082
and two diaries refute; the non-retainability of protected opaque
queries is attributed to the wrong LLP 0053 mechanism (and OQ2 aims
future work at that wrong blocker); and three quotations are printed
that do not exist in their sources in the quoted form. Each fix is
small. Until they land, the document does not meet its own method's
standard, which is the heart of the stated bar.

## 2. Strengths

- **Code verification discipline ("What Snapback has today"; approach 9
  ingredient list).** Every file/line claim checked out, including the
  subtle ones: the exact closed-refusal retry predicate shape
  (`#isEffectFreeReservationStale`, detail-keys equality check), the
  outbox-blocks-resume rule inline at `index.mjs` 6452-6508, the
  Cloudflare profile's explicit `offline_retention = false` with the
  `offline_mutation_replay` capability gap, and the
  `snapback.function-implementation.v1` identity format.
- **Diary quotation accuracy (approach 6; "And the diaries scored the
  arm that has none of this"; findings 1, 8).** Nine of the ten direct
  diary quotations I checked are exact to the character, including the
  three long Convex quotes from Diary 0027, the Firebase pair from
  0028, the Diary 0030 capacity line, and the Diary 0039 scope
  sentence. The 0028 revocation FAIL is correctly carried with its
  remediation-rerun fix rather than cited stale.
- **Honest breakage inventory (approach 9, "What breaks, honestly").**
  The six break categories are real, correctly sourced (0008's
  replay-environment pin, 0120's table-granular reads, 0043 M1's
  fail-closed lease, 0081's quarantine seam, the speculative-receipt
  discipline), and the "What stays impossible" list is the right shape
  of honesty. The unowned designs are named as unowned rather than
  hand-waved. The browser paragraph ("A design that pretends one lane
  covers both platforms is wrong on day one") is exactly the candor the
  series bar asks for.
- **The ephemeral/durable split axis (cross-cutting axes; finding 8).**
  A sharp, original synthesis: the LLP 0107 quote is verbatim, the Jazz
  cursor-history reductio is really in 0085, the Convex durable
  heartbeat contrast is diary-recorded, and Diary 0039 supports the
  Cursor Garden characterization ("This remains Snapback's decisive
  win").
- **Decision hygiene and 0115 interaction (option space preamble;
  "Relationship to LLP 0115").** Options compose, none is chosen, each
  carries its 0115-constraint-1 evidence consequence, option B's
  evidence-regression risk is named as the highest, and the do-nothing
  option is treated seriously with a strategic-cost accounting instead
  of a strawman. The 0115 board claim (no offline item, CV-11 owns live
  search, watch items silent) checks out exactly.
- **Empirical honesty (Confidence; finding 11; open questions 3-6).**
  Footprint, resume storms, hydration, and local-execution latency are
  declared unmeasured; Hermes-to-WASM and mobile Rust-host feasibility
  are declared unassessed; category-(c) material deliberately omits
  load-bearing numbers. I found no claim that only running code could
  establish asserted as fact.
- **Owning-document statuses (relationship section).** All nine status
  assertions verified against the headers (0008 Draft, 0043 Draft with
  first slice implemented, 0051 Draft, 0053/0059/0090 Accepted, 0081
  Implemented on the local profile, 0003 Draft with v0 ratified, 0115
  Draft), and the 0043 M1/M2 details, the verbatim LLP 0012 rule quote,
  the 0081 quarantine quote, the 0090 outbox rule, and the 0114
  honesty-rule quote are all exact.

## 3. Concerns

**C1. InstantDB is misclassified in approach 6, and the offline-leader
record is understated — MATERIAL.**
Approach 6's mechanism sentence reads "No replica of record: the client
caches subscribed query results in memory … Convex, InstantDB, and
Snapback's current clients. Offline capability is whatever a warm
session's cache gives; a cold boot has nothing." That is false for
InstantDB by the document's own category-(b) source: LLP 0082 (line
~122) records Instant's triple store "persisted to IndexedDB /
AsyncStorage; offline reads" and (line ~48) "Snapback lacks Instant's
client-side offline query cache." The diaries measured it: Diary 0027
scored InstantDB 14 PASS / 0 GAP with no offline GAP, and Diary 0029
called its cold-browser result "particularly strong" (0028 did record a
CHAT-09 offline GAP). The same section's "the one strong browser result
was Firebase" is true within Diary 0028 but false across the corpus,
and the Summary's "GAPs against nearly every backend" carries no
exception for the two backends that passed offline cleanly — Firebase
in all three diaries, InstantDB in two — which are exactly the backends
Diary 0027 names: "The offline requirements alone put InstantDB and
Firebase ahead." The document's own approach-3 paragraph already
describes Instant's persisted committed store + queue, so approach 6
contradicts approach 3 internally. The Convex-scoped opportunity claim
("competes against recorded absence, not against a Convex strength")
survives, but the field-level frame overstates the absence.
*Resolves:* move InstantDB out of the approach-6 exemplar list (or
qualify it as approach 3 with a persisted cache), scope the Firebase
"one strong result" sentence to Diary 0028, and add the
Firebase/InstantDB exception to the Summary's "nearly every backend."

**C2. Non-retainability is attributed to the wrong LLP 0053 mechanism,
and OQ2 aims at that wrong blocker — MATERIAL.**
The arm section says protected opaque queries are "non-retainable by
design (LLP 0053's shrinkage obligation), not by lag," and OQ2 says
"LLP 0053's non-shrinkage obligation is the blocker." Two problems.
First, the two spellings contradict each other, and neither is a named
term in 0053 (its language is "the *shrinking of the result set is the
security event*," carried by delivery obligations). Second and more
substantively, in 0053 the shrink-delivery obligation is a *delivery*
mechanism (level-triggered, ACK-discharged) and is not what makes
opaque queries non-retainable; the retainability gate is the separate
invariant "Retainable ⇒ declared authorization dependence ⇒ enumerated
events" (0053 ~L506) / "Retainable ⇒ `userId`-only authority
dependence" (~L1552). OQ2 is one of the document's named forward
questions; as written it directs whoever picks it up at the wrong
design surface. *Resolves:* cite the retainability invariant in both
places, use one consistent name for it, and keep the shrink-delivery
obligation for what it actually governs.

**C3. Three quotations do not exist in their sources as printed —
MATERIAL (quote integrity, one concern, three instances).**
(a) *Jazz founder quote (frame section).* "instant local reads, sync
for free, permissions shaping what syncs, deep history" is presented in
quotation marks attributed to "Jazz's founder," but in LLP 0085
(~L112-115) that list is 0085's own unquoted summary — only "the
experience" is quoted there, and "shaping what syncs" is 0085's added
italics. The words are right; the attribution upgrades a paraphrase to
a primary-source quotation, which is precisely the failure the method
section promises to avoid.
(b) *"three diaries said 'would not choose it'" (option F).* None of
0027/0028/0029 uses that phrase about Snapback. The actual verdicts are
"Not yet for this Todo" (0027), "I would not rank it first for this
chat today" (0028), and "For a local-first issue tracker today, no"
(0029) — all hedged toward repairability, hedges the printed phrase
drops. The literal phrase is used about Snapback only in Diary 0030,
where the grounds are assets/hosting/notifications, not offline.
(c) *LLP 0074 differentiator (option F).* "retained local-first
execution… claimed only as a graduation path" splices two different
0074 sentences: "retained local-first execution" belongs to the
surviving-conjunction sentence (~L479-481), while "claimed only as a
graduation path" attaches specifically to "the React/Expo local-first
story" in the following bullet. The substantive point (option F cancels
a named 0074 differentiator) survives; the quotation as printed does
not exist. *Resolves:* recast (a) unquoted, replace (b) with the three
actual phrasings or an unquoted summary that keeps the hedges, and
split (c) into its two real quotes.

**C4. Electric/PowerSync wording hardens its sources — DETAIL.**
"(verified to ~1M concurrent clients)" — LLP 0022 says "Benchmarked
100k→1M concurrent clients" (a vendor benchmark 0022 confirmed was
claimed, not independently verified); "had to be replaced wholesale by
Sync Streams" — 0022 says Sync Rules are "now officially 'legacy'"
after a second system shipped, and "wholesale" does not appear in 0022;
"0022's recorded lesson: design for the expressive shape early" is a
paraphrase of an `[inferred]` passage ("from day one"). None is quoted
in quote marks except none; all three should be softened to the source
wording. *Resolves:* "benchmarked 100k→1M," "now legacy after a
second-generation replacement," and mark the lesson as 0022's
inference.

**C5. D1 bookmark conflation — DETAIL.**
Approach 5's "D1's log-plus-snapshot bookmarks" merges two different
bookmarks in LLP 0083: the D1 Sessions API bookmarks (read-replica
sequential consistency, the copyable prior art 0083 recommends) and the
SRS PITR bookmarks, which are the ones that "fell out of" log-plus-
snapshot storage. The DK-3 sentence's "cacheable HTTP read lane …
with D1's bookmark Sessions API as copyable prior art" also leans the
Sessions API toward cacheability, which is 0022/Electric's idea; 0083
ties Sessions to consistency across replicas, not caching. *Resolves:*
cite the two bookmark kinds separately and keep cacheability with
Electric.

**C6. "Sealed per-platform runtime packages" overstates LLP 0123 —
DETAIL.**
The word appears three times (Summary, approach 9 ingredient list,
finding 5). In 0123, "sealed artifact" is the *Convex comparator*
vocabulary, and 0123 frames sealing as prospective: "The strategic move
is to make that co-packaged pair … digested, and installed atomically
together." What exists today — verified in-tree — is the darwin-arm64
package pairing `bin/snapback` with `hermesvm.framework` and the
linux-x64 package's binary+Hermes digest attestation
(`artifact-attestation.mjs`). The inventory is honest; the adjective
imports a property 0123 treats as future. *Resolves:* "co-packaged,
digest-attested per-platform runtime packages" or similar.

**C7. "Evaluable by a small JS interpreter" invites the reading
LLP 0051 rejects — DETAIL.**
Browser rung (i) says host-plan mutations are "evaluable by a small JS
interpreter." 0051's §Rejected explicitly refuses "QuickJS (or any JS
engine) on clients for Parity" and pins "the IR (any language) or WASM,
never by embedding a JS engine." The intended meaning here is almost
certainly an IR evaluator *implemented in* JavaScript for the browser
(which is consistent with 0051 D2), but the phrase reads as the
rejected thing. *Resolves:* "a small IR evaluator (implemented in JS
for the browser)."

**C8. Ownership-table error: LLP 0064 does not own client capability
classes — DETAIL.**
The relationship section assigns "client capability classes" to 0064.
LLP 0012 owns the class vocabulary (Online/Parity definitions and the
honesty rule 0043 quotes); 0064's own Related line says "LLP 0012
(headless integration and capability classes)," and 0064 owns the
native client *surfaces* that apply those classes. Since this table is
the routing map for any graduated work, the row should be corrected.
*Resolves:* "LLP 0012 owns capability classes; LLP 0064 owns the native
client surfaces that carry them."

**C9. The five-to-zero count's combined citation — DETAIL.**
Summary and finding 2 cite the count to "(LLP 0022, 0084, 0085)" as
part of a compound sentence. The count exists only in LLP 0084 (which
folds in 0022's three peers); 0022 and 0085 contain neither the tally
nor the framing. Approach 5's body text attributes it correctly
("LLP 0084's count"), and it correctly carries 0084's client-facing
qualifier ("logs survive *inside* engines"). The compound citation is
defensible as sentence-level sourcing but invites misattribution in the
two summary positions. *Resolves:* attach 0084 to the count clause
specifically.

**C10. Inference-tag slippage on two (b) claims — DETAIL.**
"LLP 0084's market finding is that demand for radical serverless
operation concentrates in mesh verticals" compresses an `[inferred]`
passage whose own terms are "offline-critical physical-operations
verticals" / "its market requires serverless operation"; and "the
field's own record (LLP 0022 §1: 'automatic semantic conflict
resolution is the wall')" quotes an `[inferred]` synthesis item as
record. The document carries source tags elsewhere (Instant's
"probe-observed," Turso's "0022's inference"), so these two are
inconsistencies, not a systematic failure. *Resolves:* mark both as the
source docs' inferences.

## 4. Suggestions

- **Place Firebase/Firestore in the taxonomy.** The corpus's
  best-measured offline story has no family assignment: it is approach
  6 plus a durable persisted cache plus an offline write queue — i.e.,
  the destination option A describes. Naming that would both fix C1's
  fairness edge and strengthen option A ("the diaries' offline leader
  is architecturally what option A builds, minus the lease").
- **Device-at-rest custody is untreated in approach 9's breakage
  inventory.** The lease governs retention lifetime and
  deletion-before-render, but bytes on disk before lease expiry (OS
  keychain, disk encryption, other-process reads) are not discussed —
  the Firebase revoked-bytes sting (Diary 0028) is the neighboring
  evidence that this axis gets measured. One named open point or
  explicit nonclaim would complete the honesty of the inventory.
- **Native multi-process custody.** DK-9's Web-Lock rule covers
  same-origin browser custody; two native processes sharing a local
  replica store have no named custody rule. One line.
- **Option A's "beats Convex's measured cold-boot GAP"** is a design
  projection; a clause noting that closing the diary GAP rows is itself
  confirmed only by a rerun would keep finding 11's discipline uniform.
- **Option E's lean "do regardless"** is the one lean phrased as a
  directive rather than an assessment; "no-regrets under every branch"
  says the same thing in analysis language.
- **Finding 7's "one artifact, three consumers (LLP 0003's build-once
  intent)"** — 0003 names two consumers (mutation-isolation validation
  and reactive invalidation); the third (the retainability rule) is
  this document's extension. "Extending LLP 0003's build-once intent"
  keeps the attribution clean.
- **Report upstream:** LLP 0022 internally misquotes its own
  verbatim-verified Electric line at ~L37 ("a sync engine, not a
  local-first platform," dropping "software"); 0126 quotes the correct
  form. A one-line 0022 fix (or an issues/ ticket) would prevent the
  truncated form propagating.
- The journal claims ("tombstones," "monotonic global version") are
  code-true (`_snapback_changes` has `op = 'delete'` rows and a
  `version` column carrying the global commit version) but neither is
  0008 L3's vocabulary — 0008's monotonic pin is the pruning
  watermark. Since the sentence cites "(LLP 0003, 0008 L3;
  code-verified)," consider attributing the vocabulary to the code and
  the design to the RFCs.

## 5. Open questions

1. Is sentence-level combined citation (C9's "(LLP 0022, 0084, 0085)")
   an accepted series convention from 0116-0125, or should this
   document set the stricter per-claim standard its method section
   implies?
2. Approach 7 (Couch/Pouch) is entirely category-(c) with no in-repo
   verification, yet its "lasting lessons" paragraph does real work in
   framing approaches 1-4. Is a contour-level lessons section
   acceptable at the bar, or does the historical baseline deserve a
   dated prior-art pass before its lessons are treated as load-bearing?
3. OQ3 asks which document owns the settle-time trust policy; the
   document elsewhere notes LLP 0008 already pins accept-the-captured-
   environment for the online replay path. Is the open question
   scoped to *local execution* only, or does it implicitly reopen
   0008's pin? A clarifying clause would prevent the wrong reading.

## 6. Verdict

**NOT READY** — strictly against the stated bar. The analysis itself is
at the bar: the option space is complete and fair, the breakage
inventory is honest, no decision is smuggled (one lean's phrasing
aside), and every question only running code can answer is named as
such. What holds it below "no flaws" is a small cluster of verifiable
accuracy defects, each contradicted by a source the document itself
cites: the InstantDB misclassification (C1), the wrong 0053 mechanism
behind a named open question (C2), and three nonexistent-as-printed
quotations (C3). All are small edits; none is structural. With C1-C3
fixed and the DETAIL wording items reconciled, this document meets the
bar.

## 7. Recommended next step

Author applies C1-C3 (and sweeps C4-C10, each a one-to-three-line
edit) in a v0.2, then a round-2 review verifies the deltas only — the
code-verified section, the diary quotations other than C3b, the
owning-document statuses, and the option space needed no correction in
this round and do not need re-litigating. Suggest also filing the
LLP 0022 internal-misquote fix upstream in the same change so the
corrected Electric quote form is the only one in the corpus.


## Round 2 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, round-2 delta review at
commit 14d73928 under the delta stopping rule: own Round 1 section read
as required; delta read as
`git diff b50690ec -- llp/0126-local-first-and-local-sync.research.md`
(495 insertions / 208 deletions); each round-1 concern's fix re-checked
against its source in the tree; new text checked for fresh defects;
settled round-1 text not re-litigated; mutually blind (the .codex.md
artifact not read)
**Target SHA-256:** `4814e5b3eb3781c43b3bfe9e2545099e1d7c7e9f6a831873d92ca33b4cc931d5`
**Instruction SHA-256:** `33c3fd21fcc61f4ed59da1207ef188e75a1328149be03f08f57ca9141b06f7ce`
**Status:** completed

## 1. Resolution check — round-1 concerns

- **C1 (InstantDB misclassification; offline-leader record) —
  RESOLVED.** Approach 6's mechanism list now reads "Convex and
  Snapback's current clients" with an explicit parenthetical routing
  InstantDB to approach 3 ("persisted to IndexedDB/AsyncStorage with
  offline reads — LLP 0082"), which matches LLP 0082 L122 exactly. The
  Summary now carries the two-backend exception (Firebase clean in all
  three diaries; InstantDB strong in two), the "one strong browser
  result" sentence is replaced by the corpus-wide framing, and finding
  1 states the diaries' measured bar as Firebase/InstantDB. Verified
  against the diaries: Diary 0027 "Firebase passed all 14 frozen Todo
  scenarios" and "The offline requirements alone put InstantDB and
  Firebase ahead" (L1181); Diary 0029 Firebase "handled the realtime
  and offline portions unusually well" (its environment limitation at
  L233 is hosted deployment, not offline) and the InstantDB section's
  "The cold-browser result was particularly strong" (L784, inside the
  InstantDB arm); Diary 0028's Instant CHAT-09 GAP text "a custom
  in-memory store is not direct provider evidence" (L772-773) — the
  new quotation is exact and the environment-limit characterization is
  faithful.
- **C2 (wrong LLP 0053 mechanism; OQ2 aimed at it) — RESOLVED.** Both
  the arm section and open question 2 now cite the retainability
  invariant "Retainable ⇒ declared authorization dependence ⇒
  enumerated events" — exact at LLP 0053 L506 — with one consistent
  name, and both correctly re-scope the shrink-delivery obligation as
  the delivery mechanism for authorization-negative updates, matching
  0053's own structure (delivery obligations at L256-268; the
  invariant as the retainability gate).
- **C3 (three nonexistent-as-printed quotations) — RESOLVED.**
  (a) The Jazz list is now presented as "per LLP 0085's own summary,"
  unquoted, with only "the experience" in quotes — exactly 0085's
  L113-115 form. (b) Option G now quotes the three actual verdicts,
  each verified exact against Diaries 0027/0028/0029, with the
  repairability hedge restored ("each verdict hedged toward
  repairability, and this option forfeits the repair"). (c) The 0074
  splice is split into its two real quotes: "retained local-first
  execution" from the surviving-conjunction sentence (0074 L481) and
  "the React/Expo local-first story is not yet built and is claimed
  only as a graduation path" from the Parity bullet (L489-491) — both
  exact.
- **C4 (Electric/PowerSync hardening) — RESOLVED.** "Benchmarked
  100k→1M concurrent clients — a vendor benchmark LLP 0022 confirmed
  as claimed, not independently reproduced" matches 0022 L138;
  "now officially 'legacy' after the second-generation Sync Streams
  shipped (GA 2026-06-09)" matches 0022 L190-192 including the GA
  date; the day-one lesson now carries 0022's `[inferred]` tag,
  matching L193-194 exactly.
- **C5 (D1 bookmark conflation) — RESOLVED.** Approach 5 now names
  "the SRS PITR bookmarks that fell out of D1's log-plus-snapshot
  storage" (0083 L81-82) and approach 4 / hosted topology tie the
  Sessions API bookmarks to "sequential consistency across replicas,
  not caching" (0083 L176-183), with cacheability explicitly kept as
  "Electric's idea."
- **C6 ("sealed" overstatement) — RESOLVED.** All three positions now
  read "co-packaged, digest-attested per-platform runtime packages"
  with sealing marked as "LLP 0123's prospective move, not a shipped
  property" — matching 0123 L439-442 ("The strategic move is to make
  that co-packaged pair … installed atomically together") and its
  sealed-artifact vocabulary being the Convex comparator's (L128).
  The only remaining "sealing" mentions are the deliberate
  prospective-move framings.
- **C7 (JS-interpreter reading 0051 rejects) — RESOLVED.** The browser
  rung now reads "a small IR evaluator implemented in JS for the
  browser (an IR interpreter, not an embedded JS engine)" and quotes
  0051 §Rejected's "QuickJS (or any JS engine) on clients for Parity"
  — exact at 0051 L1105.
- **C8 (0064 ownership row) — RESOLVED.** The relationship section now
  assigns capability classes to LLP 0012 (Online/Parity and the
  honesty rule) with LLP 0064 owning the native client surfaces that
  carry them — the correction as recommended.
- **C9 (combined five-to-zero citation) — RESOLVED.** Both summary
  positions now attribute the count to LLP 0084 ("the count is
  LLP 0084's, folding in LLP 0022's three peers"), and the new
  four/one decomposition (four query/subscription/bucket-scoped;
  Turso whole-database/page) is verified against 0084 L38-43/L355-359
  (Triplit, Ditto, Electric, PowerSync + Turso) and 0022's
  page-hydration characterization — the rendering is more precise
  than 0084's own headline phrase, in the right direction.
- **C10 (inference-tag slippage) — RESOLVED.** The market claim is now
  "LLP 0084's inferred market characterization … offline-critical
  physical-operations verticals" (0084 L343/L368, both in `[inferred]`
  synthesis items), and the wall claim is now "as LLP 0022 synthesizes
  it (its `[inferred]` §1 theme)" — matching 0022 L339's explicit tag.

Round-1 suggestions (non-gating) were also substantially absorbed:
option A's rerun-confirmability clause, option F's "no-regrets"
recast of "do regardless," at-rest custody and native replica-file
custody in the new cross-cutting hosting list, and the OQ-1-style
per-claim citation standard. The upstream LLP 0022 internal-misquote
suggestion was not taken (0022 L36-37 still carries the truncated
Electric quote); that is a defect in 0022, not in this document, which
quotes the correct form.

## 2. New concerns in the delta

The new text is substantial (execution-identity tuple, hosting-shape
split, options re-lettered A–G with new B1/B2 and C, the 9×4 ideals
matrix, recast conditions/evidence gates, named category-(c) sources,
OQ10). I verified the new claims against their sources: the tuple's
element citations (0118/0123/0051 D5/0051 D1+0008/schema epoch), the
hash-coverage parenthetical "canonical AST (or module source hash, or
host plan) … auth facts" (code-true at
`packages/snapback-codegen/index.mjs:4156-4177` — the three handler
forms and `authRequirement`/`authorizationDependence` are exactly
there), the lease trust-shape text (LLP 0043's ENG-24992 amendment
L96-103 and LLP 0053 §The lease L1218/L1262 "Verification locus" —
faithful), "server-MACed" replacing "signed" (0043 L84's own
vocabulary), the Rust-library claim (`src/lib.rs` exports `pub mod
cli`; no embedding ABI exists — accurate), "LLP 0043 leaves mobile
encryption open" (0043 L388), Jazz v2's "deep history under
trusted-server policy" (0085 L40), "most heavily funded CRDT vendor in
the surveyed corpus" (0084 L29 says most heavily funded in local-first
— the narrower claim is safe), and the option re-lettering (every
cross-reference outside the board — L206, L229, L395, L1119, L1150 —
points at the correct new letter). The named category-(c) primary
sources (2017 JSON-CRDT paper, 2016 YATA, Figma 2019, Ink & Switch
2019, Zero announced 2024, Artman/Linear) are correct to my knowledge
and properly kept inside category (c) ("naming a source does not
promote the claim"). One concern:

**N1. Option C's "at a fraction of option D's cost" is the one sizing-
flavored phrase under a preamble that forswears sizing — DETAIL.**
The recast option-board preamble now promises "None of the cost/risk
language below is a sizing or a decision — finding 11 stands."
Option C's benefit clause then says offline writes come "at a fraction
of option D's cost." The structural claim underneath is sound (option
C omits the embedded runtime, the tuple, and the hosting shapes — a
strictly smaller surface), but "a fraction of the cost" is magnitude
language, the exact register the preamble just excluded, and option D
itself is careful the other way ("'cheap' is a hypothesis until
sized"). *Resolves:* one phrase — e.g. "with a strictly smaller build
surface than option D."

Cosmetic, not a concern: the approach-6 Firebase sentence has a ragged
source wrap ("Firestore's" alone on line 379); rendering is unaffected.

## 3. Verdict

**READY** — against the stated bar. All ten round-1 concerns are
genuinely resolved, not reworded: every fix was re-verified against
the same sources round 1 checked, and each lands the source's actual
words or scope. The substantial new material holds the document's own
method discipline — the tuple is declared "design vocabulary this
document introduces, not shipped machinery," mobile is downgraded to a
named spike question, the leans are recast as conditions plus evidence
gates without smuggling a decision, and roughly twenty-five new
factual claims I checked (diary lines, LLP quotations, code paths,
dates) are all accurate. N1 is a single wording-register inconsistency,
not a factual defect, and does not hold the document below
"exhausted pre-empirical analysis."

## 4. Recommended next step

Accept-ready from this family. The author may fold in N1's one-phrase
fix at acceptance (it needs no re-review), and should still file the
LLP 0022 internal-misquote fix (0022 L36-37's truncated Electric
quote) as a small upstream edit or issues/ ticket so the corrected
form 0126 quotes is the only one in the corpus. Per LLP 0005 the
acceptance call is the author's, pending the other family's round-2
verdict.
