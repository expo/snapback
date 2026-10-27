# REL3 qualification

Runtime source: `da57c979f45e920cf9e0e00a285b19922b4df63a`, with main
`98177aa48b` merged. The final native and packed-client digests are in
`merged-consumer-summary.json.gz`; no package version changed and nothing was
pushed or published.

`summary.json` indexes the deterministic compressed evidence and its hashes.
The complete 150-store corpus has 728 successful moves, 22 baseline refusals,
294 consistent rollback populations, no new false refusals and no hidden v1
rows. The eleven requested wave31 lanes have 55 successful moves and 22
consistent rollback populations. Frozen-client probes make 38 returned asset-value hash comparisons
across two cycles; the original 041 damaged-store positive and old-binary
negative are retained separately. All ten affected publication consumer groups
and the additional private mutation-result HTTP control pass on the installed
native digest.

The unmodified affected selector supplied the complete 31-command plan. Build
prerequisites ran sequentially; independent crate and client/check groups then
ran in parallel, retaining the selected arguments, features and deadlines.
`affected-raw.json.gz` is the actual receipt, including its failures. The
executor is retained as provenance, not a new product verification tool.

Three nonzero stage results require reading their evidence rather than treating
this as an entirely green raw run:

- The CLI crate fails only `store_port_ratchet`: two unchanged production matches
  reproduced by compiling the scanner from a private archive of unmodified
  `98177aa48b`. The scanner and emitting files are byte-identical to that main.
- The client pool's `horizon-boundary` fixture export timed out waiting for Cargo
  during parallel compilation. All 47 failures share the same cached rejected
  build promise. The unchanged complete file subsequently passes all 82 tests.
- Lean's 2,000-case run retains Integration27's exact 18 disagreements, oracle
  totals and all 16 reproducer file hashes. The ordinary 2,000-case run passes.

All other selected stages pass. The receipt confirms unchanged source throughout
qualification. Reviewer readiness and provenance live beside this packet under
`llp/reviews/` and the parent report directory; the mechanism amendment remains
Draft pending author acceptance. No source app database is retained in this
packet. Runtime scratch and frozen-app replay copies are disposable.
