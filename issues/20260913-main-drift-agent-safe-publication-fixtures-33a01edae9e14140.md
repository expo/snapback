# main drift: agent-safe-publication-fixtures has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-13
**Drift gate:** `agent-safe-publication-fixtures`
**Outcome:** `STALE`
**Failure signature:** `sha256:33a01edae9e14140609b76a2827007ace532912a9207e137cfdb8ca7a91464c3`
**Causal landing:** `6abe83b639ae602d7d6ad5e001e0558b1322484a` (Park Snapback 1-3 tickets and keep Snapback 4 as the working set)
**Detected at:** `cca6a2d0b1fc14f337f592c880e260242b97fd9b`
**Last observed:** `0dad042375057d2dad8c429424713986581432e7`
**Attribution:** `first-parent-signature-epoch`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `agent-safe-publication-fixtures` independently of path selection on
`main` and found the committed record stale. The conservative first-parent-signature-epoch attribution names the landing above. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `tests/agent_safe_publication_checker_v1.mjs (reviewed generated-publication leaf set)`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node --test tests/agent_safe_publication_checker_v1.mjs
```

Regenerate/reconcile:

```sh
node scripts/update-agent-safe-publication-leaf-set.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
