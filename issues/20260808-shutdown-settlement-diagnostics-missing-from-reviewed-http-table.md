# Main red: three diagnostics missing from the reviewed HTTP table

**Opened:** 2026-08-08 · **Severity:** P2 (red on `main`, fix-forward per LLP 0189)

`cargo test --lib server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`
fails on `main`:

```
production diagnostics and the reviewed HTTP table drifted;
unclassified=["SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE",
              "SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS",
              "SNAPBACK_SHUTDOWN_WAL_CHECKPOINT_INCOMPLETE"]; stale=[]
```

The shutdown pair comes from `b71969a5b` (graceful-shutdown SQLite checkpoint,
emitted in `src/cli.rs`); `SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE` arrived on
a sibling landing the same day. Each minted a production diagnostic without the
matching row in `status_for_established_diagnostic_code`
(`src/server.rs`) and the harness passthrough list, which is exactly what the
inventory test exists to catch.

Found while landing `20260808-stored-literal-union-enums.md`; that landing's own
suite is green (2282 passed / 1 failed, the failure being only this one). Not
caused by it and not repaired by it — recorded here as a fix-forward ticket per
LLP 0189 rather than blocking unrelated work.

**Fix:** classify all three in the reviewed HTTP table with the right status
codes (the shutdown pair are operator-facing CLI conditions, so check whether
they belong in the served table at all or should be excluded from the
production-diagnostic scan), and add them to
`packages/snapback-harness/envelope.mjs` passthrough if they can reach a
handler envelope.
