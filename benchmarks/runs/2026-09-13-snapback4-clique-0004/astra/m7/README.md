# Astra M7 evidence

**Status: received builder-reported green with a material snapshot-custody
qualification; no post-M7 independent grade.** The foreground `gpt-6-astra`
medium M7 process exited 0 at
`2026-09-14T08:21:04Z`; the runner recorded 1,345.403 seconds of wall time.
The builder's own report records `start=1789372730`, `end=1789374034`, and
`wall=1304`. Both clocks are preserved as received and are not reconciled.
The package pins were `snapback4@0.2.6` and `snapback4-expo@0.2.1`.

**Snapshot-custody qualification.** The frozen brief requires the baseline
snapshot before the M7 session starts, while the rendered prompt tells the
fresh agent to seed and export it before changing anything. The driver started
at epoch `1789372719`; the pre-snapshot manifest is timestamped about 158
seconds later. The run log places that snapshot before the first recorded
schema change, so the builder followed the prompt, but orchestration did not
satisfy the brief's pre-session custody requirement. Snapshot assertion
`m7-a08` is grader-owned, and no independent post-M7 grade was run. The
comparison is therefore builder-produced and independently ungraded. The full
audit remains external at
[the outcome audit](../../astra-m7-outcome-audit.md) (SHA-256
`160174ac03804c34e30891fc4666d817e45db782a84e30fd5482f98a5cba7674`).

The builder reports M7 green. The retained final acceptance receipt passes all
six suite-owned M7 assertions, its coverage receipt maps the same six IDs, and
the choreography receipt records two required passes. The snapshot comparison
reports exact pre/post equality for eight personas. Snapshot manifests and the
aggregate comparison are copied; the 16 persona JSON files remain external and
hash-bound. The builder also reports the previously green M1-M6 and M8 suites
passing after setup corrections. Those M7-era regression receipts are retained
separately from the continuous-builder archive.

The first M6 and M8 regression receipts failed during M7 setup. Both structured
receipts are retained: the observed-prefix copies have the same SHA-256 as the
lane's `regressions/*-attempt1.json` files. Their raw logs remain private,
hash-only references pending separate screening. The final report attributes
nine correction loops to agent error and none to Snapback, environment, or
ambiguous causes; that is builder-authored evidence rather than an independent
adjudication.

The native outcome is an iOS Hermes export, with no native runtime execution.
The final Hermes bytecode remains external at
`lanes/astra-snapback4/artifacts/m7-ios/_expo/static/js/ios/entry-6aab987ef3ca43e1f6b71a91962035b8.hbc` (2,794,166 bytes, SHA-256
`7095e4ca67db544231ae9a0a2a457c7d6d8159d5cccb9df7c60d0a9b122ebb4d`). Other generated native assets and binaries are also
hash-only references in [`external-artifacts.json`](./external-artifacts.json).

[`COPIED_FILES.json`](./COPIED_FILES.json) inventories 49 verbatim
copies totaling 89,689 bytes. Every destination was
created exclusively and verified against its source by byte length and SHA-256.
The lifecycle, narratives, structured acceptance and choreography receipts, snapshot metadata, compact native logs, and regression receipts are
included. Binary screenshots, persona snapshots, native artifacts, raw CLI
logs, the packet-level custody preflight, runtime databases, tokens, dependencies, grading records, continuous
snapshots, prompts, and instrument files are excluded from the repository
archive.

`m7-a08` remains M7-produced snapshot evidence: the pipeline has no second
independent grade after M7. This archive does not alter or replace the prior
continuous-builder or grading archives. It also does not audit the raw CLI or
public command arguments. [`command-audit-scope.json`](./command-audit-scope.json)
records the boundary used to avoid inspecting or reproducing unrelated process
arguments from the builder's admitted global process diagnostic.

The [source-delta audit](../../astra-m7-source-delta-audit.md) compares all 263 final source files with the 261-file pre-M7 inventory, verifies the release lineage and unchanged original suites/pins, and records the supplied-kit blank-option behavior separately from the new duplicate-question integration defect.

The [expiry attribution addendum](../../m7-expiry-attribution-addendum.md) corrects the earlier sweep-lag explanation. Both sum and count queries recompute over logically live rows before physical cleanup; the immutable builder reports and original Astra source audit retain their received wording.
