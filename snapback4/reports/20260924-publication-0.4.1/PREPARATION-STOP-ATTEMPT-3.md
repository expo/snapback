# Snapback 4 0.4.1 publication — attempt 3 stopped in preparation

**Nothing published or pushed.** Attempt 3 stopped on an agent-authored
preparation script error, before Release app rebuilding, native witnesses or
publication qualification. This is not a product-test failure.

## Exact blocker and commands that ran afterward

The journal-restoration/version-check script started with
`from pathlib import Path` and `import json,tomllib`. The system `python3` is
**3.9.6** and has no `tomllib` module:

```text
Traceback (most recent call last):
  File "<stdin>", line 2, in <module>
ModuleNotFoundError: No module named 'tomllib'
```

The import failed before the script restored any journal additions or checked
versions. The surrounding shell command lacked a stop condition between that
heredoc and the next command. Consequently, the frozen Bun install, merge commit,
and xcframework build ran before the agent received the tool output and observed
the failure. Those three commands succeeded. The agent stopped the remaining
release sequence on observing the error and collected the already-started build's
result. This was an agent execution error; no product failure is attributed to it.

[Failure record](./attempt-3-preparation-failure.json),
[exact traceback](./attempt-3-preparation-failure.log).
No retry of the preparation or qualification sequence followed. Evidence recovery
restored the saved journal additions unchanged, verified archived hashes and
recorded the completed build. No test, timeout, assertion, keychain setting or
credential was changed.

## Completed preparation and preserved history

- Read fix lane 2's final report at `~/sb4-intent-pub/fix041b.final.md` and its
  journal entries, including both zero-failure suite records. Its report attributes
  the second attempt's failure to overlapping model timer cleanup and records
  the execution barrier, cancellation checks, seed-11 regression and suite
  scheduling fix. Those are the fix lane's qualification results, not a new
  publication qualification by this lane.
- Fetched `origin/main` at `7811b01e4ab6b7b2e9a34cb4259278840ce78437`.
- Preserved attempt 2's complete report directory and native evidence as sibling
  directories under [attempt-2/](./attempt-2/), retaining their relative links.
  Its full pre-merge journal and exact appended publication entries are also
  preserved there. **145 archived file hashes verified unchanged.**
- Checkpoint commit `2837169bfe4949bdda8390eb2e97d0726e337aa7` retains attempts 1
  and 2. Their reports remain available:
  [attempt 1](./attempt-1/REPORT.md),
  [attempt 2](./attempt-2/20260924-publication-0.4.1/REPORT.md).
- Merged with `git merge --no-ff --no-commit origin/main`: **no conflicts**.
  Only the locally appended journal entries had been preserved separately before
  merging; all were restored unchanged after the preparation error. Incoming
  journal entries remain intact.
- Frozen Bun install passed in **0.190 s**, reporting no changes.
- Merge commit **`3feff5c0596a0a88827f579eb999beb9fef41ef1`** contains the requested main commit. CLI, platform
  and Expo versions remain **0.4.1**; Undici remains **8.8.0**.
- The already-started xcframework build passed in **9.662 s**. Its file hashes are
  recorded in [attempt-3-xcframework-hashes.json](./attempt-3-xcframework-hashes.json).
  **It has not passed a rebuilt Release app/native witness for attempt 3.**

[Attempt 3 source record](./attempt-3-source.json).
The exact historical journal entries were restored to `snapback4/JOURNAL.md` and
an attempt-3 entry appended. Those restorations and the new report remain
uncommitted. The merge commit exists locally; no push was made.

## Attempts

Fetch and evidence preservation succeeded. The failed inline preparation script
was not separately timed; its exact traceback and placement before the frozen
install are recorded above. All timed commands follow:

| Attempt | Seconds | Exit | Evidence |
|---|---:|---:|---|
| attempt-3-evidence-checkpoint | 0.174 | 0 | [record](./attempt-3-evidence-checkpoint.json), [log](./attempt-3-evidence-checkpoint.log) |
| attempt-3-merge-main | 0.192 | 0 | [record](./attempt-3-merge-main.json), [log](./attempt-3-merge-main.log) |
| attempt-3-bun-install | 0.190 | 0 | [record](./attempt-3-bun-install.json), [log](./attempt-3-bun-install.log) |
| attempt-3-merge-commit | 0.100 | 0 | [record](./attempt-3-merge-commit.json), [log](./attempt-3-merge-commit.log) |
| attempt-3-xcframework-build | 9.662 | 0 | [record](./attempt-3-xcframework-build.json), [log](./attempt-3-xcframework-build.log) |

The prior failed patch, prior failed publication suites, native witness evidence,
and their command ledgers remain unchanged in the archived reports. No failed
attempt was discarded or counted as a pass.

## Unrun release steps

No Release app rebuild, native witness, `publish.mjs --dry-run`, `--resume`,
installed-consumer proof, Expo pack/publication or registry verification ran in
attempt 3. No publication signing occurred. There are no attempt-3 witness
timings, production CLI digest, staged integrities or registry integrities to
claim. The native artifacts and `qualified.json` at the ordinary report path
still describe attempt 2; attempt 3 does not claim that old qualification for
its newly merged source. No package was published by this lane.
