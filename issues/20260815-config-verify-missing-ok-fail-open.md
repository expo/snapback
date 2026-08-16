# `config.verify` records success when the probe omits `ok`

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 5
**Confidence:** 5
**Systems:** Config, Secrets, Admin wizard
**Date:** 2026-08-15
**Governing:** LLP 0036 (config verification)
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

```18125:18144:src/local.rs
        let record = match result {
            Ok(value) => {
                let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(true);
```

A successful handler return of `{}`, `{ "verified": false }`, or any payload
that is not exactly `"ok": false` is stored as **verified**. That flips the
wizard/status “this secret works” bit and unblocks features that gate on
verification.

A thrown/errored probe still records `ok: false`. The fail-open is only the
successful-return-without-`ok` arm.

## Desired outcome

Missing or non-boolean `ok` is `ok: false` (fail closed), with a diagnostic
that the probe did not return the closed `{ ok: boolean }` shape.

## Acceptance

- Probe `{}` / `{ "message": "nope" }` / `{ "ok": "true" }` records
  `verified: false`.
- Probe `{ "ok": true }` still records success.
- Probe `{ "ok": false, "message": "…" }` still records failure with the
  redacted message.
