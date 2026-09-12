# Merge

`merge table [after cursor] first|last N by index:` combines distinct
`[prefix keys]` lanes, optionally `for name in` a bounded range. Prefixes
share widths/types and leave an index suffix. Equal runtime prefixes and bounds
collapse. SQLite streams by suffix, deduplicates IDs and returns N rows.
Uniform lanes cost L heads + N advances + 2 lookahead + discovery; other lanes
keep conservative per-lane reserves. Retention prices all of those rows.

Pageable indexes end in `id`; one opaque cursor applies to every lane.
No lanes gives an empty page. `complete` requires exhausted discovery and
lanes, with at most N rows in their deduplicated union. Truncated discovery
omits lanes. Shapes, loops and counts work as for ranges; local merges require
a certificate. System reads still obey execution limits.

`guide fanout` has the executed 500-follow feed and complete grouped-search
alternative. `guide bounds` explains costs; `guide pagination` covers cursors.
