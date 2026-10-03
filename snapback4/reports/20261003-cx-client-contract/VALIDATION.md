# CX research validation — 2026-10-03

Base: `e15de2e49a084f75c0878ca19fdeb15dd4e7a7a3` on
`sb5/cx-client-contract`. This change contains research, issues, documentary
measurements and a journal entry. It changes no product code or guide source.
The local commit is recorded in `/home/ccheever/sb5-lanes/cx.report.md`.

## Research checks

- 79 selected quotations: each is an exact substring on its recorded physical
  source line; every source file matches its recorded SHA-256.
- 14 builder code excerpts: full-file hashes, inclusive line/column spans,
  exact excerpt text, UTF-8 bytes, physical lines and nonblank lines match.
- 31 score records: all category scores and notes match the original score
  JSON, including the separately nested Grok comparative format.
- 26 category/overall fits: means, slopes, residuals and R² independently
  recomputed for the primary and sensitivity series. Every attributed quote's
  mean deviation and trend residual also recomputed.
- 30 independent grader reports: source hashes and raw assertion-result counts
  match. G47 has no such report in its repository record.
- All 33 matching run directories are inventoried; all inventoried narrative
  hashes match. The external Cal29 bundle and differently named G47 record are
  additional sources, explicitly identified in the corpus inventory.
- Relative Markdown file links and heading anchors checked across the LLP,
  five tickets and authored report pages. The documentary Cal29 copies are
  preserved unchanged, rather than rewritten to adapt their original context.

The arithmetic can be reproduced with the Python block in [CORPUS](./CORPUS.md).
For quotation checking, read `source`, check SHA-256 against `source_sha256`,
then require `quote in text.splitlines()[line - 1]`. For each code specimen,
check `source` against `sha256`, slice its inclusive 1-based line/column span,
and compare to `excerpt`, `bytes`, `physical_lines` and `nonblank_lines`.
Columns count Unicode characters; `bytes` counts UTF-8. Selected excerpts
exclude the final newline. Whole-file hashes include it.

Original builder sources are outside this checkout. Cal29 was read from
`/Users/ccheever/clique-sb4-20261001-astra-cal29/lanes/astra-snapback4` on the
original M1 host into `/tmp/cx-cal29` for measurement. Its diary, essay and
schema match the supplied bundle byte-for-byte. G47 source was read from
`/home/ccheever/clique-cmp-20260928-047/lanes/grok-snapback4`. A later auditor
can restore those source files at the dataset paths or adapt the source prefix;
the hashes, precise spans and excerpts remain in the committed dataset.

Current behavior was checked by reading the code listed in LLP 3000.032 §3.
No runtime probe, new test, full product suite or performance qualification is
claimed. The proposed APIs have not been implemented or typechecked.

## Requested repository checks

`./ref-check --verbose`: **passed**, 526 LLP documents, zero errors and zero
unchecked references. The initial clean-tree run also passed with 525 LLPs.

`node scripts/check-guide.mjs`: **failed**, with 13 passed, 7 failed, 1 skipped,
1 precondition, and 123 warnings. The full output is retained in
[guide-check.txt](./guide-check.txt). Failures concern unchanged repository
inputs and missing generated artifacts:

| Check | Reported cause |
|---|---|
| Diagnostics registry | Three generated diagnostic artifacts stale |
| Guide corpus | Six legacy authoring-profile baseline mismatches; missing generated demo example |
| Capability index | `guide/capabilities.md` is 63,496 bytes against a 63,488-byte budget |
| Rosetta record | The same capability-index size error |
| Retrieval routing | The same capability-index size error |
| Generated API cold signatures | Assertion expects inline `readonly profiles?: readonly {`; current generated declaration uses `readonly VerifyProfile[]` |
| Manifest / MCP projections | Hash/byte-count mismatches; manifest comparison also requires missing generated demo artifacts |

The symbol registry skipped because `@expo/snapback-contract` was unavailable;
snippet transclusions reported missing generated demo artifacts. These are
distinct from the cold-signature assertion failure. No guide, registry, demo,
generator or package input was changed by CX, and no baseline repair or
generation was attempted in this research-only lane. This is a recorded red,
not a guide-check pass or a publication qualification.

`git diff --cached --check`: **passed** for the staged documentary change.
No push or publication is part of this lane.
