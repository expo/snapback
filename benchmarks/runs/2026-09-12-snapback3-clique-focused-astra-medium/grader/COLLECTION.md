# Continuous grader evidence collection

This directory preserves the completed independent continuous grader separately from the builder and the later M7 run. The grader ran from epoch `1789229964` through `1789231326` (1,362 seconds), exited 0, and produced byte-verified `grading/grader-report.json`, `grading/trace.md`, and `grading/DONE` artifacts.

`grading/` retains the grader report, trace, probe source, raw probe/test logs, four full acquisition result JSONs with their mutation sidecars, screenshots, API-pagination evidence, projection comparisons, and paging/storage audit. `inputs/` retains the exact API/build documents and fixed result/manifests used by the grader. `provenance/` binds the launcher, prompt, immutable freeze, package/source identity, model trace summary, M7 staging boundary, and the selected public subset.

SQLite files, the raw Claude stream, installed dependencies, and session identifiers remain private. The raw stream and all grader SQLite/WAL/SHM files are in the local and EPYC private archive bound by the freeze receipt. The public set contains no database copy or raw model transport.

The raw grader D3 finding is preserved byte-for-byte. Probe 1 ends its eight-switch sequence at `g-starter` and waits for DM message `sm0001`; probe 2 selects the DM first and passes. This collection does not supply the coordinator's separate disposition. The grader's G1 CPU-profile omission is also preserved; any later focused diagnostic is outside this frozen grade.

The launcher requested Claude Opus 5 and every assistant-message model field in the native stream names `claude-opus-5`. The terminal aggregate also contains a small Claude Haiku 4.5 usage entry whose role the raw record does not establish; see `provenance/model-attestation.json`.
