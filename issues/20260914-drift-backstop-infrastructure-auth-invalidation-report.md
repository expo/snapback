# drift backstop self-health: auth-invalidation-report is repeatedly unavailable

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-14
**Infrastructure gate:** `auth-invalidation-report`
**Detected at:** `cca6a2d0b1fc14f337f592c880e260242b97fd9b`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop classified `auth-invalidation-report` as infrastructure for at
least 3 consecutive runs. During that streak
the backstop could not determine whether the gate's committed record was
current, so its scheduled self-health needs repair.

Latest infrastructure reason: `observed execution closure changed after the first determinate red`

## Reproduce and repair

Run the canonical check in the scheduled backstop environment:

```sh
node tests/acceptance/auth-invalidation-v1-report.mjs
```

Repair the environment or classifier, verify a backstop run can classify the
gate, record the resolution here, and move this ticket to `issues/closed/`.
