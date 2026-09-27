# Snapback 4: checked narrowing assesses rows the shared retirement preview would remove

**Opened:** 2026-09-27, Astra's round-2 blind review of `96d67e2569` (the calibration #23 data_modeling landing)
**Severity:** Medium: `check --store` refuses an adoption that succeeds, for one candidate shape
**Area:** `snapback4/crates/snapback4-core/src/store/successor.rs` (successor assessment, near line 82), `engine/through_activation.rs` (`Retirement`), the `check` verb
**Status:** Open; inherited, reproduced on the parent commit without any Following declaration

The Following occupancy preview added in the data_modeling landing shares the
runtime's retirement plan, so `check` and adoption agree on populated sources
whose `read through` inheritance is removed. Successor assessment does not
share that plan yet.

Reproduction (Astra, `~/sb5/reviews/dm2-astra-probes/inherited-parity.log` on
EPYC): a candidate removes inherited expiry from a source, adds a Following,
and adds a required column. The preview passes and the adoption succeeds
after retiring the incompatible expired rows, but CLI `check` reports
`E_ADOPT` because successor assessment still examines those rows. The same
divergence reproduces without the Following.

Fix: make checked narrowing assess rows after the shared retirement preview,
so the successor read sees exactly the rows the adoption's retirement phase
would leave. Extend the agreement matrix in
`snapback4/crates/snapback4/tests/timeline_adoption.rs` with a
narrowing-plus-retirement cell that asserts CLI `check`, the preview API and
adoption agree.
