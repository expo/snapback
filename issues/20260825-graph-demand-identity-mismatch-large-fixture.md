# Large-fixture max-bearing served registrations refuse with SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH

**Opened:** 2026-08-25 (P-B measurement battery, LLP 0209 G3-C arm)

All three max-bearing served graph observations on the regenerated `large-seed42-v1` fixture (byte-exact, 16/16 shard digests verified) reached graph evaluation but refused during dependency registration with `SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` (3/3 attempts; 36.70s/28.45s/24.15s under high shared load). The normal-fixture corpus registers and executes the same graphs green, so the mismatch is scale- or loader-path-dependent — candidate causes: demand identity derived from loader-installed schema/collection state diverging at the 2.5M-row scale, or a working-set projection boundary the registration's identity computation doesn't share with the evaluator's demand.

**Effect:** the three graphs' large serialized-result/work/group maxima remain provisional in `tests/conformance/graph/bound-derivation.v1.json`; G0-BCAST-BOUNDS large observations blocked. Repro inputs are pinned in `tests/conformance/graph/MEASUREMENT-REPORT.v1.md` (fixture digests, loader, commands). An excluded N=1 empty-point diagnostic (issue outside the served projection) is retained in `served-observations.large-hot.v1.json` as descriptive evidence only.

**Status:** open.
