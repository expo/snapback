# Ref-check interprets ignored agent transcripts as source annotations

Status: Open
Scope: repository tooling / LLP reference scan
Observed: 2026-09-12

`./ref-check --verbose` scans ignored `.llp/ship-runs/**/*.jsonl` records as
authored source. Quoted instructions and code in those records produce false
path references such as `annotations`, `scan`, and `in`.

The full Clique Snapback3 run reproduced 24 errors, all in agent/review JSONL
records. Some records belong to this run; others predate it. No reported error
was in the changed Snapback3 source or its governing LLP. The unfiltered failed
check is retained in `.llp/ship-runs/20260912-snapback3-full-clique/ref-check-current.log`.

`ref-check` includes `.jsonl` in `SCAN_EXTENSIONS`, while `SKIP_DIRS` does not
exclude `.llp`. The command has no affected-path or exclusion option. Do not
erase retained run evidence or remove JSONL source validation globally to make
this check pass. Give generated run transcripts an explicit scan disposition,
then verify that genuine source annotations and tracked JSONL fixtures remain
checked.
