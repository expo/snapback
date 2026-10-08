# Snapback 4: seven client files fail on main in the 0.4.16 Linux qualification

Status: Open (fix in progress: lane SN round 6)
Date: 2026-10-08
Scope: Snapback 4 SDK settlement, Following custody and online client model
Related: LLP 3000.023 §11; lane SN (merged a474980715)

The 0.4.16 Linux qualification on eb1000 (release d15ecba68f, from main
6b588f4bce) failed 24 tests in seven client files (`== 2 failure(s) in
3112 s`), so the 0.4.16 cut stopped before its Darwin dry run:

- follow-window: own follow/unfollow honesty (eight variants), mounted
  Following not gated by post/like/remove, an empty author's follow ending
  complete (`pending` instead of `sent`), and Chromium mounted Following
  custody (four);
- bounded-following: a speculative profile withholds while a
  non-speculative page keeps predicted rows (wasm and native);
- retained-history: R2 sync during reply (wasm and process), at "the sync
  commit discards and refetches the earlier HTTP response";
- page-ready: ready list reads after account restoration expect
  `E_QUERY_RETRY` and see `E_OFFLINE`;
- online-client-model: the 3,000 seeded R1–R6 interleavings, and a
  cancelled transport's earlier failure diagnostic;
- per-row-liveness;
- worker-regressions: new declarations retry failed admission after Node
  is repaired.

Several match lane SN's one-shot settlement changes: prompt offline refusal,
an observation sync overlapping a held POST, adoption waiting for the POST's
outcome, and discovery refusal handling. SN's landing qualification ran an
affected subset that did not include these files. Lane SN round 6 is
attributing each failure (main before and after a474980715), fixing
forward without weakening tests, and qualifying with the complete
`scripts/test.sh`. The raw suite log is on eb1000 at
`~/sb4-intent/ops-tmp/qualify-0416-suite.log`.
