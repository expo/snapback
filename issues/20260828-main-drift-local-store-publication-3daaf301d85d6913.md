# main drift: local-store-publication has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-28
**Drift gate:** `local-store-publication`
**Outcome:** `STALE`
**Failure signature:** `sha256:3daaf301d85d6913e43803ee7a20710d5ad4932924e9f3125bd6530baa7db90c`
**Causal landing:** `9159d5e3a60048924a19eb1fbe1f790a57b4f90c` (feat(engine,server): W5 runtime-cost recorder and server observations)
**Detected at:** `9292bb876ee0281d745933b4181bdd782dcc2511`
**Last observed:** `6918cccbc264cf000982b03a5a11a2cf5563f885`
**Attribution:** `first-parent-signature-epoch`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `local-store-publication` independently of path selection on
`main` and found the committed record stale. The conservative first-parent-signature-epoch attribution names the landing above. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `crates/snapback-engine/src/local-persistent-store-publication.v1.json and crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node tests/conformance/local-persistent-store-publication-v1.mjs
```

Regenerate/reconcile:

```sh
scripts/finalize-local-persistent-store-publication
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
