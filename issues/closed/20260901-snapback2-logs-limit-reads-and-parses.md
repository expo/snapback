# snapback2: logs limit reads and parses the entire unbounded log

**Status:** Closed
**Resolution:** The logs control route now reverse-tails at most 4 MiB, parses only the requested trailing records, and reports I/O/malformed/truncated tails in snapback2/crates/snapback2/src/control.rs; sparse-large-file and malformed-tail regressions were added.
**Systems:** snapback2, owner, logs, performance
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/control.rs:216-225

Failure scenario: after .snapback/log.jsonl grows to multiple gigabytes, snapback2 logs --limit 1 reads the entire file into one String and parses every JSON line before discarding all but one, potentially hanging or OOM-killing the owner.

Why it happens: log_lines applies the limit only after read_to_string and full Vec collection. The writer at snapback2/crates/snapback2/src/watch.rs:179-196 is append-only with no rotation, and read errors are silently converted to an empty log.

Suggested fix: seek/reverse-tail with a bounded byte budget, parse only enough trailing records for the requested limit, report I/O/truncation errors, and rotate/retain logs under a stated bound. Add a sparse-large-file limit test.
