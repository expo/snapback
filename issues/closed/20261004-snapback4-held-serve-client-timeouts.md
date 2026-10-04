# Snapback 4: held serve clients timed out before their fixture released work

**Status:** Closed
**Date:** 2026-10-04
**Systems:** Snapback 4 test harness
**Related:** LLP 3000 §7, publication suite under contention

The 0.4.13 Darwin dry run at load 54–70 failed
`upload_disk_work_is_bounded_and_does_not_hold_the_query_engine` in
`exchange_bytes` (`serve_tests.rs:92`, WouldBlock), then on the parked
client's join (`:1110`). Two uploads are deliberately held while the driver
checks overload, query progress and occupancy. Their three-second read
budget could expire before those checks finished.

On unchanged base `2154dc163d`, eb1000 reproduced the exact two panic sites
50/50 times using two CPUs, eight confined CPU hogs and an externally
injected four-second driver stall. The fixed test passed 50/50 under the
same conditions. This was a harness race; the refused third upload and the
independent query still answered during the hold.

Resolution: held exchanges get one absolute I/O deadline derived from the
fixture's bounded setup/probes plus 15 seconds. The upload bound is 23
seconds and the longest audited client is 55 seconds. Ordinary progress
probes and product timeouts are unchanged. Every assertion and test variant
is retained. The audit corrected 20 tests, including auth, adoption,
delivery, detached sync, latency and a manually dispatched spawn refusal.
Delivery/effect gates now also release on panic. A 25-second injected stall
still fails the fixed upload test, demonstrating the finite guard.

The serve target passes (189 tests, four existing ignores); the final
spawn-failure adjustment passes its focused rerun. Full-suite results,
all audited cases and retained reproduction evidence are in the
[Lane SU report](../../snapback4/reports/20261004-su-serve-upload-timeout/REPORT.md).
