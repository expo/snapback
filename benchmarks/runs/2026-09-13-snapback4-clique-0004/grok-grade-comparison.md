# Grok grade comparison

Observed 2026-09-14T07:24:51.827854Z. This is a read-only comparison of received public grader records. There is no prior Snapback4 Grok grade in `prior-results.json`; the only structured prior is September 5 Snapback2 Grok. Both 101-ID reports use assertion manifest `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04` and identify Claude Opus 5 as an uncalibrated grader. The JSON companion preserves exact prior/current result, method, suite result, evidence, note, and any reported best-of-three value for every shared ID.

## Structured counts

| Record | Pass | Fail | Not run | Total | Role |
| --- | ---: | ---: | ---: | ---: | --- |
| Current Snapback4 `assertionResults` | 60 | 17 | 24 | 101 | Current structured grade |
| Prior Sep 5 Snapback2 `assertionResults` | 68 | 9 | 24 | 101 | Only structured prior Grok anchor |
| Current M8 addendum | 10 | 1 | 7 | 18 | Separate current result |
| Prior structured M8 | null | null | null | 0 reported IDs | No machine-comparable result |

The exact 101 delta is -8 pass, +8 fail, and unchanged not-run. Nineteen IDs change received status; 82 retain it. The prior report has no structured M8 IDs, so this comparison does not reconstruct a prior 119 total or pool current M8 into the shared 101.

## Changed 101-ID classifications

| Transition | Count | IDs |
| --- | ---: | --- |
| pass → fail | 12 | `m1-a03`, `m2-a17`, `m3-a06`, `m3-a07`, `m3-a09`, `m4-a01`, `m4-a03`, `m4-a06`, `m4-a07`, `m4-a09`, `m5-a04`, `m5-a10` |
| pass → not-run | 1 | `m2-a07` |
| fail → pass | 5 | `m2-a22`, `m2-a23`, `m3-a12`, `m3-a13`, `m5-a06` |
| not-run → fail | 1 | `m3-a02` |

Unchanged cells are pass → pass 55, fail → fail 4, and not-run → not-run 23. All nine M7 IDs remain not-run because the current fresh M7 session is pending. Status movement records a difference between received grades on different product and instrument runs; it does not by itself establish a product regression or fix.

## Method changes

Ninety IDs retain the same method label and eleven change it:

| Method transition | Count | IDs |
| --- | ---: | --- |
| `api` → `source-inspection` | 1 | `m6-a11` |
| `api` → `web-automation` | 10 | `m1-a02`, `m1-a08`, `m2-a20`, `m2-a24`, `m4-a01`, `m4-a06`, `m4-a07`, `m5-a04`, `m5-a09`, `m5-a10` |

Exact method and evidence strings for all IDs, including unchanged methods and every suite result, are in `structured101Transition.byId` in the JSON companion. This record does not adjudicate method or source-access compliance; that remains in the host-owned audit.

## Current M8, separate

The current M8 addendum reports 10 pass, 1 fail, and 7 not-run across its 18 IDs. The September 5 grader report omitted all M8 IDs from structured `assertionResults`; no exact prior M8 transition or prior structured M8 subtotal exists.

## Received O-dimensions and holistic score

| Measure | Current Snapback4 | Prior Sep 5 Snapback2 | Delta or relationship |
| --- | ---: | ---: | --- |
| O1 | 10 | 15 | -5 |
| O2 | 25 | 30 | -5 |
| O3 | null | null | both inapplicable/unscored |
| O4 | null | null | both inapplicable/unscored |
| O5 | null | band 0 | current unscored; prior replay attempt did not establish conformance |
| Same-family holistic overall | 70 | 57 | +13 |

O-values are copied from the independent grader reports. The holistic totals are separate same-family narrative assessments, not independent acceptance grades. The prior holistic method assessed the Grok family across its three September 5 backend lanes; the current score assesses the current Grok Snapback4 lane.

## Wall clock and M7 state

| Clock | Seconds | Source/method |
| --- | ---: | --- |
| Current Snapback4 builder | 12,499.350 | lifecycle end record, exit 0 |
| Prior Sep 5 Snapback2 builder | 10,927 | final-report start/end interval; no validated run record retained |
| Current independent grade | 2,793.393 | lifecycle end record, exit 0 |
| Prior independent grade | null | no comparable grader-process wall in `prior-results.json` |

Current M7 is pending. Its nine IDs are not-run in the continuous structured grade. The prior Snapback2 fresh M7 was a separate green 1,876-second artifact; it is context only and is not substituted into either structured 101 record.

## Comparison limits

Both independent grades are uncalibrated N=1 records with no committed holdout probe set. The September 5 and current assertion ID set is stable, but strict magnitude comparison is false: the September 5 instrument commit differs, 47 of 170 shared instrument paths changed and seven current-only paths were added, including fixture, UI-kit, and choreography behavior. September 5 also lacked current URL isolation and metering custody, and ran three backend lanes in parallel on a contended M5 Max; current builders run serially. Builder walls and the holistic delta are contextual.

## Evidence hashes

| Evidence | SHA-256 |
| --- | --- |
| Current `lanes/grok-snapback4/grading/grader-report.json` | `30112e495f85977a396ae5fb6e53cbb4263b3d62471f3e04fdd320b234efc982` |
| Current `lanes/grok-snapback4/grading/m8-assertion-results.json` | `90becd30f8bbb91a28dba470a8a0e8519b71638a39aa0c3d9c4fa3b235f6f743` |
| Prior `grading-grok-snapback2.json` | `f3dd51ce60eac3e6c591f9720903f5a5d5160ff914355ddad76edb020dd80ea9` |
| Current builder start / end | `0cad72d85ffcf932ef413fdbebc8d9f21dd5ba5cb47c672f83bf043123876fcb` / `ce275137c7381a69f76135406f69b38a1fee7d534959dbd76ad61877a8a91872` |
| Current grade start / end | `02541355c70bdc5a78b481a486e716cff576f1433e3921fd20c51b1ebc11ed61` / `f215313637f82048baaeb2de6853cac7243f8943e0c76349c79a947cc4f25281` |
| Current `scores/all.json` | `c4ca5b3c0c2b899adfa1c7ec8e7533e74a2f19e08c1431c366bdad20d6d3e9d8` |
| Current Grok holistic validation | `43c38f9868891cb10b5e3883edd118c03f0affc7305c1c248e34e86471679936` |
| Prior `holistic-scores.json` | `fcba924f03a745d58ee9aa0e8468cafe3aa448bc0e32c3d3ec1064e5c3537df5` |
| `prior-results.json` | `68902e4a760fa7ffd2b32a37d0399955db5d5e6ec5240d9fcf737f238423f2ae` |
| Instrument comparison Markdown / JSON | `98fd367c8e97bd527251de017f8578cb83908bd4d3efc6dd7fdb1c0a224be45a` / `8b0aaab1e96aa4643ad1a9cc8fa73e38452e7c43704093a9df0043851a54ba06` |
| Frozen assertion manifest | `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04` |
| Current grader trace | `d77ca21d509e33e6726c69da7e878bafda3d22d14a9b16e18f4de13c1d0bca1e` |

Full source paths and the complete per-ID received comparison are in [`grok-grade-comparison.json`](./grok-grade-comparison.json).
