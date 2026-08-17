# Public live-subscription regression report

**Date:** 2026-08-17
**Requested commit:** `fix(client): accept live subscriptions under the v1 invalidation protocol`

## Outcome

Fixed the real React starter regression. A default-advertising application
client can now establish a public/anonymous generated live query from either a
fresh snapshot or a rowless `current_as_of` answer. The React provider retains
one accepted handle, projects `Connection: live`, and does not enter its
subscribe retry ladder.

Auth-scoped v1 behavior is unchanged: query namespaces, authorization scopes,
invalidation fences, quarantine/delete handling, durable custody, and ACK
ordering still operate on the original authority-marked rows.

## Root cause

The default v1 client uses an `AuthCoordinator`, so successful responses carry
an internal authority capture. `liveQuery()` intentionally attaches that
capture to its row array and each row as a non-enumerable symbol. Generated
single-table queries also open the ordinary optimistic-presentation view, even
when no mutation is currently pending.

The optimistic rebase boundary was given those transport-private row objects
directly. `CanonicalClientValueV1` correctly rejected the symbol at
`$.todos` with `SNAPBACK_REACT_ARGS_INVALID`. This happened after the server
had already accepted the subscription and after query rows could be projected,
so React observed a rejected `handle.started()`, removed the handle, and
scheduled its 250 ms -> 10 s subscribe retry ladder. Each later
`current_as_of` consequently named a handle React had already abandoned. The
leaf query could transiently say `live`, while the aggregate connection stayed
`idle` with zero accepted subscriptions—the exact captured symptom.

The fix preserves authority metadata on the live handle and passes shallow
enumerable row projections into the optimistic engine at initial-view and
rebase boundaries. The private capture symbol is therefore still available to
the v1 publication fence but is no longer misclassified as application data.

## Regression coverage

`packages/snapback-react/cold-boot-binding.test.mjs` now exercises the full
shape that was missing:

- a real `SnapbackClient` with the library-default invalidation protocol;
- an anonymous authority handshake and an authority-independent public query;
- a generated single-table composition, engaging ordinary optimistic
  presentation;
- retained rows followed by a rowless subscribe response and a WebSocket
  `current_as_of` frame;
- the real React provider registry and connection aggregate; and
- assertions for `live`, exactly one active handle, one subscribe POST, and
  inherited v1 open/header advertisement.

## VERIFY (verbatim)

### Regression test: red before / green after

Test-only change, before the implementation fix:

```text
$ node packages/snapback-react/cold-boot-binding.test.mjs
AssertionError [ERR_ASSERTION]: the accepted handle enters the provider connection aggregate
actual:   { status: 'idle', diagnostic: null, activeSubscriptions: 0 }
expected: { status: 'live', diagnostic: null, activeSubscriptions: 1 }
```

After the implementation fix:

```text
$ node packages/snapback-react/cold-boot-binding.test.mjs
snapback-react cold-boot binding tests: ok
```

The packed-starter diagnostic also reproduced repeated rejected starts with:

```text
SNAPBACK_REACT_ARGS_INVALID: React query arguments are not a CanonicalClientValueV1: symbol object key
details: { reason: 'symbol object key', path: '$.todos' }
```

### Requested client checks

```text
$ SNAPBACK_CLIENT_RQS_DIR=/private/tmp/snapback-rel0124-client-package-rqs node packages/snapback-client/package.test.mjs
package.test.mjs: packaged client exports are consumable
PASS

$ node packages/snapback-client/authorization-invalidation.test.mjs
tests 7; pass 7; fail 0
PASS

$ node packages/snapback-client/subscribe-retry.test.mjs
tests 3; pass 3; fail 0
PASS
```

The first `package.test.mjs` invocation without the override was blocked by the
managed filesystem when the default store tried to create
`/Users/ccheever/.snapback/rqs/...lock` (`EPERM`). The rerun above uses the
client's supported store-directory setting and passed. No product assertion
failed in the blocked invocation.

### React full suite

```text
$ cd packages/snapback-react
$ SNAPBACK_CLIENT_RQS_DIR=/private/tmp/snapback-rel0124-react-suite-rqs npm test
exit 0
PASS
```

This ran the package pretest, every JavaScript test—including
`authorization-denial`, `auth-blocked-resource`, `subscribe-retry`, the new
`cold-boot-binding` case, lifecycle/HMR/assets/offline coverage—and the strict
TypeScript fixture check.

### Syntax and reference checks

```text
$ node --check packages/snapback-client/index.mjs
PASS
$ node --check packages/snapback-react/cold-boot-binding.test.mjs
PASS
$ git diff --check
PASS
$ ./ref-check --verbose
ref-check: ok — 275 LLP docs, 6527 refs in 11622 files, 0 errors, 0 unchecked
PASS
```
