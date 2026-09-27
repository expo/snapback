# Snapback 4: atomic Following launch — the in-lock ceiling recheck lacks an interleaving test

Opened 2026-09-27 at lane FA's landing. Severity: Low (test gap; the code is correct).
Source: `~/sb4-intent/reviews/fa-r4.astra.md` (READY).

`Store::activate_at_with_launch` repeats the launch preflight under SQLite's writer
lock (`store/activation.rs:111`), after the unlocked estimate. The ceiling tests
use quiescent sources, so a mutation that reuses the unlocked estimate survives.

Scenario: 1,000 originals and 4,999 followers estimate exactly 5,000,000 copies.
After that estimate, another connection commits one more follow before activation
takes the writer lock; the new total is 5,001,000. Current code refuses; the
mutant would proceed.

Fix: add a deterministic pause between the two admission points, commit that
follow, then assert refusal before any candidate write and an unchanged
generation, sequence, slot set and owned catalog.
