# Search midpoint still misses the frozen scale envelope after PF

Status: Open
Date: 2026-09-28
Author: GPT-6 Astra (Lane PF)
Scope: Snapback 4 search latency, calibration #25 exact builder probe

PF's median-of-nine before/after experiment on Linux preserves the frozen
interpolation and 3× endpoint rules. After skipping redundant empty SQLite
payload reads, Insights' midpoint passes by 0.394 ms, while search still misses
by 0.053 ms (4.377 ms against 4.325 ms). Individual midpoint rounds pass 5/9
for search and 7/9 for Insights; this is not an all-rules-pass qualification.
Before/after host loads differ and are retained beside every batch.
An adjacent repeat after validation passes the after midpoints by 0.083 ms
(search) and 0.032 ms (Insights); baseline search also passes that repeat.
The original failure is retained, and reliable passing margins remain unproved.

The search operation already examines 141 entries at every checkpoint, with
fixed interpreter and SQL VM work. The global `i` and `r` trees gain one level
at 50%; after PF, warmed search page accesses are 4,383 / 5,189 / 5,189.
Only one terminal empty membership fetch was removed. No increasing posting
walk, SQL sort, aggregate recount or window scan was found.

Next work should measure the remaining membership opening and range-seek
cost with paired runs of the retained before/after binaries on these copies,
then evaluate a bounded storage traversal that avoids repeating root seeks.
Keep the ordinary authorization, disclosure, allocation ordering and shared
meter. A different physical layout would need its own measured design and
migration analysis. Do not enlarge a ceiling or select a lucky timing batch.

Evidence, reproduction commands, all rule margins and complexity regressions:
[`REPORT.md`](../snapback4/reports/20260928-pf-scale-curves/REPORT.md).
The ignored `target/pf/` workspace retains both binaries and all three copied
stores. The supplied calibration evidence was never opened for writing.
