# complete battery red: password-ephemeral-authority-successor

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-02
**Battery gate:** `password-ephemeral-authority-successor`
**Failure signature:** `sha256:8373545f2cb90dfdae6b775fd165ad3dec143764e504bc5525fc41f7bc2604c7`
**First observed run:** `local.20261002T052302Z.0f516b324120`
**Last observed run:** `local.20261002T052302Z.0f516b324120`
**Last processed run:** `local.20261002T052302Z.0f516b324120`
**Detected at revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
**Last observed revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `password-ephemeral-authority-successor` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `password-ephemeral-authority-successor` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/password-ephemeral-authority-successor.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
