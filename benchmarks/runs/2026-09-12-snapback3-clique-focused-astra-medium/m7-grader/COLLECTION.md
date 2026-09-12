# M7 independent grader evidence

This directory preserves the completed independent M7 grader output for the focused run. The launcher ended with exit 0 after 1,185 seconds and recorded no evidence errors. The raw assessment is [`grading/grader-report.json`](grading/grader-report.json), with its chronological [`grading/trace.md`](grading/trace.md) and terminal [`grading/DONE`](grading/DONE). These are grader-authored evidence, separate from the coordinator’s final disposition.

The complete `grading/` probe, result, and log subtree is retained, including failed attempts. In particular, `grading/results/snapshot-comparison-independent.json` remains byte-exact with `pass: false` and the grader’s documented object-principal false difference. `grading/results/poll-browser-grader.json` retains its 30-second wait timeout and terminal `fatal` field, while `grading/logs/census-final.err` retains the locked-database attempt. Those attempt outcomes are not counted as passes. The report’s later assertion verdicts and successful reruns remain distinct from these raw events.

Regression accounting is separated in [`provenance/execution-accounting.json`](provenance/execution-accounting.json): the frozen builder input carried 25 pass and 1 fail, while the independent rerun produced 19 selected-check, 3 control, and 3 custom-client pass statuses. The reruns and poll/migration probes mutated isolated grader database copies only. Those database copies are excluded here and retained privately; the immutable pre/post persona exports and input hashes remain under `inputs/`.

The four server PIDs recorded by the grader, plus the actor and wrapper, were absent after terminal completion; ports 54900–54903 and 54910 were free. The report did not record individual browser child PIDs, so this collection does not claim per-browser PID identity. See [`provenance/process-cleanup.json`](provenance/process-cleanup.json).

A post-terminal read-only check found both installed Snapback package copies byte-exact against all 108 private-package payload files, all 115 app source/build files exact against the frozen M7 manifest, and every bound immutable database, profile archive, and status input unchanged. See [`provenance/post-terminal-integrity.json`](provenance/post-terminal-integrity.json).

The read-only coordinator preterminal observation is classified outside the grade. Its six probe/result files were byte-identical to the final grader copies, so no duplicate supplement was needed; its manifest and comparison are under `provenance/`.

Public exclusions are dependency contents, every SQLite/WAL/SHM or other database copy, the authenticated extracted browser profile, its archive, and the raw native model stream. The immutable remote snapshot and a local private archive retain those materials. [`provenance/private-custody.json`](provenance/private-custody.json) binds their hashes. Native assistant-event and aggregate usage metadata are summarized in [`provenance/model-attestation.json`](provenance/model-attestation.json); all 128 assistant events identify Claude Opus 5, while Haiku appears only in the terminal aggregate usage map and its purpose is not established by the evidence.

The corresponding authored M7 evidence is in [`../m7-builder/`](../m7-builder/), and the frozen evaluation scope is [`../SCOPE.md`](../SCOPE.md).
