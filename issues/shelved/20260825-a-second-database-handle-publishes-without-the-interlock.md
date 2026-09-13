# A second database handle publishes authorization without the interlock

- Status: open
- Created: 2026-08-25
- Area: kernel authorization interlock (LLP 0053, LLP 0303)
- Found by: the adversarial review of the `unowned` lane's round 1, as findings 3–5

## Summary

The authorization interlock is a property of the **handle**, not of the **resource**. A
`LocalDatabase` opened separately starts in `AuthorizationInterlockState::Disabled`; in that state
reservation is optional and participant preparation returns `None`, after which SQLite commits
normally (`crates/snapback-kernel/src/storage.rs:1078`, `:1557`). A second handle opened against the
same database therefore advances the authorization epoch and publishes a migration **with no
participant bind at all** — bypassing the interlock that the first handle enforces correctly.

This is the resource-versus-handle shape named in LLP 0303 §"handle vs resource" (`llp/0303-...:357`).
It is not a defect in the `unowned` lane's change; the reviewer found it while enumerating that
change's siblings, and it sits underneath every interlock claim made so far.

## Unguarded public writers found in the same census

LLP 0053's four-event predicate is at `llp/0053-authorization-invalidation.rfc.md:448`. These public
routes reach durable authorization-scoped state without the interlock:

| Surface | Cell | What it does |
| --- | --- | --- |
| `commit_function_generation` | default | Publishes projection/transcript catalogs and the durable function-generation record, then a plain `tx.commit()` — no authorization event, no participant bind (`storage/generation_commit.rs:175`, `:246`) |
| Auth scope-basis reconciliation | default | Public methods commit active authorization metadata through a plain auth transaction, though the core documents that the caller must own the event-2 hook (`storage/auth_scope_bases.rs:54`, `:115`) |
| Auth-collision rescue | default | Public `ServingDatabase` forwarding rewrites the stored active manifest and process schema with no hook and no retirement; its "offline recovery" posture is not enforced on that route (`storage/auth_rescue.rs:190`, `:221`) |
| Guest reap / guest claim | default | The previously recorded direct epoch writers remain outside the interlock |
| Graph-corpus stream installation | `test-support` | Caller supplies incarnation and epoch; plain transaction, no interlock (`storage/auth_stream.rs:27`) |
| Push-registry / schema fixtures | `test-support` | `activate_push_registry_for_test` and `install_immediate_sender_for_test` write durable state and replace active schema with no authorization event (`storage/push_registry.rs:22`, `:1280`) |
| Frozen auth catalogs, collision-manifest fixture | `test-support` | Public dependent-reachable active auth/schema metadata writers commit without the interlock |

Cells covered by the census: kernel default and `test-support`; engine default,
`--no-default-features` and `test-support`; server default, `--no-default-features` and
`test-support`. Unit-only `cfg(test)` seams were distinguished from additive dependent-reachable
`test-support` — the `test-support` rows above are the latter, so LLP 0303 (o) applies to them and
they are not dismissible as test-only.

## The epoch ceiling is absorbing (LLP 0303 (r))

Migration's epoch increment is correctly derived from the durable predecessor inside the transaction
and bounded by `MAX_AUTHORIZATION_EPOCH` (`storage/auth_stream.rs:383`). But additive `test-support`
exposes a **caller-supplied** epoch writer, including the maximum. At the maximum, migration,
rollback, and ordinary activation publication are permanently impossible within that incarnation.
Recovery is destructive incarnation rotation — reset, logical import, or declared restore — not a
restart and not an ordinary publication. Nothing partial commits on exhaustion, so this is an
availability defect rather than an integrity one, but it is caller-composable monotone-state
poisoning and any new coupling to the epoch inherits it.

## Why this is filed rather than fixed in place

The `unowned` lane was re-dispatched narrowed to the two defects that were genuinely its own (an
error path that reopens authorization, and a fence released before retirement) with these findings
explicitly out of scope. Fixing the handle-versus-resource shape means moving the interlock onto the
resource, which is a design change, not a patch — see LLP 0303's DERIVE-over-VERIFY ruling.

## Next

1. Decide whether the interlock becomes a resource property (durable, checked at open) or whether
   `Disabled` becomes unreachable for any handle that can publish.
2. Burn down the default-cell writers above; each is its own row.
3. Fold the `test-support` writers into the shared test-support surface lane, which already owns
   F170 and F053 (`issues/shelved/20260825-test-support-accessors-now-block-named-rows.md`).

Related: `issues/shelved/20260825-llp-0291-r14-r16-is-the-root-under-everything.md`,
`issues/shelved/20260825-the-privilege-ratchet-cannot-measure-this-defect-class.md`.
