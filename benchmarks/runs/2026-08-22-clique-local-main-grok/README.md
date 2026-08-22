# Clique local-main Grok 4.6 xhigh — 2026-08-22

Author-requested diagnostic run of Clique M1–M3 on the latest local Snapback
source without publishing. One lane: the default Explicit profile.

- **Model:** Grok 4.6, xhigh effort, grok CLI 1.0.5 (`streaming-json`).
- **Snapback:** clean source commit
  `b70caf19eae1d4763224ebd182955e04430a67eb`; content-addressed local package
  tarballs and the commit-local qualified debug runtime. Nothing was published.
- **Instrument:** frozen Clique social-messenger instrument `0.3.2-m8`;
  M1–M3 only, including the frozen two-client browser choreography and one iOS
  Hermes export per milestone.
- **Evidence level:** diagnostic/calibration only. The current-source pin is not
  a published npm closure, N=1, grok token figures are harness-native but not
  cap-bearing (LLP 0201 / protocol grok=`unavailable`). It is not
  claim-eligible and does not support magnitude claims.
- **Execution:** one cold lane on the primary Apple Silicon development
  machine, ports 48100–48119. One-minute loadavg samples are retained with the
  raw run. One grok session compaction occurred mid-M2.

Raw lane directories, event streams, prompts, receipts, exports, reports, and
essays are retained outside git at
`/Users/ccheever/clique-main-20260822/` on the execution machine. Consolidated
results are in [record.md](./record.md); build experience is recorded in
diary 0106.
