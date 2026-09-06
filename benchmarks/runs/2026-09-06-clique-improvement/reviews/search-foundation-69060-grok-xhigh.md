**Review:** `69060c4b1f83c2962ce2b406ff15bd37b598c84b` vs `62fa434d842e4cefd8656d5fe18aaf2b567a6690`  
**Model:** Grok 4.6 (independent, read-only)  
**Scope:** Unicode 17 / logical-key foundation only. Parent `1c247a9a8` is owner-harness cleanup and is not in this diff. Official UCD was hash-checked, not dumped.

## Verdict: READY

No material findings. I did not find an unsound frozen contract that would block later `wordPrefixes` / held-twin integration.

## What was checked

Pinned inputs match `SHA256SUMS` (UnicodeData, CaseFolding, PropList, DerivedNormalizationProps, NormalizationTest). Shared table digest is `29bb626c…b9e8`. C/S fold count is 1512 with no multi-scalar C/S maps; canonical decomposition arity is ≤2; NFC test rows are 20034, longest field 18 scalars.

Rust/TS agree on the live contract:

- `NFC(simpleFold(NFC(text)))`, C/S only, boundaries `White_Space ∪ P*`
- Text domain is the existing C0-except-TAB/LF/CR rule; low-level NFC stays total on scalars
- Optional null fields contribute nothing; query tokens are counted before dedup (`foo foo` / `foo-bar` refuse)
- Q is independent of field maxima (`É` at Q=1 equals `É` at Q=2)
- Descriptors compare by prepared meaning; `ca` does not cover `cat`; empty search matches nothing
- Canonical wire is compact tagged JSON, field-order sensitive, `4Q+63` (wrapper is 63 bytes; 4-byte scalars sit on the bound)
- Scratch/step helpers are logical ledgers, not RSS; reused scratch keeps the high-water mark
- `Schema::Index` / IR / `words()` / native postings are unchanged

Source files are all ≤358 lines. Generated tables go to `OUT_DIR` / `packages/evaluator/dist/` (gitignored). One core `build.rs` plus existing `build.mjs --unicode-only`; `sha2` is only a build-dep of an existing crate. No new gate, registry, Unicode crate, or runtime generator.

The Node 25.9 owner-session cancellation is not caused by this diff.

## Nonblocking limits and later obligations

These are not defects in this commit:

- Twin 34,000 gzip / 30,000 target, 1M-step / 4 MiB / 8 MiB / 1 MiB, native postings, certificate identity, Quarry `wordPrefixes`, and held `h1` cursors remain unmeasured and unwired. Additive 10,859 gzip on `62fa` is not an integrated certificate.
- Query is one normalized token. Phrase input such as `hello world` is `E_INPUT` until a later lane defines multi-token search.
- Accents are kept; C/S folding does not map `İ→i` or `ß→ss`. That is the pinned contract.
- `matches_normalized_word` trusts an already-normalized word (`search_key.rs` / `search-key.ts`). Callers must pass `search_field_words` output.
- Canonical JSON is `serde_json` / `JSON.stringify` as used here (U+2028/U+2029 raw UTF-8). Re-prove that on Hermes/Expo before those arms emit descriptors.
- `normalization_step_bound(0)` is exact (1028). Do not add empty-path counters without moving the helper.
- Downstream `words()` must carry `U=4N` through list/loop aliases; do not divide element width by `W`.

No further implementer round-trip from this review.
