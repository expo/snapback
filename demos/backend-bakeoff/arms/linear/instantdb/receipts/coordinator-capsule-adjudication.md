# Coordinator capsule adjudication

**Date:** 2026-07-28

The worker-delivered capsule did not pass the current repository verifier. It
used `offline-reconnect`, which is not a frozen transport-attribution enum, and
omitted required monotonic bounds from six command records.

The generator now attributes the offline scenario as `local-optimistic`; its
authoritative check and direct browser receipt continue to distinguish
retained cache, blocked provider transport, queued optimistic state, and
authoritative reconnect settlement.

The command records now use explicitly labeled coarse, non-overlapping bounds
derived from the retained target, acceptance, and cleanup milestones. They are
protocol-complete bounds, not newly claimed stopwatch precision. Individual
configuration, browser, performance, and cleanup receipts remain the direct
evidence.

After regeneration, the current frozen capsule verifier passes. No scenario
outcome, product classification, or evidence-confidence score changed.
