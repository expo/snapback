# F145/F272 remain gated on a cross-crate ownership change

Status: open — implementation stopped after executed counterexamples
Created: 2026-08-26
Systems: Authorization, Assets, Storage, Kernel, Sync, Engine, Server, Test support
Related: LLP 0312, LLP 0303, LLP 0058, LLP 0225,
`issues/20260824-implementation-plans-remaining-p2-rows.md`

## Finding

Neither F145 nor F272 can honestly carry a closure trailer in the current crate
topology. The checkpoint implementation closed the old F145 spelling, but an
adapted dependent composition reached the replacement public sync bridge. F272
remains directly reachable through the public raw kernel staging trait.

This is the negative-result branch LLP 0312 explicitly allowed for F272. The
same cross-crate privacy constraint also applies to the RFC's required F145
`LocalSnapback`-only preparation owner and was not accounted for in the RFC.
No carrier or partial closure is retained by this landing.

## Executed evidence

The checkpoint baseline (`d872507e1`) reported:

```text
F145 | production            | CLOSED | CLOSED | MATCH
F145 | additive-test-support | CLOSED | CLOSED | MATCH
F272 | production            | OPEN   | OPEN   | MATCH
F272 | additive-test-support | OPEN   | OPEN   | MATCH
```

The F145 witness named only the removed two-argument spelling. It was adapted
to call the replacement bridge with `&mut ServingDatabase`, function ID,
profile, and the matching admission lease. The dependent binary compiled and
ran in both cells:

```text
SNAPBACK_ROW_ATTACK {"row":"F145","observed":"OPEN","diagnostic":"dependent selected the app/function/scope and prepared callback authority outside LocalSnapback"}
```

F272's dependent binary called
`AssetAttemptsProofLocalExt::stage_width_variant_plan_proved_guarded(...,
|| Ok(()))`. It committed an attempt-less width publication and printed the
committed publication ID in both cells. It used neither an engine graph nor a
route reservation.

The source-visible compile boundary spellings also compile in every permitted
fixture closure: `[]`, each of `snapback-auth/test-support`,
`snapback-engine/test-support`, and `snapback-sync/test-support` alone, and
their union. Neither fixture declares the forbidden `snapback-server` or
`snapback-activation` test-support paths.

The ownership hypothesis was also executed. Changing
`AssetAttemptsProofLocalExt` to `pub(crate)` made `snapback-engine` fail with
`E0603` at the trait import and `E0624` at the crate-private kernel methods,
including both width staging calls. Restoring public visibility restores the
dependent attack. Splitting only the width method into a separate private
trait narrows the same failure to those two calls; it does not create an
engine-only seam.

## Why the narrow implementation does not exist today

F145's required public owner is `LocalSnapback` in `snapback-engine`, but the
private fields and constructor of `PreparedAuthority` live in
`snapback-sync`. The engine therefore needs a public sync bridge. Making that
bridge `#[doc(hidden)]` does not stop a dependent from calling it. Replacing
its arguments with `ServingDatabase` plus function ID derives the principal,
but still leaves the forbidden public preparation capability outside
`LocalSnapback`, as the adapted composition demonstrated.

F272's exact SQLite transaction and proof constructors are crate-private to
`snapback-kernel`. Its exact effect reservation lives in `snapback-sync`, and
the required graph identity lives in `snapback-engine`. The public extension
trait is currently the only path from the engine to the private kernel
transaction. A replacement public function accepting raw plan facts, a
success callback, a generic trait implementation, or a peer token is another
dependent-reachable binder and reproduces F272.

Rust has no cross-crate friend visibility. Closing these rows therefore needs
one reviewed ownership decision, not a visibility edit:

- co-locate the relevant `PreparedAuthority` construction with the
  `LocalSnapback` callback owner, or move a sealed preparation owner below both
  crates without exposing a generic factory;
- co-locate the width carrier consumer with the kernel transaction, or move a
  sealed commit proof below the reservation and graph owners without adding
  an upward kernel dependency or public binder.

The latter is larger than LLP 0312's hoped-for narrow ownership adjustment and
must preserve LLP 0058's permit-free render/blob-I/O windows and LLP 0225's
kernel-only canonical-store transaction ownership.

## Producer and consumer census

### F145

Producers:

- `LocalDatabase::ensure_asset_callbacks_service_principal` and the public
  `ServingDatabase` forwarding producer;
- the checkpoint's public
  `ServingDatabase::derive_asset_callbacks_service_principal` replacement;
- `InvocationGate::prepare_admitted_asset_callbacks`, which composes the
  principal into `PreparedAuthority`;
- `LocalSnapback::prepare_asset_callbacks_authority`, which can be the
  supported owner only after the sync bridge ceases to be dependent-reachable.

Consumers:

- `HandlerAuthProjection::for_asset_callbacks`;
- `PreparedAuthority::canonical_auth_input` and
  `PreparedAuthority::asset_callbacks_service`;
- the engine callback receipt projection;
- `LocalSnapback::validate_prepared_service_authority_classified` and the
  durable liveness predicate;
- the lifecycle-callback runner branch, the sole current callback effect.

The checkpoint added classified origin validation before the callback durable
effect, but the public preparation consumer remained. Under LLP 0303 revision
(s), the old-spelling compile failure cannot close the effect-wide row.

### F272

Producers:

- public `AssetWidthPrepareTicketV1::new` followed by `prepare`;
- the two caller-backed engine preflight methods and the services
  `remainder-tests` store replacement seam;
- every `PreparedAuthority::reserve_authorized_effect` call;
- the two server route sequences that independently render and reserve;
- 18 checked-in engine-test compositions across eight tests.

Consumers:

- intended `LocalSnapback::asset_width_plan_with_authorized_effect`;
- public raw
  `AssetAttemptsProofLocalExt::stage_width_variant_plan_proved_guarded`;
- private `asset_resolve_width_variant` using that raw consumer with
  `|| Ok(())`;
- public `asset_deliver`, `asset_strict_delivery_prepare_width`,
  `asset_signed_url_issue`, `asset_signed_url_prepare_width`, and
  `asset_deliver_public`, which reach the private helper;
- the strict-delivery and signed-URL production routes;
- the staged and final width commit consumers after the plan cut.

One raw staging consumer is sufficient to keep F272 open even if the intended
sink later accepts a sealed `AuthorizedAssetWidthPlan`.

## Carrier construction audit

The checkpoint candidate F145 carrier kept private fields and durable `Clone`,
added database allocation and creator-process identity, and exposed read-only
getters. It had no `Default`, serde deserialization, `From`/`Into`/`TryFrom`,
builder, tuple conversion, `Deref`/`AsRef`, `map`/`replace`/`into_parts`, dyn
producer, public origin getter, `*_for_test` constructor, or feature-enabled
origin substitution. It still failed the last and decisive rule: a public
peer consumer could prepare callback authority outside the required engine
owner.

No F272 carrier is retained. Any future `AuthorizedAssetWidthPlan` must remain
non-`Clone`, non-`Default`, non-serde, non-convertible, non-decomposable, and
without a public constructor, binder, builder, dyn producer, `*_for_test`
constructor, or additive-feature substitution. Every staging consumer must
accept that exact carrier or derive the same facts wholly inside its trusted
owner.

## Identity lifecycle and denial inversion

The required allocation identity semantics remain:

- clone: `EngineAppStateGraphIdentity` clones retain the same `Arc` and compare
  equal; the width plan itself must not be cloneable;
- rebuild: a new graph allocation refuses an old carrier even when durable
  text is equal;
- restart: carriers are not serialized and are rederived in the fresh graph;
- POSIX fork: inherited pointer identity is insufficient, so current-process
  identity must refuse every inherited carrier in the child before subject
  text or a transaction is used.

An incorrect origin stamp or comparison inverts the harm into
`ORIGIN_FALSE_REFUSAL`: legitimate callbacks or width plans are permanently
denied until work is rederived in a fresh graph. The checkpoint included a
same-graph callback-clone acceptance and rebuild/fork refusal probe, but those
tests cannot justify retaining a partial carrier while the dependent bridge
remains open.

This work adds no durable monotone state. There is no new ceiling or reset
path: a future refused callback must be rederived from the current catalog,
and a refused width plan must be discarded and rerun from preflight.

## Required next decision

Amend LLP 0312 with a concrete crate-ownership migration that closes both
cross-crate privacy seams, then review it before re-dispatching F145/F272. A
solution is acceptable only if the two OPEN dependent binaries stop compiling
at their marked attack expressions and legitimate callback, strict-delivery,
signed-URL, and public-immutable flows still complete end to end.
