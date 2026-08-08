# Hot-cycle live streams go stale and never recover at the 5.5M-row scale

**Opened:** 2026-08-07
**Area:** live-query stream lifecycle under mutation fan-out at scale — server delta loop and/or `packages/snapback-client` stream resubscribe retry
**Severity:** P2 — data converges correctly (authoritative polls return exact rows); the live stream contract is what breaks
**Blocks:** Zerobugs `zb5-hot` qualification (`demos/zerobugs/manifest/acceptance.v1.md` §4.4)

## Observed

zb5-hot cycles a 5,549,113-row baseline: six streaming `issueListV2`
observers (five bound actors + anonymous, `transport: 'stream'`,
`fallbackToPoll: false`, 1,000-row windows), then 16 mutations dispatched
open-loop at 25 ms offsets. On both receipted live attempts
(`snapback-control-hot.zb5.v7.json`, `.v8.json`, preserved FAILs):

- Every observer establishes live and receives its exact initial window.
- The mutation cycle runs; authoritative polls at settle return the exact
  expected rows, counts, and protected-visibility facts for every actor —
  convergence itself holds.
- The ordinary-user observer's stream reads `'stale'` at settle, and in v8
  a bounded 30-second recovery window expired without the stream ever
  returning `'live'`. Not scheduler noise: v7 ran on a heavily contended
  machine, v8 on a mostly quiet one, identical outcome.

## Isolation

The client holds `'stale'` on the socket-lost path when `fallbackToPoll`
is disabled ("hold at 'stale' with last-known rows; the fresh subscribe
re-enters on socket regain") — so the observer's stream socket was lost
mid-cycle and did not regain within 30 s. Two candidate mechanisms, not
yet discriminated:

1. **Server delta starvation:** each mutation invalidates the opaque JS
   `issueListV2` for six observers; the handler re-runs its full bounded
   list-engine assembly (~1.3 s standalone at this scale — see
   `snapback-control-large.zb5.v3.json` raw-list-ready). 16 mutations ×
   6 observers ≈ up to ~96 heavy re-evaluations owed within a 400 ms
   dispatch burst; if the stream write/keepalive path shares that loop,
   sockets time out and drop, and continued starvation prevents regain.
   (Family resemblance: the ticketed live fan-out declared-vs-captured-
   reads defect found by LLP 0146 work.)
2. **Client resubscribe-retry defect:** with `fallbackToPoll: false`, the
   fresh subscribe re-enters on socket regain via the open handler, "a
   failure there is covered by the retry loop" — if that retry loop does
   not fire in this configuration, a single drop is permanent regardless
   of server health.

## Diagnostic recipe (do this before any fix)

Standalone supervised harness, NOT a receipted gate attempt: run the
`zb5-hot` baseline ingest once into a persistent scratch db (~66 min,
`scripts/load-large-fixture.mts` + the acceptance seam), keep the server
alive, then iterate: open six observers with instrumented
`onConnectionChange`/socket-event timestamps, capture server stderr live,
dispatch the 16-mutation cycle repeatedly, and observe (a) when/why the
socket drops (server log correlation), (b) whether the client ever
attempts resubscribe. The db+keyring pair can be cloned per iteration
(`cloneBaselineDatabase` semantics) without re-ingesting.

## Boundary

`zb5-hot` closes at this honest boundary exactly as Lane 8 closed on the
P1 version-scan finding: attempts v1–v8 preserved (each isolated one real
defect — kit stop grace, SIGTERM WAL strand, 12 GiB hasher, sessions
keyring sibling, anonymous live protocol header, vacuous-pass hardening,
and this stream lapse), §4.4 hot rows remain GAP owned by this ticket,
and the rerun (`ZBUGS_ATTEMPT=v9`) uses the recipe in the program memory
after the repair lands. Nothing backfills the existing receipts.

## Diagnosis — 2026-08-07 (instrumented run against the persistent baseline)

The ticket's two original hypotheses are both **refuted**. Instrumented
trace (`demos/zerobugs/fixtures-local/hot-diag-baseline/diag-run1.jsonl`,
1,913 records; instrument `demos/zerobugs/control/scripts/diag-hot-stream.mts`;
3 cycles × 16 mutations, 180 s observation windows):

- **Sockets never dropped.** Manager events are exactly the six
  connecting/open pairs at startup — no loss, no backoff, nothing to
  regain. Server delta starvation of the transport did not occur.
- **The client never attempted a resubscribe because none was ever
  warranted.** Exactly six subscribe attempt/result pairs, all at initial
  open, all successful.
- **The actual mechanism is an authorization-invalidation protocol
  conflict.** Deliveries flowed normally (676 update/boundary frames,
  ~100–160 per observer), then each observer hit
  `SNAPBACK_AUTH_INVALIDATION_CORRUPT: one acknowledgement token or scope
  revision named conflicting resolution frames` (32 occurrences total;
  first at t≈65 s, five observers within 3 s of each other, the sixth at
  t≈209 s) and was **quarantined** — the client's fail-closed path
  (`reportAuthorizationError` → `authorizationDisposition: 'quarantine'`
  → connection `'stale'`), which by design never self-recovers without an
  authority transition. Authoritative polls kept converging exactly
  throughout.

Client-side detection site: the applied-resolution bookkeeping rejects a
resolution whose ack-token key matches an already-applied resolution but
whose frame identity (stable JSON of obligation + resolution + snapshot)
differs (`packages/snapback-client/index.mjs`,
`conflictingAuthorizationResolutionError`). The refusal is correct
LLP 0146/0157 fail-closed behavior. The defect is therefore
**server-side: under concurrent mutation fan-out at the 5.5M-row store,
the invalidation stream reuses an acknowledgement token or scope revision
with conflicting resolution-frame content.** Repair is runtime-owned
(invalidation frame/ack-token minting under overlapping obligations), in
the same class as the P1 version-scan finding.

Reproduction is now cheap: the persistent baseline + live server recipe
in this ticket reproduces the conflict within ~65 s of a cycle start,
every run. After the runtime repair: rerun the instrument (expect zero
`authorization_error` records and six live streams at settle), then
`zb5-hot` `ZBUGS_ATTEMPT=v9`. The zb5-hot settle change (bounded 30 s
recovery + disclosure) remains correct — a quarantined stream will keep
failing the gate honestly until the server fix lands, as it should.

## RESOLVED — 2026-08-08

The runtime fix (invalidation resolutions supersede with distinct
revisions; landed 83fcb01cc) is verified at every level: the instrumented
probe went from 32 conflicts to zero with all six streams live; zb5-hot
v9 passed the reset-and-cycle check that had failed eight attempts; and
zb5-hot v10 is PASS 21 / GAP 3 / FAIL 0 with all eighteen observer
instances live at settle and zero stale flags
(`demos/zerobugs/evidence/snapback-control-hot.zb5.v10.json`). The
persistent diagnosis baseline under
`demos/zerobugs/fixtures-local/hot-diag-baseline/` can be deleted or kept
for future stream work; the instrument remains at
`demos/zerobugs/control/scripts/diag-hot-stream.mts`.
