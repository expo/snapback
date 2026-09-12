**Reviewer family:** Grok
**Provider / runtime:** Grok CLI; requested grok-4.6, xhigh; reported model-usage key grok-4.6-build
**Date:** 2026-09-12
**Redacted:** no; repository source only
**Method:** Independent frozen-source packet review. No Sol review or findings were supplied.

# LLP 1023 implementation review — Grok

## Round 1

Candidate: `952682fc159d13abd0cdb625c43ead19b0dc1504`; base: `a41a132f8200ea20c5cb80300b4a4837d31389d8`.
Packet SHA-256: `a5d73760cca4b6f8bfa741d50de8da0b4c96ea2b62f82ebbb9b2ee0cec0ad972`.
CLI exited successfully and returned structured output in one model turn.
Session: `01a09395-bdb9-7910-84eb-4d8bfc94d054`.
Two earlier CLI attempts returned no completed review (one exhausted its turn
limit; one returned progress text only). They are not counted as reviews.
Their raw output remains in the run's `code-review/` scratch directory.

**Verdict: MATERIAL**

### high — snapback2/crates/snapback2-core/src/certificate.rs:486

**Trigger:** A uniform merge (page priced as take rows in RetentionEstimator) plus retained constructed values or output larger than the pooled receipt estimate — e.g. for-loop `{ post: entry, note: arg }` with a wide `text` argument on a 500-follow merge of narrow posts. The other side of the same max() is a fat receipt pool that replaces, rather than adds, those constructed/output bytes.

**Rationale:** The uniform-merge split is complementary: retention now holds the returned page and constructed values, while search/closure.rs holds receipt heads, lookahead, discovery, and metadata. certificate.rs still picks max(retention, search_closure) and can later replace that with output.retained_bytes. max() was sound when retention already included L+N+2+discovery; after the split, whichever estimate wins drops the other, so a certificate can admit a program whose actual receipt-plus-result exceeds max_closure_bytes. wide_shaped_merge and the receipt-length check only cover the wide-row side where the pool dominates.

**Correction requested:** Do not replace complementary estimates. For uniform-merge programs keep search_closure as the receipt floor and saturating-add retention/output bytes that are not already in that pool (subtract the overlap of take page rows, or conservatively add constructed/value_bytes only). Keep a bound test where constructed/arg copies exceed (L+2+discovery)*row_width so retention would previously win and undercount heads.

**Review limits:** Did not run tests, builds, or the pinned gzip five-root measurement (reported 89,986 / 90,000, not reproduced). MergeSite.uniform is classified in certificate/merge.rs, which was not in the packet; following_twenty / wide_shaped_merge imply it is set for the 500-follow fixture. Digest remains an explicit unclaimed gap and was not treated as missing completion. Unconfirmed: integer truncation of max_calls/lanes in closure.rs if those are not divisible; enqueue returning structuredClone(prepared.entry) omitting store-assigned fields such as order; AssetImage session fallback not re-qualified on Chromium in this packet. live-query.md still shows a first-50 membership merge for word-prefix search; fanout.md is the complete 1,000-chat form.

## Integrator disposition after round 1

The proposed wide-argument case is being executed against the separate receipt,
output and heap contracts. The first concrete two-page run stays within each
individual bound; their sum exceeds the closure bound, which is not documented
as a combined output-plus-receipt limit. Additional refusal controls and the
reviewer's independent adjudication remain pending. No accounting change or
reviewer acceptance is inferred from this preliminary result.

## Round 2

Candidate: `ade40815509be3bb5ab873de3d2c02bc5182f6b0`; base: `89b705dbb222ecb77977b586377ca39447cad854`.
Packet SHA-256: `16d5360713ee9ff64ed35d6500a9ef3cc66765b3518f4aac0b51fa7909927a40`.
Session: `01a093b9-2743-7743-a73a-2423cede3b2c`. Requested Grok 4.6 xhigh; reported model-usage key `grok-4.6-build`.
The fresh reviewer received its own prior finding, the exact source and independent meter tests, and no peer review.

**Verdict: READY**

No material findings.

**Review limits and adjudication, verbatim:** Did not run tests, builds, or the pinned gzip five-root measurement (reported 89,843 / 90,000, not reproduced). Prior complementary-max finding: under LLP 1001 §10 as written (result vs retained rows as separate serialized products; heap separate; no combined Execution envelope), certificate.rs max(retention, search_closure) cannot undercount either product when search_closure is a valid receipt floor — max is at least that floor. The added constructed 500-follow control still has search_closure winning (receipt ~718–800k of 1,349,429; output ~967k of 967,932), so it does not exercise a retention-wins path; that path would still be ≥ the receipt estimate rather than dropping heads. Unconfirmed, not filed: integer truncation of max_calls/source.take only at saturating u64 overflow, not at the 500-follow shape (analyzer multiplies by source.take then divides it back); enqueue structuredClone(prepared.entry) omitting a store-assigned order — submitMutation only consumes intent/ids, and this packet does not include prepareEntry’s order assignment; a constructed result descriptor with a consumed asset id that fails AssetRecord equality would skip owner redaction (legal queries return typed fields/aliases, which the result walk does redact). Digest final-emission eligibility remains an explicit unclaimed gap. live-query.md still shows a first-50 membership merge in the Unicode section; fanout.md is the complete 1,000-chat form. onceExhausted whole-row suppression at the offline twin is the existing viewed-row-absent rule, now shared with bytes/carrier; owner Row-provenance exhaustion matches Get/full-row projections. Reported Chromium 13 / owner 122 / web 209 / hub 1,000+125 / closure 212 were not independently reproduced.

Integrator: the earlier accounting finding is withdrawn by its reviewer under the separate serialized-product contracts. Subsequent template/diagnostic repairs and main integration still require a scoped delta review; this verdict does not cover unwritten changes.

## Round 3

Candidate: `cee80bc1d056f3a23087ceb338da41cc156776de`; delta from `ade40815509be3bb5ab873de3d2c02bc5182f6b0`.
Packet SHA-256: `8ff7ab20db6723e9e8341b53da7c9427f91f2206b25eee25c050c7141a82b408`.
Fresh mutually blind packet-only review; same requested family/model/effort as above.
Session: `01a093e4-1629-7602-9c34-1c82e61bfc83`; process exited 0.

**Verdict: READY**

No material findings.

**Limits, verbatim:** Delta-only review of the supplied packet (candidate cee80bc1 vs prior READY at ade40815). No tools, tests, builds, peer reviews, or files outside this packet. Unconfirmed, not raised: whether opaque_cursor plus a non-empty result_pages site can label merge page: without a proved client cursor binding (code checks plans.len()==1, uniform, take>1, opaque_cursor, result site match, and pool ownership; it does not check result_page cursor Some). Unconfirmed: assetBlob/ByteCache admit after the live row drops the asset id; templates keep the captured ImageAsset and viewing instance, which the packet’s transition tests cover. Digest final-emission remains the recorded unfulfilled parent gap. Runtime 89843/90000 and failed 1% byte comparison are inherited. Did not re-judge main’s landed CLI/schedule/mutation-target work.

Integrator: this resolves the reviewed source findings. The actual full test script passes at the candidate; the inherited historical byte comparisons remain failed. Later imported main changes retain their own provenance. A separate small review covers the two manually reconciled guide pages. No digest or fresh-wave success is inferred.

## Guide integration follow-up

Candidate: `4229f3143917c24a9b7374a334b4010b1762cc2f`; scope is only the manual fanout/merge guide reconciliation after imported main `4a4249f7cc`.
Packet SHA-256: `550ef6a3618d2aab6a5406ba325bc89802c273ef243275fba046a1deb211b850`. Fresh mutually blind sessions; no tools or peer review.
Session: `01a093f1-b3a2-7a70-a9ae-30fb5b951a2d`; exit 0.

**Verdict: READY**

No material findings.

**Limits, verbatim:** Review is of the supplied fanout.md/merge.md integration text against the supplied fixture Q, installed recipe, and stated program facts only. No tools, checkouts, compiler, generated-client types, builds, network, or 4a4249 walk; did not re-open cee80bc1 source, runtime-test the pager, or launch digest/fresh-benchmark work. Main first-use/diagnostics survival is judged from the reconciled files as given (named-or-positional lanes; system reads bypass rule capping, not execution limits) plus the 1023 global/grouped split. Fixture Q matches the inlined forms; semantic compile is by that match and reported guide 98178/98304, not a run in this review. Historical 0.0.25 Clique timings, red 1% byte-growth, unchanged baseline, digest gap, and unlaunched fresh benchmark stay explicit and out of scope.

## Rule diagnostic follow-up — 0.0.31

Received 2026-09-12 from a fresh Grok CLI session requested as `grok-4.6 xhigh`, returned model `grok-4.6`. The reviews received the same fixed source/diff evidence in separate empty contexts. No tool events were observed; the reviewer ran no tests. Raw streams and process records are retained under `/Users/ccheever/projects/snapback-1023-20260912/rule-diagnostic-repair/`.

### Round 1 — adc641a107

Prompt SHA-256: `637b2df4f050577f88c77e1669b44d6e88701b844553432231f6ffa8570ca555`. Raw response SHA-256: `68c910b70602245ee59f81b09f03dea803672040837a1a404fc1af33bb96354b`.

**READY**

No material findings in this delta.

The binder still refuses `<` `<=` `>` `>=`. Repair text now splits on `context.effect === "read"`: read rules no longer recommend a mutation `require`; insert/update/delete keep the previous require wording. Refusal code, family, and site are unchanged. Supported `=` / `!=` rules and mutation `require` comparisons are untouched. The new checks cover all four operators × all four table effects, plus a supported ownership read and a write `require` that still lowers.

Parent/child LLP text matches the stated 0.0.30 digest baseline, unmet byte target, frozen 0.0.29 Clique wave, and source-only qualification. Version files are 0.0.31 preparation, not a publication or Clique claim.

Not material: channel publish/subscribe still have no `effect`, so they still get the write require sentence (pre-existing, outside the commissioned read/write matrix). Author-reported 85/85, typecheck, and 319/319 were not rerun here; the integrated full script and the frozen 0.0.29 benchmark remain unclaimed.

### Round 2 — 237f6575f6

Prompt SHA-256: `e1177881f9e99851f5ad669db0b38b8eab2e3730bb1b1e11d9f5a7df15bcf9fd`. Raw response SHA-256: `b0192ceeceae0ad6ec018109966d7b8074a731433c5290743efd09d17f5377cf`.

**READY**

No material findings. Unsupported `<` `<=` `>` `>=` still refuse with the same code, family, and authored site. Mutation-precondition text is only emitted when `context.effect` is `insert`/`update`/`delete`. Read rules and channel publish/subscribe (unset `effect`) get authorization-preserving text that points at `guide rules` and rejects an automatic `require` rewrite. Supported `=`/`!=` rules and mutation `require` lowering are unchanged.

Table tests cover all four operators across read/insert/update/delete, including the nested nullable-expiry shape and a supported ownership-read plus write-`Require` contrast. Channel tests cover all four operators in both publish and subscribe, including refusal identity and the old mutation-require phrase staying absent. Version `0.0.31` prep and the 0.0.30 digest reconciliation in the parent/child LLPs match the stated scope and do not claim Clique, the 80k-byte target, or the frozen 0.0.29 wave.

I did not run tests. Author-reported 86/86 scoped, typecheck, and 321/321 compiler results are not independently verified here. Optional wording only: the new read/channel text does not say some bounds have no supported equivalent; write-rule `require` advice is the retained pre-existing string, not a new authorization hole introduced by this delta.

Disposition: round 1 treated the inherited channel wording as outside its requested table-rule scope. The integrator independently selected the narrow channel correction after the other actual review; round 2 reviews that completed scope. No finding or test execution is attributed beyond the received text above.


## Public point coverage and diagnostic follow-up — 2026-09-12

Candidate: `2d847b7e9ef794ba5860742376f482f470123d39`; reviewed delta against
`00a22325e2`. Fresh independent Grok review, requested
`grok-4.6` at xhigh; no peer reviews or benchmark narratives
in the inline source packet. Prompt SHA-256:
`3f018bfb0e7d6e581e86dbd755ae9e3e14b6929a565ac9ca3d87ff888a16ed75`.
CLI exited 0 and retained stream audit found zero tool events.
The returned stream identifies `grok-4.6`.
Final text SHA-256: `59028862c921feff845459ac3244a15695cb4f1be084c3df66b6bb4dcb3a080b`.

### Actual returned review

VERDICT: READY

The Get-classification change matches the stated contract: a missing unique-key point under literal `Allow` may stay covered when `CoverageIndex.drained` already holds that complete key, without minting `hasAbsence` / `authorityAbsence` or touching the pooled-object fallback.

### Product fix
In `ClientStore.uncoveredSites` (`snapback2/packages/evaluator/src/store.ts`), a traced point miss is no longer automatically `partial` when all of these hold: `rules.read === 'Allow'`, the index is unique, lookup is empty, and `facts.drained(...)` is true for the prepared full key. That is the right site: `Runner.get` records absences for misses, while owner delivery keeps group exhaustion on the range and only primary `byId` negatives (`offline.rs`). `hasAbsence` / Exists / cap `authorityAbsence` stay on the old facts. Restricted rules, non-unique indexes, truncated/`Limit` pages, bounds, eviction, wrong prefix/index/rule, and receipt removal still go `partial`, as in `test-maintained-address.ts`.

The composite `{ row, count }` cannot use the cached object fallback (`offline.ts` `cachedAnswerOnly` requires no pooled values). Making the twin rerun `fresh` is what lets a pooled row and a proved zero reconstruct together instead of mixing an old complete object with later images.

### Diagnostic
`bound-schema.ts` still refuses `<`/`<=`/`>`/`>=` in rules. Mutation insert/update/delete keep “move … into a mutation require”; read and channel paths (channel bind has no `effect`, so they take the non-write arm) tell the author to keep authorization and not treat `require` as an equivalent rewrite. Tests in `quarry-diagnostic-checks.ts` lock both arms. No grammar or transport change.

### Qualification (as reported, not re-run)
Evaluator corpus, the new contrast block, and the real-owner zero/positive composite (receipt replay, rename, cold reopen, queued removal) are the right controls for this boundary. Gzip 89898 (+55) is inside the 90000 ceiling.

### Optional nonblocking
- Literal `'Allow'` does not include Public IR (`public` / `read <- public`). Uniformly readable Public unique Gets still need a delivered absence; byId public misses already get that. Aligning with `evaluateRule`’s Allow/Public cases would only matter for secondary unique keys on Public tables.
- `uncoveredSites` re-prepares a prefix instead of calling existing `hasCompleteRange`; behavior should match for ordinary scalars.
- New real-owner test does not save/restore `SNAPBACK_URL` (the earlier count test does).
- Working gzip target 80000 remains unmet; that is allocation status, not a new hole in this delta.

### Disposition

READY accepted for the reviewed source delta; integrated full-script and
production-package qualification remain separate requirements. Keep the
80,000-byte target open. The optional structured guide route, broader Public
IR coverage and helper/test cleanup are not claimed in this literal-Allow
repair. No pooled fallback or negative authority guard is weakened to address
those observations. No additional product changes are selected for this round.


## Public point coverage, diagnostic and byte integration — Round 2 — 2026-09-12

Candidate: `d251e00dae743cc214fd70dcebb2fedb7341222e`; comparison base:
`a93edb979a5cbe6357f1fc1f95b66f85bd308844`. Fresh independent Grok review via
Grok CLI, requested `grok-4.6` at xhigh.
Same hash-checked inline source packet; no peer reviews or benchmark narratives
were supplied. Prompt SHA-256:
`1f6e435a64fb3fe19f2bf1bdc77b5c955e28ead9dc684868aa303846e4201bf1`. Source/test diff SHA-256:
`cd4fac9bd604c31dc643a29b7b4dba9c2503d6f726933bf134d74df174a71dad`.

Process PID `13691` exited 0 and was reaped. The retained complete
stream audit found zero tool-use events. Init and assistant metadata report `grok-4.6`; result usage is keyed by `grok-4.6-build`. Effort is requested, not returned-attested. Init advertises 25 tools despite the empty tool request; the complete observed stream has zero tool-use events and reports zero web searches.
Final text SHA-256 (one terminal newline added):
`959b7691ab914a83d806220baafa07ffeaa100259e9d0556e0bd8cdc10166a44`.

The [retained review](../../benchmarks/runs/2026-09-12-snapback2-1023-release-0031/final-code-reviews/grok/verdict.md),
[event/model audit](../../benchmarks/runs/2026-09-12-snapback2-1023-release-0031/final-code-reviews/grok/event-audit.json),
[process record](../../benchmarks/runs/2026-09-12-snapback2-1023-release-0031/final-code-reviews/grok/process.json), and
[prompt manifest](../../benchmarks/runs/2026-09-12-snapback2-1023-release-0031/final-code-reviews/packet.json) bind this actual response.
Only assistant text and sanitized provenance are copied into release evidence;
raw streams, thinking/signatures and auth metadata are excluded.

### Actual returned review

**VERDICT: READY**

The three scoped changes match the stated contract. Writes and exact negative/authority facts stay on their old paths; the new Allow unique-Get shortcut is read coverage only; the value-runtime helpers keep the same equality/order/error behavior.

### Source reasoning

**1. Rule-comparison advice.** `bindRuleExpr` still refuses `<`/`<=`/`>`/`>=`. Insert/update/delete keep “move the bounded comparison into a mutation require”. Read and channel rules (`context.effect` unset in `bindChannel`) tell the author to keep authorization in supported predicates and that a mutation `require` is not an equivalent rewrite. The diagnostic tests cover all four operators on read/insert/update/delete and on publish/subscribe, and they still compile a lawful write `require value > 0`.

**2. Allow unique Get + complete group range.** `uncoveredSites` still requires `!hasAbsence` and `lookup === null` (complete ordinary key via existing `preparePrefix` / `ordinaryColumns`). Only then can `read === 'Allow'` + unique index + existing `hasCompleteRange`/`drained` omit the site. `hasAbsence` / `authorityAbsence` are unchanged, so range exhaustion still does not mint a negative rule fact or primary write authority. `applyMutation` still goes partial on `coverageMisses()`, not this shortcut.

Native controls match the contract: owner-pair and exhaustion-only are fresh; primary absence alone, Limit, wrong key/index/rule, eviction, and `after`/`before`/`gt`/`gte`/`lt`/`lte` stay partial; receipt removal drops coverage; restricted `Eq` does not acquire the shortcut; insert `Not Exists` stays partial with no row; a pooled noncanonical survivor still wins over a canonical primary absence.

Successor/prediction tests encode the same split: exhausted public Count replay is complete; hidden/unheld stay `never-held`; durable composite replay, rename, cold reopen, and queued removal do not revive the deleted row from a held owner answer.

**3. Helper consolidation.** `totalCompare` still rejects non-canonical Bytes on **both** sides before sharing `compareCodepoints` with String/Id; kind order is unchanged (`String` `<` `Id`). `sameValueZero` still fails left then right on Bytes/Row/Array/Map (`E_TYPE`), still shares String/Id text via `asString`, and still uses `canonicalValue` otherwise (including `Int` 0/−0). `valueFromWire` Bytes drops a redundant `typeof` check that `canonicalBytes` already implies.

### Author-reported checks (not rerun here)

Canonical build/self-test, evaluator 266+27, package 206/206, native 23/23, and the 90,042 → 89,993 gzip series are author evidence only. Production packages are still pending. The retained complete-run asset timeout and isolated-owner ENOENT are unchanged environment notes, not findings from this delta.

### Nonblocking

- Literal `'Allow'` is the only IR form that gets the Get shortcut; `{ Public: … }` does not. That matches the stated scope.
- `hasCompleteRange` is keyed with `scalarAtoms(key)` rather than the prefix `lookup` already prepared. After a successful lookup that is the contract; a mismatch would be extra `partial`, not extra completeness.
- Mutation `uncoveredSites` can now omit an Allow unique absence that `coverageMisses()` still treats as missing authority. State remains partial; `hasAbsence` is still false.

### Integrator provenance and limits

The actual R2 verdict is READY with no material findings reported. The quoted
source reasoning is the reviewer's assessment; all qualification figures remain
author-reported to that reviewer, with no reviewer test executions inferred.
The nonblocking byte caveat is explicit: 89,993 gzip bytes leaves only 7 bytes
below the unchanged 90,000 ceiling, and the 80,000 target remains unmet.
Production-package qualification and release decisions remain separate; this
record makes no new publication or Clique outcome claim.
