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
