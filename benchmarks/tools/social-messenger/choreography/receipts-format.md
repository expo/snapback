# Social-messenger choreography receipts

Version `0.3.3-m8` writes newline-delimited JSON to `receipts.jsonl`. The same
objects are written to stdout with the literal prefix `STRUCTURED RECEIPT ` so
an outer run harness can separate proof records from ordinary process output.
Each line validates independently against `receipts.schema.json`.

## Assertion receipts

Every browser check emits one `type: "assertion"` object. Its stable identity
is `(segment, assertion)`. The required proof fields are:

- `segment`: one of `m1` through `m6`, or `m8`.
- `assertion`: the stable choreography assertion name.
- `implemented`: whether this harness version actually attempted the check.
- `required`: whether leaving this assertion unimplemented blocks the segment.
- `status`: `passed`, `failed`, or `skipped`.
- `pass`: boolean for an attempted check and `null` for an explicit skip.
- `timings`: every attempt, including errors and all three timing attempts.
- `bestOf`: `1` for ordinary checks and `3` for timing-sensitive checks.

An unsupported check is not omitted and never passes. It has
`implemented:false`, `status:"skipped"`, `pass:null`, an empty `timings` array,
and a non-empty `details.reason`. A required skip blocks choreography green; an
optional skip remains visible without being reported as a failed attempt.

For `bestOf:3`, the harness always runs all three attempts. The assertion passes
when at least one attempt passes, and `details.selectedAttempt` identifies the
fastest passing attempt by total `durationMs`; all attempts remain in the
receipt. Metric-specific durations such as `visibleMs` and `expiresMs` remain
under each attempt's `metrics` object. This is best-of-three flake control, not
permission to discard measurements.

For M3's `quoted-reply-excerpt-and-jump` assertion, each attempt's existing
`timing.note` records the `sm-convo-quote-preview` jump selector.

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
  "required": true,
  "status": "failed",
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
    "required": 3,
    "implemented": 2,
    "passed": 2,
    "failed": 0,
    "skipped": 1,
    "notImplemented": 1,
    "requiredUnimplemented": 1
  },
  "suite": { "pass": true, "receipt": "acceptance/m3.json" },
  "choreography": {
    "browserPass": false,
    "requiredExternal": [],
    "externalPass": true,
    "supplementalExternal": [],
    "pass": false
  },
  "green": false,
  "nonGreenCause": "required-unimplemented"
}
```

The normative aggregation is:

1. `browserPass` is true only when every implemented assertion passes and no
   required assertion remains unimplemented. Optional skips therefore stay
   explicit without becoming silent failed attempts.
2. `externalPass` is true when every external leg required for web green passes.
   In `0.3.3-m8` there are no such legs. M6's `ios-simulator-m6` and M8's
   `ios-simulator-m8` statuses are recorded in their matching summaries under
   `supplementalExternal` with `requiredForGreen:false`; they are distinct
   native/O4 artifacts governed by `simulator.md`.
3. `choreography.pass` (and the summary's top-level `pass`) is
   `browserPass && externalPass === true`.
4. `green` is true only when `suite.pass === true && choreography.pass === true`.
   Version `0.3.3-m8` refuses missing or partial suite-status linkage before
   creating receipts or starting a browser, so emitted `suite.pass` is always
   boolean.
5. `nonGreenCause` is the closed recording convention for a non-green
   segment. It is optional on the schema (default `null` when omitted) so
   existing `0.3.0-m8` receipts remain valid; emitters since `0.3.1-m8`
   always write it. Allowed values:
   - `null` — `green` is true. There is no second green label.
   - `required-unimplemented` — a required assertion was skipped.
   - `choreography-failed` — an implemented assertion failed.
   - `suite-failed` — suite evidence is `pass:false`.
   - `instrument` — non-green for an instrument defect other than missing
     suite linkage, which `0.3.3-m8` refuses before startup.

   Lanes MUST copy `nonGreenCause` from this summary into the run record.
   Do not invent labels such as "functionally green". `green` stays a
   boolean; `capability-failure` remains the brief's cap-exhausted
   milestone status, not a synonym for instrument-caused non-green.

The required suite-status input is an object keyed by milestone. Every selected
milestone must be present:

```json
{
  "m1": { "pass": true, "receipt": "acceptance/m1.json" },
  "m2": { "pass": false, "receipt": "acceptance/m2.json" },
  "m8": { "pass": true, "receipt": "acceptance/m8.json" }
}
```

The path is an evidence pointer; this P2 harness does not interpret or bless
the builder's suite contents. A passing suite status must carry a non-empty
pointer. Coverage-manifest validation belongs to the outer run harness described
by the benchmark brief.

## Compatibility

Consumers must reject an unknown major receipt version and validate with the
schema matching the declared version; unknown fields are rejected. Stable
`(segment, assertion)` names must not be silently repurposed;
changed semantics require a version bump. `nonGreenCause` is an optional
additive field introduced on `0.3.1-m8` segment summaries (default `null`
when omitted); it did not bump the receipt version. `0.3.2-m8` IS a semantic
bump: it removes the legacy `sm-convo-quote` jump fallback, so an M3
`quoted-reply-excerpt-and-jump` receipt at `0.3.2-m8` proves preview-only
selection, while a `0.3.1-m8` receipt may have recorded the reply-bubble-
scoped fallback.

`0.3.3-m8` keeps `0.3.2-m8` selector semantics and makes suite-status linkage
startup-refusing. It coordinates the additive LLP 0295 D0.6 run-record
observability fields without changing `extensionVersion: 2` or the W2 token
meter. A missing-linkage `0.3.2-m8` receipt remains governed by its matching
schema and may carry `suite.pass:null`; `0.3.3-m8` never emits that state.
