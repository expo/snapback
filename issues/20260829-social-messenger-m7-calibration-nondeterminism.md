# Social-messenger M7 calibration is nondeterministic

**Status:** Open

**Opened:** 2026-08-29

**Systems:** Benchmarks, Social-messenger choreography, M7 polls

**Related:** LLP 0201; `benchmarks/tools/social-messenger/choreography/self-test.mjs`

## Problem

While qualifying `social-messenger@0.3.6-m8`, the unchanged full choreography
self-test has failed its M7 calibration in at least two qualification passes
and passed on each immediate identical rerun. The second occurrence ran from
the exact read-only materialized snapshot, not the source checkout. The failing
diagnostic was:

```text
M7 idempotent-vote calibration failed (1)
m7-a05-offline-vote-reconciles
Alice's retained switched poll selection did not become observable within 5000ms
```

The rerun passed all ten assertions, including M1, M7, and M8. This is a
pre-existing nondeterministic calibration boundary, not an introduced content
red from the 0.3.6 frozen-root identity repair.

## Scope

Reproduce the retained vote-switch timing under controlled load, identify
whether the 5-second observation window or the calibration adapter is wrong,
and make the self-test deterministic without weakening the registered M7
assertion. Retain both the failing and passing receipt vectors when the
reproducer lands.

LLP 0317 Wave 5 records M7 as environment-null and does not execute M7 in its
product cells, so this issue does not gate that scoped rerun. The N7 preflight,
frozen-root verifier, and scale fixture remain hard entry gates.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — instrument reliability. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The original same-input fail/pass calibration observations remain valid. Later passing M7 apps and self-tests do not identify the vote-switch timing cause or prove deterministic calibration.

Keep this as a shared instrument issue, not an application vote-loss claim. Next: bounded repeated original-deadline calibration with recorded load and vote-state/observer ordering; preserve every failing and passing receipt. No new browser calibration was run in this triage.
