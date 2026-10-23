# SDK must retain unresolved intent after an unknown commit outcome

Status: Open
Date: 2026-10-22
Scope: Snapback 4 SDK (`packages/snapback4/src/client.ts`, `local.ts`, `writes.ts`)
Severity: P1

Reviewer A's blind K0-Q round-2 review reproduced this with the actual SDK source
and an injected HTTP 500 `E_COMMIT_OUTCOME_UNKNOWN` envelope: a committed mutation
became `state: "failed"`, pending writes became empty, and a second application
invocation used a new operation ID. The online client clears pending custody,
the local client persists a failed receipt, and receipt recovery preserves that
failure rather than accepting a later acknowledgement. Retrying the apparent
failure with another ID can apply it twice.

K0-Q fix round 2 removes the serving acknowledgement timeout that manufactured
this error after 30 seconds. Genuine unknown outcomes remain possible when an
uncancellable Postgres COMMIT fails without a known rollback, or when the
committer dies after execution starts. The SDK must:

- Retain unresolved intent and pending custody rather than marking the write as
  definitively failed or deleting it.
- Reconcile by persisted receipt/operation ID, accepting later committed
  acknowledgement evidence and making the unresolved state visible to callers.
- Never automatically replay unkeyed work; lack of an acknowledgement is not
  evidence that the operation was not applied.

Add SDK regressions for an unknown envelope followed by a durable receipt, local
restart/recovery, and unkeyed work that cannot be safely replayed. Client changes
are explicitly outside the K0-Q lane. Server evidence and limitations are in
[the lane report](../snapback4/reports/20261022-k0q/REPORT.md).

## Status 2026-10-23 (lead): three fix rounds, not converged — descoped from the Postgres program

An implementation exists on the unlanded branch `sb4-pg/sdk-unknown`, at
`f8b9b82599` on expo-build-450a `~/projects/sb4-s10a`, also fetched into the
main checkout. It adds a public `{ state: "unknown", id, why }` arm to
`Write`/`Signal`, and four custody invariants enforced at one chokepoint per
SDK arm:

- **I1 store fence:** an id is never POSTed to a store other than its durable
  dispatch store.
- **I2:** an unknown settles only on a confirmed result from its bound store,
  or on a visible retirement after an observed identity change.
- **I3:** no silent loss.
- **I4:** the unknown marker is durable before a later response is processed.

The chokepoints are online `onlineWriteCustody`, local/native
`LocalWriteCustody` with Rust `custody::transition`, `WebWriteCustody`, and the
worker. Seeded property models cover each arm. The branch also raises the
device wasm cap to 741,334 B gzip (+5.9 KB).

Three rounds of blind two-family review never converged; each found new
paths. The final review (round 3) still reports:

- Private OIDC/identity-runtime mutations POST `/m/` outside custody
  (`identity-runtime.ts` ~65, ~95) and turn unknown or `E_COMMITTER_STOPPED`
  into a terminal error.
- Delivery-report interval eviction, group eviction, fingerprint replacement
  and scope departure delete unknown report attempts (`delivery-state.ts` ~82,
  `device/delivery.rs` ~159, ~189).
- An identity-preserving restore clears all delivery metadata, including
  unknown reports (`store_identity.rs` ~116, `delivery.rs` ~29).
- New in round 3: implicit server-action ids derived as `writeIdFor(...,
  "mutation:1")` collide with legal explicit labels (`server-context.ts`
  ~151).
- Sign-out pause promotes a confirmed `sent` or a confirmed retryable hold to
  unknown (`online-write-custody.ts`, `app-online.ts`, `app-journal.ts`).
- An action store mismatch publishes a replacement retirement before any POST
  (`server-context.ts` ~69–76).
- Worker page-hide keeps no device dispatch marker, so I4 depends on
  localStorage surviving.
- `Change::Remove` accepts any non-unknown failed history.
- Ephemeral signals and staging provisioning POST outside custody.
- The models are twelve scripted single-store episodes for actions and
  reports, and do not drive sign-out pause.

Recommendation: treat this as a dedicated SDK project, not a fix round.
Start from the branch, and first write a census of every code path that can
POST `/m/` or mutate outbox, journal, history or delivery state. Route every
one of them through custody before changing settlement behaviour. Main keeps
the current behaviour, which settles an unknown outcome as failed. Status
remains Open.
