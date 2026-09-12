# Snapback 2 `POST /control/why` defaults to executing mutations

**Status:** Resolved
**Priority:** P3
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2/src/control.rs` (`/control/why`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1002 `why` (diagnostic); control is loopback+secret

## Symptom

`POST /control/why` defaults `queryOnly` to **false**. `writer_ledger.rs` therefore executes mutations when the flag is omitted. The CLI always sends `"queryOnly": true`. The protected harness omits it on purpose to harvest replay traces. A raw control-plane POST with a mutation `op` writes.

Control is loopback+secret, not the public `/api/*` surface — still a footgun on the operator seat (`why` sounds read-only).

## Proposed patch

Default `queryOnly` to true; have the harness opt in with `queryOnly: false`.

```rust
        ("POST", "/control/why") => call(Action::Why {
            op: body
                .get("op")
                .and_then(Json::as_str)
                .unwrap_or_default()
                .to_owned(),
            args: body.get("args").cloned().unwrap_or_else(|| json!({})),
            query_only: body
                .get("queryOnly")
                .and_then(Json::as_bool)
                .unwrap_or(true),
            identity: control_identity(&body),
        }),
```

Update the harness that omits the flag to send `"queryOnly": false` in the same change.

## Acceptance

- `POST /control/why` with a mutation `op` and no `queryOnly` does not write.
- CLI `snapback2 why` still traces without executing (already sends true).
- Harness replay-trace harvest still works via an explicit `queryOnly: false`.

## Resolution (2026-09-12)

Control why defaults queryOnly to true. Callers intentionally requesting mutation traces (journey/test helpers) now explicitly set false. The raw owner boundary test verifies omitted queryOnly refuses a mutation without advancing the store and explicit false executes; the integrated owner suite passed all 11 selected tests.
