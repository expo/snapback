# Social-messenger choreography receipts

Version `0.1.0-p1` writes newline-delimited JSON to `receipts.jsonl`. The same
objects are written to stdout with the literal prefix `STRUCTURED RECEIPT ` so
an outer run harness can separate proof records from ordinary process output.
Each line validates independently against `receipts.schema.json`.

## Assertion receipts

Every browser check emits one `type: "assertion"` object. Its stable identity
is `(segment, assertion)`. The required proof fields are:

- `segment`: one of `m1` through `m6`.
- `assertion`: the stable choreography assertion name.
- `implemented`: whether this harness version actually attempted the check.
- `pass`: true only when `implemented` is true and a retained attempt passed.
- `timings`: every attempt, including errors and all three timing attempts.
- `bestOf`: `1` for ordinary checks and `3` for timing-sensitive checks.

An unsupported check is not omitted and never passes. It has
`implemented:false`, `pass:false`, an empty `timings` array, and an explanatory
`details.reason`.

For `bestOf:3`, the harness always runs all three attempts. The assertion passes
when at least one attempt passes, and `details.selectedAttempt` identifies the
fastest passing attempt by total `durationMs`; all attempts remain in the
receipt. Metric-specific durations such as `visibleMs` and `expiresMs` remain
under each attempt's `metrics` object. This is best-of-three flake control, not
permission to discard measurements.

## Segment summaries and milestone green

After the assertion lines, each selected milestone emits one
`type: "segment-summary"` object. This is the per-segment object consumed by the
outer run harness:

```json
{
  "type": "segment-summary",
  "segment": "m3",
  "assertion": "__segment__",
  "implemented": false,
  "pass": false,
  "timings": [
    {
      "attempt": 1,
      "pass": false,
      "startedAt": null,
      "durationMs": 18234.5,
      "metrics": {}
    }
  ],
  "bestOf": 1,
  "assertions": {
    "total": 3,
    "implemented": 2,
    "passed": 2,
    "failed": 0,
    "notImplemented": 1
  },
  "suite": { "pass": true, "receipt": "acceptance/m3.json" },
  "choreography": {
    "browserPass": false,
    "requiredExternal": [],
    "externalPass": true,
    "pass": false
  },
  "green": false
}
```

The normative aggregation is:

1. `browserPass` is true only if every assertion receipt in the segment passes.
   Missing or `implemented:false` assertions therefore fail closed.
2. `externalPass` is true when there is no external leg or when every required
   external receipt passes. It is `null`, never true, when evidence is absent.
   M6 requires `ios-simulator-m6`; the P1 skeleton records it as `null` until
   the P2 pilot implements the simulator driver.
3. `choreography.pass` (and the summary's top-level `pass`) is
   `browserPass && externalPass === true`.
4. `green` is true only when `suite.pass === true && choreography.pass === true`.
   A missing suite-status input is represented as `suite.pass:null` and cannot
   produce green.

The optional suite-status input is an object keyed by milestone:

```json
{
  "m1": { "pass": true, "receipt": "acceptance/m1.json" },
  "m2": { "pass": false, "receipt": "acceptance/m2.json" }
}
```

The path is an evidence pointer; this P1 harness does not interpret or bless
the builder's suite contents. A passing suite status must carry a non-empty
pointer. Coverage-manifest validation belongs to the outer run harness described
by the benchmark brief.

## Compatibility

Consumers must reject an unknown major receipt version and validate with the
schema matching the declared version; unknown fields under this P1 schema are
rejected. Stable `(segment, assertion)` names must not be silently repurposed;
changed semantics require a version bump.
