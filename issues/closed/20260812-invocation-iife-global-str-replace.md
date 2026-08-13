# Invocation IIFE is assembled by sequential global `str::replace`

**Opened:** 2026-08-12 · **Severity:** P2 (correctness / template hygiene next to secrets) · **Area:** runtime / Ibex

## What

```4476:4484:src/runtime.rs
        include_str!("../packages/snapback-harness/invocation-iife.js")
            .replace("__SNAPBACK_EXPORT__", &export_json)
            .replace("__SNAPBACK_ARGS__", &args_literal)
            .replace("__SNAPBACK_AUTH__", &auth_literal)
            .replace("__SNAPBACK_MODE__", &mode_json)
            .replace("__SNAPBACK_RUN__", &run_literal)
            .replace("__SNAPBACK_SECRETS__", &secrets_literal)
            .replace("__SNAPBACK_EPOCH__", &epoch_literal),
```

`str::replace` is global. Args, auth, and secret **values** are already in the source when later tokens (`__SNAPBACK_SECRETS__`, `__SNAPBACK_EPOCH__`) are substituted. Because every replacement is a JSON string literal (quoted), a user string containing `__SNAPBACK_EPOCH__` typically becomes a **SyntaxError** (request fail-closed), not a clean breakout. A secret whose bytes contain that token would be rewritten or would fail the invocation.

Workerd does **not** have this bug: it passes fields as JSON (`src/workerd_exec.rs:700`).

## Why it matters

Any client-controlled string argument is a landmine for the Ibex eval. It is also the wrong primitive next to secrets: source substitution of attacker- or operator-controlled bytes is how template-injection RCEs start. This is **not** a claimed RCE with the current quoted literals; it is a fail-closed SyntaxError / secret-corruption footgun.

## Fix

Stop splicing. Eval a fixed IIFE and pass one `serde_json` object into a host-set global, or `JSON.parse` a single serialized struct. If you keep placeholders, use one replacement of a token that cannot appear inside JSON (or substitute by index after parse).

## Confidence

High on the mechanism. No verified breakout.

## Resolution (2026-08-12)

The Ibex invocation tail now serializes all invocation fields into one struct,
serializes that JSON as one JavaScript string literal, and inserts it once into
a fixed IIFE by splitting at a unique raw-newline slot that cannot occur in the
serialized literal. Sequential global replacement is gone, workerd remains
unchanged, and all former placeholder tokens round-trip verbatim through a real
handler while the tagged settlement envelope stays identical.
