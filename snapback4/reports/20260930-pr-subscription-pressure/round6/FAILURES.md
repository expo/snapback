# Round 6 failure ledger

- **Ours, test fixture:** the first draft read inspection counts at the top
  level instead of under `totals`. The three wasm/default-retention cases
  (empty, unknown, unrelated footprint) timed out awaiting initial idle; the
  file was interrupted after recognizing the mistake, with one cancellation.
  `fixture-inspection-error.log.gz`: 0 pass / 3 fail / 1 cancelled. Corrected
  only those property accesses before the detecting control and qualification.
- **Expected round-5 failures:** `round5-regression.log.gz` has 16 pass / 2 fail,
  zero cancellations/skips. Both failures are `no-op empty sync replaces
  out-of-horizon answer with keep=false`, one wasm and one process. After
  1.5 seconds both remain loading with one query and zero queued/active attempts;
  the assertion requires replacement HTTP work. Default/true retention and the
  unknown/unrelated footprint controls pass. This used the SDK built from the
  unchanged round-5 sources before the product edit.
- **Expected exact-commit confirmation:** `exact-round5-control.log.gz` repeats
  both failures using every SDK TypeScript module transpiled from
  `642ac9dc7188e8c1bf1930d92c3e340e8adca832` by the existing round-5 control tool.
  Same current server/devices; 0 pass / 2 fail, zero cancellations/skips.
- **Measurement setup, corrected:** Python gzip-9 (598,478 B) and Node's default
  gzip (603,161 B) do not match the repository's measurement command. The final
  `gzip -9 -c <wasm-path>` measurement is 598,401 B, matching round 5 in raw and
  compressed hashes. No rebuild or budget change.

No existing assertion, timeout, work bound, trial count or skip was changed.
Final qualification has no failures: affected 1,821/1,821, additional deadlines/pages
20/20, whole guide 107/107. Final failures: ours 0, baseline 0, environmental 0. No full suite was run: the
product change is confined to scheduling, as the round-6 prompt permits.
