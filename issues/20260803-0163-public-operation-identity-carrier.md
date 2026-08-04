# LLP 0163 public operation-identity carrier and coverage activation

**Status:** Open
**Opened:** 2026-08-03 (LLP 0163 durable storage slice)
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
  the envelope hook, activate a versioned manifest only after bypass and
  asymmetric-retention corpus pass, and keep undeclared lanes explicit;
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

## Progress — 2026-08-04

Landed in the public client carrier slice:

- Rust-owned issue/refresh request and response schemas and the authenticated
  `/client-mutations/identity-range` route;
- server-selected finite ranges with latest-range continuity and safe recovery
  of a committed-but-undelivered first response, with issuance kept separate
  from the still-unpublished ordinary coverage activation cut;
- `operationIssuance` on the existing mutation retry identity, selected-artifact
  binding, and transport refusal of client-minted host identities;
- one dormant server-controlled coverage seam declaring the HostPlan and Ibex
  buffered writer inventory, with identity-less refusal proven only after an
  explicit corpus activation; and
- atomic range/counter/intent custody on memory parity, IndexedDB, and file
  stores, including crash/reopen, exhaustion, refresh-before-admission, and
  client wire corpus. The client carrier remains explicit opt-in while LLP
  0163 is Draft and capabilities are `Missing`.

Landed in the explanation/protected-custody slice:

- Rust-owned exact-operation request/response schemas plus authenticated
  `/operations/explain` and AdminRead
  `/_snapback/api/operations/explain` routes, with the latter strengthened to
  the existing secret-read lease gate in sessions mode;
- current AdminRead policy evaluation and a public lane that resolves the live
  principal/incarnation but deliberately returns `authorization-unprovable`
  until row/non-row policy can be re-evaluated per fact (Partial, never an
  authorization claim inferred from identity equality);
- owner-only sidecar keys and XChaCha20-Poly1305 custody for read, write,
  context-answer, and receipt detail, with one fail-closed projection covering
  those four protected classes plus inline-redacted effects; and
- LLP 0158 fork custody extended so protected-detail ciphertext is scrubbed,
  the key sidecar rotates, absent minted custody refuses boot evidence, and
  neither parent key nor ciphertext crosses into a derived fork.

Landed as row-13 evidence scaffolding, without changing capability state:

- a release-only recorder that binds the accepted baseline artifact bytes,
  exact pre-profile revision plus three-blob instrumentation provenance,
  baseline and candidate executable digests, exact clean candidate revision,
  fixed Air hardware/OS, and the accepted toolchain;
- 11 experimentally time-local comparisons in alternating AB/BA order whose
  candidate worker activates the actual `ordinaryMutation` coverage manifest,
  obtains a server-issued client range, and commits issuance-bearing mutations
  through the production envelope seam; and
- an explicit non-qualification boundary: the recorder covers the registered
  read and single-writer metrics only. Paired idle CPU/RSS/disk,
  active-covered allocation/retention, the fixed-Air dated result, and the
  other row-13 gates remain open.

Still required before this ticket closes:

- first-party host identity adapters for jobs, cron, migrations, and stable
  child ordinals (promotion's authenticated host lease is already wired);
- real per-fact current-policy evaluation for the public explanation lane (the
  admin transport and protected custody are wired; public stays Partial and
  fail-closed);
- the complete target writer/bypass/asymmetric-retention acceptance corpus;
  and
- the genuinely paired, baseline-digest-bound active-lane row-13 performance
  record (including the still-unmeasured active byte and idle legs) and the
  required independent review/author acceptance.
