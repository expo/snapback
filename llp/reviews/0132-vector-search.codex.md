# LLP 0132 vector search review — Codex family


## Round 1 — 2026-07-31

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-07-31
**Method:** fresh CLI runner, read-only sandbox, blind to this Spec's fable artifact
**Target SHA-256:** `c78fe10dc6086bfa3db67d639324e33267e2ff72eadbd99829dfc7c8ac46d57b`
**Status:** completed

## Verbatim review

## Overall assessment

LLP 0132 is faithful to decision 8 and technically strong, but **NOT READY**. Four unresolved MATERIAL concerns prevent LLP 0130 SD-4 convergence, including one potential evidence-boundary weakening.

I reviewed target SHA-256 `c78fe10dc6086bfa3db67d639324e33267e2ff72eadbd99829dfc7c8ac46d57b` and did not read any `llp/reviews/0132-*.fable.md`.

### Arithmetic verdict

The finiteness arithmetic in [LLP 0132](/Users/ccheever/projects/snapback/llp/0132-vector-search.spec.md:127) is correct:

- With \(|a_i|,|b_i|\le2^{100}\), \(|a_i-b_i|\le2^{101}\).
- Each L2-squared term is at most \(2^{202}\); 4,096 terms give \(2^{214}\).
- Each dot term has magnitude at most \(2^{200}\); 4,096 terms give \(2^{212}\).
- Correctly rounded addition is monotone, and the all-maximum sequences attain those bounds exactly, so rounding cannot push an accumulator beyond them.
- Both bounds are far below binary64 overflow.

Strict binary64 operations, round-to-nearest-ties-even, sequential dimension order, and forbidden contraction/reassociation/excess precision are sufficient for bit-exact results on conforming targets. The profile should explicitly call out gradual underflow and prohibit FTZ/DAZ, though “correctly rounded binary64” already implies that.

The 1,536-dimensional case is arithmetically compatible with the \(2^{26}\) product rule: its largest valid partition is 43,690 vectors because \(1536\times43690=67,107,840<67,108,864\); 43,691 exceeds the ceiling.

## Strengths

- It follows decision 8 exactly: new Spec beside LLP 0073, exact k-NN first, external embeddings, ANN only through separate capability admission, and the float rider decided here.
- The arithmetic profile is unusually precise and appropriately refuses fast-math shortcuts.
- Snapshot selection, authorization pushdown, scoring, hydration, and release recheck occur in one read snapshot. This genuinely removes Diary 0031’s Convex action/query seam without weakening commit-version evidence.
- Pre-filtering is the right exact-scan design: unauthorized rows never affect top-k selection, ranks, result counts, or logical scoring work.
- Synchronous index maintenance makes update, ownership-transfer, and deletion behavior deterministic at the commit head.
- Release pushdown is correctly distinguished from authorization; authoritative source recheck and RFC 8785 digest agreement gate every existence fact and result.
- The ANN successor doors are honest: exact acceleration requires a construction-level top-k superset, while approximation gets a distinct capability and evidence vocabulary.
- Nonclaims are excellent: no embeddings, ANN, hybrid ranking, relational visibility, hosted target, live query, pagination, external store, sensitive indexing, or client/offline search.
- The metrics, bounds, filtering, consistency, and storage choices are legitimate owning-Spec adjudications of LLP 0124’s questions. I found no improper expansion beyond decision 8.

## Concerns

### MATERIAL — Public-read classification is not closed

Lines 92–104 allow a vector field classified `public` or `private`, then independently allow `public-read` visibility. They never explicitly reject a public-read index over a private vector. Filter and stored-field classification rules are also not closed.

LLP 0073 explicitly requires every match, filter, score, stored, and highlight input in a public-read index to be public. Because an embedding inherits the custody of its source, releasing a similarity derived from a private embedding would weaken that boundary and engage LLP 0130 ER-2.

Resolution:

- `public-read`: vector, filters, and stored/released fields must all be `public`.
- `owner.v1`: participating fields may be `public|private`.
- `sensitive|forbidden`: rejected in every participating role.
- Index/encryption custody must be at least as restrictive as all participating fields.
- Add generation negatives and paired public/private evidence.

### MATERIAL — Logical-work noninterference is underspecified

Lines 243–257 claim that work accounting and admission range only over the caller’s partition, and acceptance compares work accounting. But the Spec never defines the logical-work transcript.

It is unclear whether it counts posting rows, filter comparisons, admitted candidates, scalar operations, source reads, or all of them. The \(2^{26}\) declaration ceiling bounds one category but does not define observable runtime accounting. Therefore the paired-database claim is not presently falsifiable.

Resolution: define a closed work object and evaluation order covering partition lookup, filter work, scored candidates/scalar pairs, release reads, limit precedence, and observable inspection fields. Semantic counters and work-limit outcomes must depend only on the caller’s partition; physical pages, caches, elapsed time, cancellation, and machine loss should remain outside the transcript.

### MATERIAL — The arithmetic corpus overclaims universal detection

Carefully chosen vectors can detect FMA contraction, selected reassociations, x87 excess precision, and FTZ/DAZ on the exercised kernel. But lines 391–397 claim that “a nonconforming build” will fail the corpus. No finite corpus proves that universally: an optimizer may violate the profile only for another loop width, dimension-specialized kernel, or code path.

Resolution:

1. Commit explicit bit-pattern witnesses and expected outputs for each metric and named failure mode, including FTZ/DAZ.
2. Exercise every compiled scalar/SIMD/dimension-specialized kernel.
3. Retain build or executable-inspection evidence proving strict FP flags, no contraction/fast-math, no excess precision, and exact kernel identity.
4. Say honestly that the corpus detects named transformations on exercised kernels; conformance comes from implementation controls plus kernel coverage plus corpus results.

Defining `delta = round64(a[i]-b[i])` once before squaring would also make the L2 operation sequence unambiguous.

### MATERIAL — The realistic-scale acceptance floor is gameable

“At least 1,536 dimensions at its generation-validated partition bound” does not pin a meaningful corpus cardinality. Because the bound is application-declared, a one-vector index satisfies the literal text. If “the bound” instead means the maximum permitted value, it requires 43,690 vectors—an entirely different commitment.

Resolution: pin a minimum cardinality or a dimension-by-cardinality matrix and require the fixture to fill its declared bound. Record exact vector bytes and scalar-pair count in the budget receipt. Separately state what demonstrates realistic width and what demonstrates corpus-scale behavior.

### MINOR — The cosine recipe needs its preconditions

Dot ranking equals cosine ranking only when both stored and query vectors are consistently normalized and nonzero. With binary64 normalization, Snapback computes an exact pinned dot product over the rounded supplied components; it does not reproduce exact-real cosine over the original vectors.

Resolution: require normalization on both sides, reject or define zero vectors, recommend a versioned normalization producer, and describe the claim as portable dot ranking over application-normalized binary64 vectors.

## Suggestions

- Consider a metric-neutral `score` field; `distance` contains a similarity under `dot`.
- Define the exact source projection included in the release digest: vector, visibility field, filters, stored fields, row/source version.
- Add explicit boundary evidence that 43,690 vectors admit at 1,536 dimensions and 43,691 refuse.
- State gradual underflow and FTZ/DAZ prohibition explicitly.
- Clarify whether targets may advertise multiple optimized kernels; every path must be qualified.

## Open questions

1. Is `VectorItemV1.distance` intentionally used for dot similarity?
2. Which logical-work fields are public inspection facts versus receipt-only evidence?
3. Is the intended 1,536-dimensional corpus 43,690 vectors or a smaller pinned cardinality?
4. Will implementations have one strict scalar kernel or multiple dimension-specialized/SIMD kernels?

## Verdict

**NOT READY**

Recommended next step: revise while Draft, closing the classification matrix first because it is an ER-2 issue. Then define logical-work observations, replace the universal corpus claim with combined implementation-control and witness evidence, pin a meaningful scale matrix, and tighten the cosine recipe. Commission a mutually blind Codex-family re-review afterward.

I attempted to record this as `llp/reviews/0132-vector-search.codex.md`, as LLP 0005 requires, but the workspace is read-only and rejected the write. No LLP status was changed.
