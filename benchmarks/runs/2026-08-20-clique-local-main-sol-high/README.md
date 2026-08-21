# Clique local-main GPT-5.6 Sol high — 2026-08-20/21

Author-requested diagnostic run of Clique M1–M3 on the latest local Snapback
source without publishing. Two lanes used the same model and effort, serially:
the default Explicit profile and `snapback-familiar-ts-v1`.

- **Model:** GPT-5.6 Sol, high effort, Codex CLI 0.147.0.
- **Snapback:** clean source commit
  `708e2e5c5348b5bb863cd7120afbafad9db99e9a`; content-addressed local package
  tarballs and the commit-local debug runtime. Nothing was published.
- **Instrument:** frozen Clique social-messenger instrument `0.3.2-m8`;
  M1–M3 only, including the frozen two-client browser choreography and one iOS
  Hermes export per milestone.
- **Evidence level:** diagnostic/calibration only. The current-source pin is not
  a published npm closure, N=1 per profile, and this run used high effort while
  the 0.1.24 comparison used xhigh. It is not claim-eligible and does not support
  magnitude claims.
- **Execution:** lanes ran serially on the primary Apple Silicon development
  machine. Explicit used ports 48000–48019; Familiar used 48020–48039. All
  recorded processes were stopped and both blocks were clear at completion.

Raw lane directories, event streams, prompts, receipts, exports, reports, and
essays are retained outside git at
`/Users/ccheever/clique-main-20260820/` on the execution machine. Consolidated
results are in [record.md](./record.md); build experience is recorded in
diaries 0104 and 0105.
