# Package byte attribution — 2026-09-11

Read-only production investigation at `b3b063b4e`; accepted reference `bf650aebb`, pristine `bf8450849`. All twelve canonical totals reproduce exactly with Node 24.18.0 / esbuild 0.25.9 / gzip level 9. Builds ran serially in ignored source copies; shared dist and EPYC were untouched.

| Canonical gzip bytes | Accepted | Pristine | Current |
| --- | ---: | ---: | ---: |
| client | 136,547 | 142,125 | 145,189 |
| React | 146,166 | 152,478 | 155,056 |
| Expo | 149,836 | 156,010 | 158,589 |
| complete local runtime | 84,580 | 88,008 | 88,053 |

`packagedEntryBytes` sums each independently gzipped reachable emitted leaf once **within an entry**. Its leaf contributions below are additive. The public entries overlap and their totals must not be added. Complete runtime is the separately bundled canonical five-root implementation, including Unicode data.

| Emitted leaf, gzip bytes | Accepted | Pristine | Current | Four-plan delta |
| --- | ---: | ---: | ---: | ---: |
| client-runtime.mjs | 90,338 | 101,120 | 103,955 | +2,835 |
| client.mjs | 24,081 | 18,878 | 19,107 | +229 |
| image-runtime.mjs | 22,128 | 22,127 | 22,127 | 0 |
| react-core.mjs | 3,080 | 3,069 | 2,495 | −574 |
| internal.mjs | 1,103 | 1,168 | 1,255 | +87 |
| react.mjs | 5,436 | 6,116 | 6,117 | +1 |
| expo.mjs | 9,106 | 9,648 | 9,650 | +2 |

Client reaches the first three leaves. React additionally reaches react-core, internal and react. Expo additionally reaches react-core, internal and expo. Their deduplicated seven-leaf union is 155,272 → 162,126 → 164,706 gzip bytes; that union is diagnostic, not a replacement measurement root. React/Expo leaf raw sizes are unchanged by four plans; their +1/+2 gzip shifts arise from emitted identifier context.

Full per-source/module contributions for all three versions and the complete runtime are in `bytes-module-contributions.csv` and `bytes-attribution.json`. These are esbuild **minified emitted bytes**, including an explicit framing residual; source-module gzip sizes are not additive. The exact four-plan change across the seven-leaf union is:

| Source module | Minified emitted delta |
| --- | ---: |
| client-pages.ts | +5,483 |
| client-outbox-recover.ts | +1,052 |
| client.ts | +833 |
| client-outbox-observed.ts | +673 |
| client-observed.ts | +409 |
| client-outbox.ts | +289 |
| client-items.ts | +148 |
| store/row-values.ts | +117 |
| snapshot.ts | −96 |
| react-core.tsx | +76 |
| store/success-compaction.ts | +7 |
| All source modules | +8,991 |
| Bundle framing/forwarding | +276 |

`client-pages` moved from react-core into the shared client runtime as it grew; the table follows source identity across leaves. The complete runtime grew only 124 minified / 45 gzip bytes. Accepted→pristine module deltas are separately retained in `bytes-module-delta-accepted-pristine.json`.

## Bounded sharing candidates

The already loaded image-runtime and client-runtime both emit these source bodies. Partial tree shaking means raw overlap is evidence of duplication, not the predicted saving:

| Existing source | client-runtime raw | image-runtime raw | Duplicate function declarations by source map |
| --- | ---: | ---: | ---: |
| value-runtime.ts | 13,645 | 9,736 | 35 |
| hash.ts | 2,234 | 2,183 | 5 |
| certificate-identity.ts | 9,538 | 5,639 | 20 |
| cursor.ts | 5,936 | 4,853 | 9 |

1. **Share all four through existing image-runtime.** Two-file patch, no new entry or runtime algorithm: extend the existing build redirect and re-export the same source bindings. Measured client **139,382 (−5,807)**, React **149,192 (−5,864)**, Expo **152,724 (−5,865)**. All 69 previously duplicated function declarations become single emitted definitions across client/client-runtime/image-runtime. The image leaf grows 3,360 gzip bytes while client-runtime shrinks 9,164; both remain counted.
2. **Smaller hash + value-runtime subset.** Same two files and fewer forwarded modules. Client **142,633 (−2,556)**, React **152,463 (−2,593)**, Expo **155,995 (−2,594)**. Hash alone saves 1,190 bytes per closure. These alternatives overlap; savings must not be added.

All six isolated experiments pass existing `node build.mjs --self-test`, including three export conditions, actual SQLite/file swaps, canonical constructors, public forwarding-alias exclusion and declaration duplication rejection. All retain the exact same closure leaf lists. Each complete-runtime artifact is byte-identical to current, **88,053 gzip bytes**. This is package-boundary evidence, not a completed full product regression qualification. Exporting the shared value module also retains three previously tree-shaken helper declarations; the measurements include that cost.

No runtime source function, hash algorithm/domain, authority, receipt, retention or recovery behavior was edited. No safe behavior-preserving deletion was established. Duplicated carrier metadata/projection bodies in React versus Expo do not establish savings for either individual entry: each already loads one copy, so a cross-carrier shared leaf would need a separate real closure measurement. Further module expansion stopped here.

**Both candidates still exceed every accepted 1% growth guard.** Neither grants package qualification or an accepted baseline. The complete-runtime ceiling remains green at 90,000, target remains 80,000.

## Reproduction and retained evidence

- Exact attribution: `node runs/followup-diagnostics-20260911/bytes-attribution.mjs` (canonical toolchain assertions embedded).
- Candidate measurements: `node .../bytes-experiment-measure.mjs` and `node .../bytes-adjacent-measure.mjs`; summaries in `bytes-candidate-summary.json`.
- Each ignored copy: run `/Users/ccheever/.volta/bin/node build.mjs --self-test` from `bytes-experiment-*/snapback2/packages/snapback2`. Metafile-only instrumentation adds no semantic build option beyond `metafile:true`.
- Review patches: `bytes-sharing-primitives.patch` and `bytes-sharing-value-hash.patch`; instrumentation excluded. The four-module patch passes `git apply --check` against current production sources.
- Source-map audit: `bytes-source-map-audit.json`; exact input/source, emitted artifact, map and test-log SHA-256 values: `bytes-evidence-manifest.json` and each selected copy's `source-files.sha256`.
