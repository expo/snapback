# Diary 0067: Browser local-first public witness

**Date:** 2026-08-06
**App:** `demos/browser-local-first`
**Scope:** PUBLIC-query IndexedDB resolution witness only

## What I built

I built a deliberately small React todo surface around one authority-independent
public live query, one `authUserId()` refusal probe, and two generated HostPlan
mutations. The real-browser harness owns a fixed Snapback port, a fixed Vite
origin, a durable SQLite file, and one explicit Chrome profile under literal
`/tmp`. It kills the entire first Chrome process group, reuses that exact
profile, and separates the process-relaunch proof from a later same-process SPA
reload.

The most useful shape is the event ledger in the page. It observes the exact
headless live-query handles beneath the React provider and the durable outbox,
so the acceptance can compare ordinals instead of sleeping: the retained query
must publish a fresh authoritative snapshot before the first replay diagnostic
or settlement transition. A shared canonicalizer turns absent optional fields
into explicit `null` at query ingress, and both the browser and independent Node
observer compare that one representation.

Compared with React plus Convex or Supabase, Snapback makes the retained/current
and outbox sequence contracts unusually inspectable, but producing a
browser-process receipt requires more lifecycle machinery than a conventional
component test. The fixed-origin relay and explicit profile are not incidental
test plumbing: they are the storage identity whose survival is under test.

## Ergonomics and surprises

The generated HostPlan mutations were straightforward and made queued replay
identity available without app-owned serialization. Declarative insert and
patch plans also kept the witness free of a separate handler bundle, leaving
the carrier lifecycle—not application execution—as the only complicated part.

The React hook correctly projects rows, freshness, connection, and retention,
but it intentionally omits the headless handle's version, answer class, resume
token, and pending-intents-at-seed fields. The witness therefore wraps the
client's `startLiveQuery` seam before provider construction and layers stable
canonical rows over `useSnapbackQuery`; it does not create a second product
subscription. That instrumentation is useful acceptance machinery, though a
first-party debug/receipt projection would make future carrier witnesses smaller.

The public-query and auth/lease boundary in the offline guide gave the right
claim posture. The existing browser/IndexedDB guide-gap ticket already owns the
missing system-Chrome proof, so I did not open a duplicate guide-gap issue.

## 2026-08-07 — retention refusal needs two server modes

The first real-server run exposed a mode boundary that the original witness
hid. Under dev custody, `ensureApp` installs no authorization-invalidation
protocol, so live subscriptions carry no `authorizationScope`. The
`authUserId()` query therefore truthfully reports
`SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE`: the server minted no resume token, and
the query never reaches the client's authorization-scoped
`SNAPBACK_RETENTION_NOT_RETAINABLE` branch. Treating that dev fact as the
protected-retention refusal made the original check wait forever for an
unreachable state.

`SNAPBACK_RETENTION_NOT_RETAINABLE` is sessions-mode-only on this arm. In
sessions mode every non-`authorityIndependent` subscription is auth-scoped,
including an `auth: 'public'` query such as `myTodos`; an anonymous-public
client offer is enough, with no login or lease custody. The corrected witness
therefore keeps retention plus offline queue/replay on dev custody, records
`NOT_RQS_ELIGIBLE` there as a supplementary control, then reuses the live
browser profile and Vite origin against a fresh anonymous sessions server for
the real `NOT_RETAINABLE` refusal. `todosByList` remains retainable in that
phase, which is the positive control that `authorityIndependent` admission is
still mode-correct.

The guide wording at `guide/sync/offline-and-retention.md:380-388` currently
reads as mode-independent: its `authUserId()` example says the query is
classified `SNAPBACK_RETENTION_NOT_RETAINABLE` without naming sessions-mode
admission. The real dev server instead reports `NOT_RQS_ELIGIBLE`. That prose
should distinguish the two modes; the orchestrator owns the guide correction,
so this demo change records the friction without editing the guide.

## Verification checkpoint

Codegen and repository-static checks run in the authoring lane. This sandbox is
not allowed to bind listeners or launch Chrome, so no product receipt is
invented here. The orchestrator must run the browser harness with its qualified
runtime and dynamic-loader environment; any failed LLP contract remains an
exact failed check in the retained receipt.

## 2026-08-07 — first green run, and the three defects the carrier was hiding

The witness went 8/8 PASS against the real runtime and system Chrome, but only
after finding and fixing three shipped-client defects that no Node suite could
see — which is the whole argument for the browser carrier as an evidence
class:

1. **`whenLockSettled()` resolved at lock release, not adjudication**
   (`rqs-store.mjs`). The Web Locks request promise settles when the
   callback's returned promise settles — for the granted writer that is close
   time. The LLP 0043 M2 outbox drain awaits `whenLockSettled()` first, so
   EVERY browser replay wedged forever; `replayQueuedMutations()` never
   resolved. Node fakes resolve `request()` at callback return and the drain
   suites run on the file/memory arms, so the wedge was invisible off-browser.
   Fixed by separating adjudication (writer grant, or an ordered
   `ifAvailable` probe observing another holder) from release.
2. **Warm online establishment never re-delivered rows after a persisted seed
   frame** (`index.mjs`). On reload-with-retained-entry, the seed frame
   reached `onUpdate`, then the subscribe response's authoritative snapshot
   was applied to the handle silently — frame-driven consumers (the React
   binding) kept rendering retained rows while the handle was already
   `current` (hook stuck `refreshing`; mixed projection: `retained` +
   `authoritative` + new version + old rows). The SIGKILL-relaunch realm boots
   offline and reconnects through the resubscribe path, which does emit a
   snapshot frame — so process-kill persistence passed while reload
   reconstruction failed. Exactly the "reload is a different claim" lesson.
3. **Anonymous-public custody omitted the authorization-invalidation offer on
   live paths** (`index.mjs`). The protocol was offered at `/connection/open`
   but not as the `x-snapback-auth-invalidation-protocol` header on
   `/live/*`, so an anonymous sessions caller could never subscribe ANY
   auth-scoped query (`SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`) — and
   the sessions-phase refusal leg could not even reach retention
   classification.

Two harness lessons worth keeping: a live relay answering
`SNAPBACK_DEV_PROXY_UNREACHABLE` is an ANSWER, not offline — LLP 0043's
transport-provenance classification refuses to queue on it, so the offline
window must make the page's fetch dispatch itself reject (both origins stopped
for the queue window; a page-level route abort of `/__snapback/*` for the
relaunch window while modules load from Vite, standing in for a production
service-worker shell). And the optional Full-profile store-runtime chunk must
be warmed while online, or the first offline mutate fails with a
chunk-load error instead of queueing — real bundled apps precache that chunk;
dev-served witnesses must warm it explicitly.

The sessions phase also needed a real sessions-mode backend variant
(`snapback-sessions/` with `{ auth: { mode: 'sessions' } }` in the schema —
the auth mode is a schema declaration, per file-drop), because startup
artifacts alone boot whatever mode the schema declares. The same `todosFeed`
declaration classifies `NOT_RQS_ELIGIBLE` under dev custody and
`NOT_RETAINABLE` under sessions — the mode boundary made concrete in one
query.

## 2026-08-10 — React queued resolution and provider-owned drain

The offline queue leg now dispatches through `invokeSnapbackMutation` instead
of reaching around React to `client.mutate`. That made the P3 contract directly
observable in the system-Chrome witness: each accepted intent resolves the
queued union with `presentation: 'withheld'`, and restoring transport emits
only an `online` lifecycle wake-up. No witness code calls `drainNow`,
`replay`, or `replayQueuedMutations`; the provider-owned controller establishes
the existing full-resync barrier and drains the four durable intents.

This reduced application policy compared with the earlier React-plus-manual-
outbox shape: the page owns neither retry cadence nor reconnect scheduling.
The main acceptance complexity remains in proving that automatic convenience
did not weaken the durable ordering rule, so the event ledger still requires
the authoritative current snapshot to precede replay and settlement. No new
guide gap surfaced in this change; the witness could reuse its existing
receipt schema and eight-check structure, although its source identity must be
re-minted by rerunning the qualified browser harness.

## 2026-08-16 — no-declaration default and an honest opaque refusal

The original protected probe, `todosFeed`, legitimately crossed into the
public-exact class when the owner derivation stopped treating
`authorityIndependent` as an application retention switch. The browser now
mounts that no-declaration query as its primary IndexedDB path, so the Chrome
SIGKILL/relaunch phase proves the new default through real codegen, the local
host, Vite, React, and the browser carrier.

The refusal leg moved to `protectedTodosFeed`, an anonymously callable inline
JavaScript handler over the same public table. Its opacity prevents an exact
single-table proof without making the query uncallable, so dev custody still
reports `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` and sessions custody reports
`SNAPBACK_RETENTION_NOT_RETAINABLE`; neither phase writes its IndexedDB key.
The sessions phase also compares the generated dev/sessions identities and
the owner-issued retained-entry generations, proving that the successor
generation replaces rather than relabels the predecessor.

This was more ergonomic than adding a synthetic “do not cache” option: the
positive and negative cases now follow semantic query shape. It also reinforced
that a real carrier witness is part of the feature surface, not an auxiliary
test—changing the default without migrating its matrix made the old witness
assert the opposite of the product contract.

Both backend variants regenerated successfully. This sandbox cannot bind the
loopback authority/Vite listeners, so the Chrome witness was updated and
syntax-checked but not executed here; its qualified 8-check receipt must be
re-minted in a browser-capable environment.
