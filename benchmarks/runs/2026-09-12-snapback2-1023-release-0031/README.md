# LLP 1023 follow-up — 0.0.31 qualification

Status: source repair and complete test qualification pass; final dual-platform package qualification and publication are pending. The frozen Clique apps still use 0.0.29.

The owner can return a complete `{row, count: 0}` answer and deliver an exhausted empty public grouping range. The durable twin previously overlooked that range when classifying a missing unique Get, publishing partial/unavailable at the same sequence. The repair consumes that existing proof only for literal-Allow, unique-key read coverage. It does not create negative rule authority, relax pooled-row fallback, or identify a grouping row by its canonical generated ID. Existing bounded/truncated/wrong-rule/removed-proof cases remain partial.

The compiler follow-up preserves unsupported comparison refusal while correcting its repair advice: mutation `require` is not an equivalent authorization rewrite for reads or channels. No grammar or diagnostic family is added.

Reviewed product source: `2d847b7e9ef794ba5860742376f482f470123d39`, delta against `00a22325e2`. Both actual independent reviews return READY: [Sol](review-sol.md), [Grok](review-grok.md). Their retained audits report zero tool calls; the source packet and model-attestation limits are recorded. The subsequent `b9d96fb5cc` changes only the existing successor test to require complete empty-range proof for zero and retain an unrelated unheld-group control. Full qualification ran at `eb681b85a1b01d69fefab28973a165cb6a06424f`.

## Qualification

- [Complete EPYC script](full-integrated-epyc-r2.json): exit 0, 170.70 seconds with the existing package 2/native 8 concurrency settings. All 1,451 package tests, 1,204 native tests, compiler checks, evaluator checks, doctests and artifact isolation pass. This is functional qualification, not a 60-second loop claim.
- Focused repair evidence: [original reproduction](coverage-reproducer-result.json), [qualified repair](coverage-repair-result.json), and [successor18/18](successor-qualification.json). The owner case covers subsequent publication, update, cold file-carrier reopen and admitted removal; 402 custody/twin controls and the unchanged timed Insights witness pass. It is not an IndexedDB or repaired-actor witness.
- Earlier complete runs remain failures. The local combined run found the old successor expectation and an asset timeout; the successor assertion was corrected, and the unchanged asset control passed its original 10-second limit in 7.26 seconds. The first EPYC run had one generic isolated-owner ENOENT; its unchanged file passed 9/9, then the unchanged complete script passed. The existing [owner-IO issue](../../../issues/20260911-snapback2-effects-visibility-derived-only-owner-io-flake.md) retains that unresolved signature; no external/transient cause is established.
- [Darwin initial production stage](darwin-initial-process.json): 29 installed-consumer checks pass with Hermes and the full media helper. This initial artifact is not yet the final shared Darwin/Linux shim.
- [Pinned loop measurement](measure-local.json): all measured timing steps pass. Five-root runtime is 89,898 gzip bytes, +55 for the coverage repair and 102 below the unchanged 90,000 ceiling. Client/React/Expo packaged closure sizes are 143,034/152,987/156,440. The inherited historical 1% byte comparisons still fail; no baseline is reset. The 80,000 target remains unmet.

The product delta in this record predates the subsequent acquisition changes on main. Integration checks and final package receipts will be added before claiming their combined publication. No grade, score, native-device success or causal experience improvement is claimed here.
