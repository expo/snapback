# Agent-safe observability helpers

`scale-observer.mjs` watches a detached scale replay only through its bounded
`social-messenger.scale-status.v1` status file. It never starts, stops,
signals, or tails the replay process and never emits the replay's raw output:

```sh
node scale-observer.mjs --status /absolute/path/scale-status.json --follow
```

Every changed status becomes one compact `STRUCTURED SCALE OBSERVATION` line.
Terminal failures must carry the same application/platform/setup/instrument
classification used by choreography. The detached replay owns atomic
replacement of the status file and its terminal receipt; the observer has no
process-control authority.

`generate-aggregates.mjs` reads one validated run record and generates both
the run-report and diary mechanical tables, plus an optional JSON projection:

```sh
node generate-aggregates.mjs record.json \
  --run-out generated-run.md \
  --diary-out generated-diary.md \
  --projection-out generated-aggregates.json
```

Both Markdown blocks bind the same source-record digest. Qualitative diary
narrative remains hand-authored outside the generated block.
