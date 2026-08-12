# Action secret redactor does not cover `runtime.log` or stderr console

**Opened:** 2026-08-12 · **Severity:** P2 (secret leakage into diagnostics) · **Area:** runtime / secrets / telemetry

## What

Local actions inject **raw secret values** into JS handles (documented local value-mode, LLP 0036). Error envelopes **are** scrubbed (`redactor.redact_error` on the detached action boundary). `runtime.log` is not (`src/runtime.rs:2396-2404`):

```2396:2404:src/runtime.rs
            "runtime.log" => {
                let level = args.get("level").and_then(Value::as_str).unwrap_or("log");
                let message = args.get("message").cloned().unwrap_or(Value::Null);
                capture_runtime_log(level, &message);
                if matches!(
                    env::var("SNAPBACK_HANDLER_CONSOLE").ok().as_deref(),
                    Some("stderr")
                ) {
                    eprintln!("[snapback handler console.{level}] {message}");
```

Telemetry keeps `message` on the details allowlist (capped at 8 KiB), with no `SecretRedactor`. `SNAPBACK_HANDLER_CONSOLE=stderr` prints the same bytes.

## Why it matters

LLP 0009: “Diagnostics are useful without leaking secret values.” A routine `console.log` / `ctx` console shim, or `runtime.log` of `handle.expose()`, persists the live key in the telemetry sibling and/or process stderr. Cron/job actions run unattended with those grants.

Successful action results are also not redacted (handler can `return secret.expose()`); that last part is an acknowledged local-profile fact, not this ticket.

## Fix

Run `SecretRedactor` (the same staging-time one already on `DetachedIbexAction`) across `runtime.log` messages, stderr echo, and any host-call trace of `host.fetch` headers.

## Confidence

High. Closed `issues/closed/20260723-llp0076-secret-scrubbing.md` was about stream **descriptor** slots, not this sink.
