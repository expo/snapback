# Sessions-mode lifecycle-callback execution authority — design question

**Status:** CLOSED — IMPLEMENTED 2026-08-04 (ruled 2026-08-03;
W2c's sessions-generation refusal has been replaced by the scoped
service-principal execution path)

Dev-lane callbacks execute through the staged-mutation path under the
asset owner's dev-admitted authority with client-mutation-ledger
idempotency. Sessions mode has no equivalent: the runner holds no
session bearer for the asset owner, and minting one would counterfeit a
session. The concrete design question, assessed with the sessions
authority seams fresh:

1. **What identity runs the callback?** The candidates: (a) a
   system-principal execution class (a trusted server-side authority
   distinct from any user session — does not exist today for app
   mutations; closest prior art is LLP 0055's service principals, whose
   grants are scoped and auditable); (b) the asset owner's identity
   under a server-minted, non-bearer execution context (needs a new
   0039-side authority class: "server-scheduled execution as user X,
   no session"); (c) refuse forever and require sessions apps to
   consume lifecycle state via live queries instead of callbacks.
2. **What does `ctx.auth` see inside the callback?** Whatever class is
   chosen must project honestly (LLP 0053's sealed `ctx.auth` closure):
   a callback authorized as "scheduled-on-behalf-of owner" must not be
   distinguishable-from-interactive in ways app code could exploit, or
   must be *explicitly* distinguishable (an `actorKind`), never
   ambiguous.
3. **Invalidation/witness obligations:** a callback writing app rows
   under (a) or (b) participates in commit-time validation and can be
   an authorization event producer like any mutation — no new 0053
   machinery expected, but the authority class needs its 0039/0055
   classification before any implementation.

Recommendation recorded (not decided): option (a) via an LLP 0055-style
scoped service principal minted per app ("asset-callbacks"), because it
reuses the audited grant vocabulary and keeps "who ran this" explicit
in receipts. Needs an 0039/0055-side dated amendment before code.

## Ruling (2026-08-03)

Ruled by Charlie at author decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`): **option (a)** — a
per-app scoped LLP 0055-style service principal named
`asset-callbacks`. The 0039/0055-side dated amendments this ticket
prescribed are landed: LLP 0039 §Dated amendment: sessions
asset-callback execution authority (2026-08-03) records the authority
class, the explicit `actorKind` projection through `ctx.auth`, and the
commit-time validation/authorization-event posture; LLP 0055 §Dated
amendment: per-app `asset-callbacks` service principal (2026-08-03)
records the scoped-grant classification. The ticket is now
implementable (still open until W2c's generation-time refusal is
replaced by the ruled execution path).

## Resolution (2026-08-04)

Implemented option (a). Sessions-mode lifecycle callbacks now resolve one
protected-catalog `asset-callbacks` agent principal per app and an immutable
exact-function grant per callback mutation in
`src/storage/auth_asset_callbacks.rs`. `src/local.rs` executes the declared
callback through the same staged mutation, commit-time validation, receipt,
and client-mutation-ledger idempotency path used by dev callbacks, without
minting an owner bearer or user session. `src/auth/invocation.rs` seals the
honest handler projection (`kind: "agent"`, `actorKind: "asset-callbacks"`,
`sessionId: null`) and preserves explicit service-principal attribution. The
asset work-completion receipt names the service actor and exact grant, never a
bearer.

W2c's codegen refusal has been removed. Unit coverage pins per-app principal
and exact-grant scoping plus the `actorKind` projection; the real-server
sessions witness in `tests/acceptance/asset-conformance-v1.mjs` uploads an
asset, drives its lifecycle work, observes the committed callback row, and
proves the actor is not the uploader's session principal. LLP 0039, LLP 0044,
LLP 0055, the asset guide, and the lifecycle evidence map now record the
implemented posture.
