# Historical two-host context

Earlier matched 10 s/20 s controls are [S1-FR](../results-20261022-fairness/README.md) and [Convex advocate](../results-20261021-convex-advocate/README.md). Their natural/+0.5 ms columns map here to A/B only as historical context; topology and absolute RTT differ. S1-H’s 0.5 s/2 s windows and best writer-count headlines are not substituted for the matched C=32 columns.

| Cell | Link | Raw PG token: two-host → one-host | Supabase: two-host → one-host | Convex/PG: two-host → one-host |
|---|---|---:|---:|---:|
| W1 | A | 22,627 → 8,000 | 2,828 → 2,000 | 1,000 → 500 |
| W1 | B | 16,000 → 8,000 | 2,000 → 2,000 | 1,000 → 500 |
| W2 | A | 11,313 → 5,656 | 2,000 → 2,000 | 16,000 → 707 |
| W2 | B | 11,313 → 8,000 | 1,414 → 2,000 | 16,000 → 707 |
| W3 | A | 16,000 → 5,656 | 2,828 → 2,828 | 16,000 → 8,000 |
| W3 | B | 11,313 → 4,000 | 1,414 → 2,828 | 11,313 → 5,656 |
| W4 | A | 4,525 → 400 | 2,262 → 3,200 | 1 → no pass |
| W4 | B | 4,525 → 141 | 282 → 1,600 | no pass → 141 |
| W5 same | A | 282 → 282 | 141 → 8 | 4 → 25 |
| W5 same | B | 282 → 282 | 35 → 70 | no pass → 25 |
| W5 hot1 | A | 4,525 → 3,200 | 2,262 → 800 | 282 → 400 |
| W5 hot1 | B | 4,525 → 4,525 | 1,131 → 1,600 | 400 → 25 |

The earlier runs put PG17.9 on 450a, app/proxy on three physical cores of 450b, generator on three, and SSH on two of the generator cores. The current run gives PG16.15 three physical cores of 450b, app/proxy two, and generator one. The database host, device, PG version and CPU budgets therefore change together. Natural SSH previously had no artificial delay proxy; every current database request uses the common Unix delay proxy, whose spin/sleep CPU is charged to the smaller app budget. Prepared-SELECT p50 was about 0.60/1.23 ms in S1-FR versus the current A/B capture ranges 0.561–0.622/1.065–1.170 ms. These facts explain why the columns are different experiments, not a causal attribution of any rate change.

Convex W2 is particularly search-dependent: the first 1,000/s repetition failed while later repetitions were fast; the inherited all-three rule searched downward. The registered 19,027/s and 22,627/s trials also failed. Intermediate 2,000–16,000/s rates were not tested in those W2 cells. Thus 707/s is the highest **tested passing** rate, not a demonstrated warmed-cache ceiling. Both W2 cells retain their early failures, and no warm-up, retry or native cache setting was changed to rescue them.

The mixed and disjoint write results also change non-monotonically across serial cells and repetitions. A later mix exceeding an earlier disjoint bracket does not show that contention helps, and a faster B row does not show that added delay helps. Other host activity, warming, CPU/proxy budgets and storage behavior are not isolated. The one-second clean-start checks are the commissioned qualification rule; they do not reserve the host throughout each trial. Large disk-usage changes and recorded waits are retained. These observations cannot establish an engine regression, authentication benefit, production capacity, or a Snapback victory; the final Snapback capacity run is still to be made through this runner.
