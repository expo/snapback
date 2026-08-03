
- **2026-08-02 late — cadence re-scoped by Charlie: batch greening at wave
  end.** Per-landing drift regens (deployment identity, publication carrier,
  test-inventory, guide freshness) are dropped for the remainder of the wave;
  lanes remain responsible only for their own correctness (cargo test +
  clippy on touched code, their own acceptance suites). This lane's job is
  now a single closing pass when the wave's feature landings finish:
  batch-regenerate all drift, absorb residue, and close this ticket on a
  zero-failure keep-going run. The exit criterion is unchanged; only the
  cadence is. Skipped-for-owner conventions still apply.
