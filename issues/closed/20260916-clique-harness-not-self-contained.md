# Clique choreography harness is not self-contained; four builders, three resolutions

**Status:** closed 2026-09-16 — fixed; see Resolution
**Filed:** 2026-09-16, from the 0.2.26 Astra-medium calibration
**Scope:** benchmark instrument (`benchmarks/tools/social-messenger/`), not Snapback 4

## The defect

`benchmarks/tools/social-messenger/choreography/setup-identity.mjs:5` imports

```js
import { validateJsonSchema } from "../../lib/json-schema.mjs";
```

which resolves only when the choreography directory sits two levels below the
packet's `lib/`. The builder is required to **copy** the harness into its own
lane, and the copy does not carry `lib/` — so whether the import resolves depends
entirely on how deep the builder happens to place the copy. A packet ships
`lanes/lib/json-schema.mjs` to serve exactly one layout
(`lanes/<lane>/harness/setup-identity.mjs`), and nothing tells the builder that is
the required layout.

## Why it matters

It is a silent source of run-to-run variance underneath every score in the
agent-ergonomics programme. Across four observed builders:

| run | version | what the builder did |
|---|---|---|
| cal6 | 0.2.22 (scored 91) | wrote its own 368-byte AJV shim |
| cal9 | 0.2.25 (scored 91) | wrote its own 617-byte AJV shim, with a date-time format check |
| cal10 attempt 1 | 0.2.26 | **refused to fabricate**, recorded `nonGreenCause=instrument`, aborted at M1 with no score |
| cal10 attempt 2 | 0.2.26 (scored 90) | "a disclosed AJV dependency adapter in a lane-contained layout" |

Both shims are real AJV validators over the unchanged frozen schema, not weakened
no-ops. They are, however, **more permissive than the canonical module in at least
one respect**: `lib/json-schema.mjs` refuses a root schema without an absolute
`$id` ("every root JSON Schema must carry an absolute `$id`"), and AJV with
`strict: false` does not. All 7 frozen `*.schema.json` files carry `$id`, so that
difference never bit and no recorded score is invalid — but the equivalence was
narrower than it first appeared, which is the general hazard with a substituted
validator. But three different resolutions of one
missing import — and one aborted run — is not a controlled instrument, and the
abort cost a full builder cycle. Attempt 1's refusal was the *correct* behaviour
and is the one outcome that produced no number.

## Fix

Make the copyable directory self-contained so the import resolves at any depth:

1. Add `benchmarks/tools/social-messenger/choreography/lib/json-schema.mjs` (the
   canonical module, not a shim).
2. Change the choreography files' imports from `../../lib/json-schema.mjs` to
   `./lib/json-schema.mjs` — `choreography/setup-identity.mjs` and
   `choreography/startup.test.mjs` are the two in scope.
3. Leave `benchmarks/tools/lib/json-schema.mjs` where it is; `record-validator.mjs`
   and the metering tests resolve it correctly from their own locations.

This changes nothing about what is validated. It removes a variance source and a
whole failure mode.

## Comparability

Packets pin `INSTRUMENT_COMMIT` (cal10: `409954115`). Applying this makes the next
packet's instrument differ from the previous nine. That is the right trade — the
alternative is continuing to compare scores whose harness was assembled
differently each time — but the change must be recorded in the next packet's
README and in the calibration record, stating that the validator itself is
unchanged.

Do **not** retrofit existing packets; their records stand as run.

## Resolution — 2026-09-16

`benchmarks/tools/social-messenger/choreography/` now carries its own
`lib/json-schema.mjs`, and `setup-identity.mjs` and `startup.test.mjs` import it as
`./lib/json-schema.mjs`. A copied harness is therefore self-contained at any depth,
and no builder has to invent a validator.

`benchmarks/tools/lib/json-schema.mjs` is unchanged and remains the original;
`record-validator.mjs` and the metering tests still resolve it from their own
locations.

`choreography/harness-self-contained.test.mjs` guards both halves: that the copied
validator loads and validates inside a harness with no installed dependencies
(it imports nothing but Node built-ins, so it runs in a bare copy), and that it
stays byte-identical to the tools-wide original. 2 tests, both passing.

Existing packets are **not** retrofitted; their records stand as run. The next
packet's `INSTRUMENT_COMMIT` will differ from the previous ten, and its README and
calibration record must say so, noting that the validator itself is unchanged.
