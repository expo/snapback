One **Medium blocker** remains. The earlier review findings are fixed.

**Medium — unrelated writes destroy offline fallback answers.** [local.ts:275](/home/ccheever/sb4-intent/review-pq-r3-astra/snapback4/packages/snapback4/src/local.ts:275).

The new filtering passes only affected watches to `answers.committed()`, but [local-reads.ts:159](/home/ccheever/sb4-intent/review-pq-r3-astra/snapback4/packages/snapback4/src/local-reads.ts:159) still clears **all** remembered server answers. Unaffected watches receive no replacement evaluation, leaving their offline fallback empty.

Concrete reproduction:

1. Observe `exists remoteRows['r']` over an online-only table with `keep: true`; receive `true`.
2. Apply a write to an unrelated replicated `notes` table.
3. Go offline.
4. The observation becomes `{ loading: true }`; a direct read returns `E_OFFLINE`.

Reproduced on **wasm and process**. Both preserve the answer on `4fd338de5`; both also preserve it without the unrelated write.

**Smallest fix:** carry the known footprint into remembered-answer invalidation and preserve entries whose recorded dependencies are disjoint. Keep full clearing for unknown footprints and scope resets. Add the unrelated-write → offline regression. **Blocks landing.**

What is sound:

- The port introduces no dependency on removed LV code or restoration of its withdrawal subsystem. Ordinary commits retain according to LLP 3000.023; expiry and resets still withdraw.
- Queue bounds, FIFO fairness, cancellation, lifetime release, delayed retries, canonical keys, and due-only clock sweeps passed targeted checks.
- The prior findings have detecting tests. I independently removed the fixes in isolated copies:

| Removed protection | Detecting failures |
|---|---:|
| Unknown-footprint final drain | 2 |
| Floor rejection without updating the watch | 9 |
| Reset-version fences | 9 |
| Queued local `keep: false` transition | 2 |
| Final local floor checks, queued and presence | 12 |
| Abort-diagnostic guards | 3 |

The unchanged implementation passed **355 targeted tests**, including both React witnesses. The 1,000-hook zero-loading test freezes the episode clock: it proves queue retention, not zero loading beyond the existing one-second default episode.

A surviving mutation: deleting only the publication-callback `resetVersion` comparison at [local.ts:1013](/home/ccheever/sb4-intent/review-pq-r3-astra/snapback4/packages/snapback4/src/local.ts:1013) still passes all **145 queue/publication/expiry tests**. The earlier comparison covers their reset interleaving. This is a coverage limitation, not another demonstrated defect.

All builds, tests, and mutations ran in temporary copies. The checkout is unchanged. I did not rerun the full suite.

**NOT READY**