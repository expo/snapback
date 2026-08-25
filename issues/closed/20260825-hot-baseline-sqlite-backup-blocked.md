# zb5 hot-baseline clone blocked: SQLite online backup never progresses

**Opened:** 2026-08-25 (P-B measurement battery, LLP 0209 G3-C arm)
**Closed:** 2026-08-25
**Status:** Closed

**Resolution:** `.backup` stayed at 0 bytes because the recorded `server.pid` (38187) and restore-lock pid (63089) were dead, while `127.0.0.1:4290` was a leftover published-smoke process on a different sqlite file. Nothing held `hot-diag-baseline/diag.sqlite3` (WAL 0 bytes). The unblocking recipe is read-only `VACUUM INTO`, declared in `tests/conformance/graph/MEASUREMENT-REPORT.v1.md`. Two independent runs produced `diag.sqlite3` at 8753221632 bytes each without signalling or writing the live `:4290` process. D2-H2/H3 hot N≥3 publication remains follow-on measurement.
