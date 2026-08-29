# Social-messenger choreography receipts

Version `0.3.6-m8` writes newline-delimited JSON to `receipts.jsonl`. Raw
receipt objects stay on disk and are not echoed to an agent's stdout. A failed
assertion emits one bounded `STRUCTURED CHOREOGRAPHY MISS` with its outcome
class, stable identity, compact attempt errors, and the retained JSONL paths.
Each on-disk line validates independently against `receipts.schema.json`.

## Assertion receipts

Every browser check emits one `type: "assertion"` object. Its stable identity
is `(segment, assertion)`. The required proof fields are:

- `segment`: one of `m1` through `m8`; M7 is accepted only in its own
  fresh-session invocation.
- `assertion`: the stable choreography assertion name.
- `implemented`: whether this harness version actually attempted the check.
- `required`: whether leaving this assertion unimplemented blocks the segment.
- `status`: `passed`, `failed`, or `skipped`.
- `pass`: boolean for an attempted check and `null` for an explicit skip.
- `timings`: every attempt, including errors and all three timing attempts.
- `bestOf`: `1` for ordinary checks and `3` for timing-sensitive checks.
- `outcomeClass`: `null` when passed; otherwise `application`, `platform`,
  `setup`, or `instrument`.
- `typingObservationBoundaryVersion`: required as `v2` on the M3 typing
  assertion and repeated in `details` as assertion metadata. A mismatch or
  omission is schema-invalid.

Every timing has both `durationMs` (complete check-attempt wall) and
`settlementWaitMs` (the union of actual locator, predicate, and page-event
wait intervals during that attempt). The latter excludes setup, browser
actions, and computation, and therefore never exceeds `durationMs`. D0.6
choreography wait observations are derived from `settlementWaitMs`, not from
whole-attempt duration. The suite producer records its own settlement waits in
the production lane-controller stream; choreography does not claim them.

The coordinated media/receipt/avatar/membership bump has no structural-skip
catalog. The schema retains explicit skipped receipts for compatibility, but
missing new semantics fail the owning application assertion.

For `bestOf:3`, the harness always runs all three attempts. The assertion passes
when at least one attempt passes, and `details.selectedAttempt` identifies the
fastest passing attempt by total `durationMs`; all attempts remain in the
receipt. M3 typing records `typingActionMs` separately from
`finalKeystrokeActionMs`, `visibleAfterLastKeystrokeMs`, and
`expiresAfterLastKeystrokeMs`; render and expiry clocks start immediately
before the final synthetic keystroke. Both the assertion receipt and M3
segment summary stamp `typingObservationBoundaryVersion:"v2"`. This is best-of-three
flake control, not permission to discard measurements. Before a retry, the
harness restores every participating context online and resets each page to an
unpoisoned base route; unaffected assertions are not rerun.

For M3's `quoted-reply-excerpt-and-jump` assertion, each attempt's existing
`timing.note` records the `sm-convo-quote-preview` jump selector.

## Segment summaries and milestone green

After the assertion lines, each selected milestone emits one
`type: "segment-summary"` object. This is the per-segment object consumed by the
outer run harness:

```json
{
  "version": "0.3.6-m8",
  "type": "segment-summary",
  "segment": "m3",
  "typingObservationBoundaryVersion": "v2",
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
      "settlementWaitMs": 18001.2,
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
  "nonGreenCause": "choreography-failed",
  "outcomeClass": "application",
  "setupIdentity": {
    "path": "/retained/setup-identity.json",
    "sha256": "sha256:..."
  },
  "setup": {
    "schemaVersion": "social-messenger.setup-identity.v1",
    "instrumentPin": "social-messenger@0.3.6-m8"
  }
}
```

The normative aggregation is:

1. `browserPass` is true only when every implemented assertion passes and no
   required assertion remains unimplemented. Optional skips therefore stay
   explicit without becoming silent failed attempts.
2. `externalPass` is true when every external leg required for web green passes.
   In `0.3.6-m8` there are no such legs. M6's `ios-simulator-m6` and M8's
   `ios-simulator-m8` statuses are recorded in their matching summaries under
   `supplementalExternal` with `requiredForGreen:false`; they are distinct
   native/O4 artifacts governed by `simulator.md`.
3. `choreography.pass` (and the summary's top-level `pass`) is
   `browserPass && externalPass === true`.
4. `green` is true only when `suite.pass === true && choreography.pass === true`.
   Version `0.3.6-m8` refuses missing or partial suite-status linkage before
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
     suite linkage, which `0.3.6-m8` refuses before startup.

   Lanes MUST copy `nonGreenCause` from this summary into the run record.
   Do not invent labels such as "functionally green". `green` stays a
   boolean; `capability-failure` remains the brief's cap-exhausted
   milestone status, not a synonym for instrument-caused non-green.
6. `outcomeClass` is the first-line ownership taxonomy. Every segment and
   startup refusal first emits a compact `CHOREOGRAPHY OUTCOME` line. A suite
   with `pass:false` must supply its class; a browser assertion defaults to
   application unless an explicit platform/setup/instrument error owns it.
7. `setupIdentity` hash-binds the retained input while `setup` embeds its
   validated qualified-binary/wrapper, package/prepack, toolchain, backend,
   and host fields. The outer run composer copies one identical setup from the
   selected segment summaries into `socialMessenger.setup`.

The required suite-status input is an object keyed by milestone. Every selected
milestone must be present:

```json
{
  "m1": { "pass": true, "receipt": "acceptance/m1.json" },
  "m2": { "pass": false, "receipt": "acceptance/m2.json", "outcomeClass": "application" },
  "m8": { "pass": true, "receipt": "acceptance/m8.json" }
}
```

The path is relative to the suite-status file. The choreography does not
interpret or bless the builder's suite semantics, but it does stat and digest
the actual file before startup. The segment summary retains that SHA-256; the
meter re-stats and re-digests the same file at record-write time. A missing or
changed passing receipt refuses rather than becoming green. Coverage-manifest
validation belongs to the outer run harness described by the benchmark brief.

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

`0.3.3-m8` kept `0.3.2-m8` selector semantics and made suite-status linkage
and structured setup identity startup-refusing. It coordinates the additive
LLP 0295 D0.6 run-record
observability fields without changing `extensionVersion: 2`; the W2 token
meter now joins typed, hash-verified observation sidecars beside its native
usage stream. Its timing records distinguish complete attempt wall from actual
settlement wait. A missing-linkage `0.3.2-m8` receipt remains governed by its
matching schema and may carry `suite.pass:null`; `0.3.3-m8` never emitted that
state. It also carried the additive LLP 0295 D0.6 observability fields.

`0.3.4-m8` carries the LLP 0281 remainder and is a material observation-
boundary bump. Its M3 typing receipt and assertion metadata must both say
`v2`; its M3 summary and run record repeat that value. A retained `0.3.3-m8`
typing receipt with no boundary field is valid only as implicit v1 under that
old version, and an explicit v2 stamp on the old version is rejected. Current
receipt streams may not mix older-version lines into a `0.3.6-m8` run, so v1 and
v2 observations never silently aggregate. The same bump splits required live
DM delivery from conditional DM-avatar identity, uses a delivery-progress
witness for removed-member cutoff, and makes every retained M7 vote attempt a
distinct user/option intent. LLP 0201's continuous M1–M6/M8 session shape is
unchanged.

`0.3.6-m8` retains those observation semantics and the `0.3.5-m8` N7 fixture
repair, while moving the manifest, emitter, setup identity, receipts, meter,
and validator together onto one frozen executable identity. Retained 0.3.4
receipts remain accepted only under their historical pin.
