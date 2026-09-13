# LLP 1023 follow-up — 0.0.31 qualification

Status: **published 0.0.31**. Source repair, functional qualification, affected integration checks, both final code reviews and both platform package qualifications pass. All three registry integrities match. The frozen Clique apps still use 0.0.29.

The owner can return a complete `{row, count: 0}` answer and deliver an exhausted empty public grouping range. The durable twin previously overlooked that range when classifying a missing unique Get, publishing partial/unavailable at the same sequence. The repair consumes that existing proof only for literal-Allow, unique-key read coverage. It does not create negative rule authority, relax pooled-row fallback, or identify a grouping row by its canonical generated ID. Existing bounded/truncated/wrong-rule/removed-proof cases remain partial.

The compiler follow-up preserves unsupported comparison refusal while correcting its repair advice: mutation `require` is not an equivalent authorization rewrite for reads or channels. No grammar or diagnostic family is added.

Reviewed product source: `2d847b7e9ef794ba5860742376f482f470123d39`, delta against `00a22325e2`. Both actual independent reviews return READY: [Sol](review-sol.md), [Grok](review-grok.md). Their retained audits report zero tool calls; the source packet and model-attestation limits are recorded. The subsequent `b9d96fb5cc` changes only the existing successor test to require complete empty-range proof for zero and retain an unrelated unheld-group control. Full qualification ran at `eb681b85a1b01d69fefab28973a165cb6a06424f`.

## Qualification

- [Complete EPYC script](full-integrated-epyc-r2.json): exit 0, 170.70 seconds with the existing package 2/native 8 concurrency settings. All 1,451 package tests, 1,204 native tests, compiler checks, evaluator checks, doctests and artifact isolation pass. This is functional qualification, not a 60-second loop claim.
- Focused repair evidence: [original reproduction](coverage-reproducer-result.json), [qualified repair](coverage-repair-result.json), and [successor18/18](successor-qualification.json). The owner case covers subsequent publication, update, cold file-carrier reopen and admitted removal; 402 custody/twin controls and the unchanged timed Insights witness pass. It is not an IndexedDB or repaired-actor witness.
- Earlier complete runs remain failures. The local combined run found the old successor expectation and an asset timeout; the successor assertion was corrected, and the unchanged asset control passed its original 10-second limit in 7.26 seconds. The first EPYC run had one generic isolated-owner ENOENT; its unchanged file passed 9/9, then the unchanged complete script passed. The existing [owner-IO issue](../../../issues/shelved/20260911-snapback2-effects-visibility-derived-only-owner-io-flake.md) retains that unresolved signature; no external/transient cause is established.
- [Darwin initial production stage](darwin-initial-process.json): 29 installed-consumer checks pass with Hermes and the full media helper. This initial artifact is not yet the final shared Darwin/Linux shim.
- [Pinned loop measurement](measure-local.json): all measured timing steps pass. Five-root runtime is 89,898 gzip bytes, +55 for the coverage repair and 102 below the unchanged 90,000 ceiling. Client/React/Expo packaged closure sizes are 143,034/152,987/156,440. The inherited historical 1% byte comparisons still fail; no baseline is reset. The 80,000 target remains unmet.

### Combined acquisition source

The complete qualification above predates concurrent acquisition changes on main. The merge actually incorporated `a93edb979a5cbe6357f1fc1f95b66f85bd308844`; the earlier [compatibility assessment](acquisition-integration-review.json) examined `638b74fb9f`. The remote-tracking ref moved between capture and merge. The [actual-parent reconciliation](metric-actual-parent-reconciliation.json) restores one additional main metric row in each append-only file; the earlier [union](metric-history-union.json) remains a record of its narrower inputs.

The actual merged runtime initially measured 90,042 bytes, exceeding the ceiling. Three bounded simplification rounds in `d251e00dae743cc214fd70dcebb2fedb7341222e` reach **89,993 bytes**, leaving only **seven bytes**. The [retained result](combined-funding/RESULT.json) binds the source, rejected intermediate measurements and final checks: the evaluator differential corpus and primitive/coverage controls, 206 package tests, 23 native tests, package self-test and reference checks all pass. The change shares existing complete-range and primitive value helpers while retaining negative-authority, byte validation and type distinctions. The 80,000 target and the 150-byte headroom aim remain unmet.

Both fresh final source reviews against the actual main parent return READY ([exact final packet and audits](final-code-reviews/manifest.json)); the exact texts and tool/model attestation limits are retained in the existing LLP code-review documents. Reviewers inspected source and supplied qualification records; neither independently ran the tests. The prior complete suite, incoming-main qualification and affected combined checks support integration; no new complete-suite or 60-second-loop result is claimed for `d251e00`.

[Darwin staging of the funded source](darwin-funded-initial-process.json) passes all 29 installed-consumer checks with production Hermes and full media in 157.74 seconds. Final shared Linux/Darwin shim qualification and package publication remain pending. No grade, score, native-device success or causal experience improvement is claimed here.

### Later main integration and budget disposition

Main subsequently added adjacent final proof-check reuse in `69d9bcfde7`,
retained by merge parent `fff6fe112da64136ce77999f465081fdc31d2b1b`.
The merge has no semantic conflict. The independent integration read found
no authority incompatibility: only exact retained key/digest pairs are reused
within one synchronous frame, after extent changes finish. Nevertheless,
the actual combined runtime is **90,012**; one sound redundant-presence-test
removal reaches **90,003**, still refusing the unchanged ceiling. A proposed
single-use temporary removal was inapplicable because the variable has several
uses; it caused no edit or measurement.

The optional adjacent-check optimization is deferred in this combined release.
Restoring its preceding block makes every tracked Snapback 2 file outside
metrics identical to reviewed `d251e00dae`. All earlier acquisition work
remains, and the existing [acquisition plan](../../../llp/1018.008.007.002-bounded-bulk-acquisition.plan.md)
records the deferred experiment and its original successful standalone samples.
This keeps the confirmed correctness repair within the frozen allocation;
it does not fund the 80,000-byte target. The rejected candidates and metric
rows remain evidence, not shipped code.

Linux staging of `d251e00dae` passed all 29 production installed-consumer checks
in 255.66 seconds. Both platform stages now pass on this product content; final
Darwin qualification with the shared Linux/Darwin shim and publication remain
pending. New main history and every append-only metric row are preserved.

The [restoration record](deferred-adjacent-proof/RESULT.json) verifies all 1,181 tracked Snapback 2 files outside metrics against `d251e00dae`. Canonical build/self-test passes and the final five-root measurement returns **89,993** bytes. No product tests or independent source reviews are rerun for identical content.

### Source landing after schema-digest reuse

Main then added existing immutable schema-digest reuse in `5fa5726bdc`,
integrated from fixed parent `b07260d53ad3ec148f2320f085a87327898efabf`.
The [merge record](merge-b07260d/result.json) preserves both append-only histories
and both LLP paragraphs. Source merged at `cc1112a32c` retains the adjacent-proof
deferral and passes the complete evaluator corpus, including the new immutable
memo controls, maintained-address coverage and primitive helper tests: 266
shared cases plus the stated server-only exclusions. Its combined runtime is
**89,983** gzip bytes, 17 below the ceiling; the 80,000 target remains unmet.
This reuse changes imports, store construction and certificate schema hashing;
mutable callers and every program identity still rehash. No additional native
or broad package rerun is warranted for that input.

**Publication stays bound to the immutable `d251e00dae` product artifacts**,
at 89,993 runtime bytes, which both platforms qualified. The later schema-digest
reuse on main is outside this package cut. Final Darwin staging imports the
exact Linux-qualified full-platform shim. Its first invocation refused a local
receipt whose tarballs had not yet been copied; after transferring and checking
the two required tarball integrities, canonical qualification was restarted.
No failed invocation is a passing consumer result.

### Publication complete — 2026-09-12

Source landed at `cc40e2b78e08b1c0ae91aba464903c4a519aa96e`. Final Darwin
qualification of the exact Linux-qualified full-platform shim passed all 29
installed-consumer checks in **34.56 seconds**. Both native artifacts retain
production Hermes and the full media helper. The [qualification receipt](qualified-resume.json)
binds both native integrities to the same shim.

The existing publisher completed at **11:01:35 UTC** in 156.36 seconds.
At **11:03:56 UTC**, [registry verification](registry-post-publish.json) matched
all three 0.0.31 artifacts to the [qualified integrities](canonical-artifacts.json).
The publisher and its observed process group are reaped/empty. The earlier
missing-transfer refusal remains recorded separately. Reference checking passes;
the sole cap failure remains the inherited Snapback 1 file at 1,504 lines
(205 oversize files against a 204-file baseline), outside this change.

The query child closes its scoped source follow-up. The parent retains the
unmet 80,000-byte objective and fresh-wave outcome limits. Publication proves
this repaired package's qualified behavior; the unchanged 0.0.29 builders
provide no fresh adoption evidence for this follow-up.
