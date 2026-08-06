# LLP 0163 public operation-identity carrier and coverage activation

**Status:** Open
**Opened:** 2026-08-03 (LLP 0163 durable storage slice)
**Reconciled:** 2026-08-05 (LLP 0185 Phase 0 — narrowed this focused ticket
to LLP 0163's carrier/coverage legs; LLP 0165 retains the global journal-
completeness choke point and LLP 0162 retains row-completion authority)
**Systems:** Sync, Client integration, Storage, Jobs, Migrations, Testing
**Related:** LLP 0043, LLP 0133, LLP 0162, LLP 0163

The LLP 0163 durable store and ordinary-mutation choke point accept an
authenticated `OperationIssuanceV1`, but no public request currently carries
one and no server endpoint issues finite authenticated ranges. Clients
therefore cannot atomically persist a range alongside queued intent or refresh
an exhausted range at reconnect. Production targets also do not activate a
coverage manifest, and host-originated job/cron/migration writers do not yet
construct host-incarnation identities.

Required closure:

- define and generate the range issue/refresh request and response carrier,
  authenticate it to the authority-instance incarnation, and pass the issuance
  through ordinary mutation admission without creating a second retry id;
- persist issued range state atomically with client counter allocation and
  queued intent, with crash/reopen and exhaustion/refusal corpus;
- inventory every durable writer per target, route each covered writer through
  the LLP 0163 envelope hook, activate a versioned manifest only after bypass
  and asymmetric envelope/journal-retention corpus pass, and keep undeclared
  lanes explicit;
- wire server-authenticated attempt-invariant host identities for jobs, cron,
  migrations, and child commits, including transport-level proof that a client
  cannot mint the host namespace;
- complete public/admin explanation transport and real current-policy
  evaluation, including protected custody for secret-bearing facts; and
- rerun LLP 0162 Acceptance row 13's comparable candidate protocol with the
  public issuance-bearing covered lane active under a genuinely paired,
  baseline-digest-bound protocol; the clean 2026-08-03 binary observations
  were within threshold but used ordinal-zipped historical samples and did not
  activate that lane.

Until all relevant corpus rows pass for a named target, capability manifests
must remain `Missing` and must not advertise envelope coverage.

## Scope fence after LLP 0185 Phase 0

This ticket owns LLP 0163's public carrier, target writer inventory,
envelope-hook routing, coverage-manifest activation, explanation transport,
host identity callers, and its row-13 measurements — the LLP 0162 row
1–4/13/14 legs enumerated above. It does **not** own LLP 0165's global
generated lane-writer facade plus SQLite-authorizer completeness choke point,
even though both efforts meet in row 4. The consolidated row ledger remains
`issues/20260803-agent-safe-storage-acceptance-tail.md`; neither ticket may
mark a row complete independently of LLP 0162.
