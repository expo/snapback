# A1 Expo sweep: replaceBearerToken downgrade rotation throws AggregateError and permanently wedges live handles (rotate-back never re-subscribes; carrier-agnostic)

**Opened:** 2026-08-01
**Systems:** Auth, Client integration, Realtime
**Related:** LLP 0137 (Track B A1 Expo iOS arm), guide/auth/native-apps.md, demos/improvement-sweep/arms/a1-snapback-expo-ios/findings/0137-a1expo-f4-downgrade-rotation-wedges-live-handles.json

Rotating an external-bearer client to a lesser-privileged principal:

1. rejects with `AggregateError: external bearer custody transition completed
   with lifecycle failures` whose inner error is the EXPECTED
   `SNAPBACK_AUTH_PERMISSION_DENIED` — callers must string-match to learn the
   transition completed;
2. blanks predecessor rows (correct) but never surfaces the successor's
   denial on the query/hook — on-device the records query presents
   `refreshing`/`ready` with zero rows and no error while the provider
   connection drops to `disconnected`; and
3. rotating BACK resolves clean but never re-subscribes attached handles:
   Expo/React provider — whole connection `disconnected`, every query blank
   until process restart; node control — protected handle `disconnected`/0,
   public handle `live`-labeled WITH ZERO ROWS.

The documented contract ("retires old grants and transports, and only then
fresh-subscribes under the successor") does not hold on either carrier. Found
by this arm because the web arm never exercised in-place rotation.

Fix shape: transitions that complete must settle (successor denials become
handle/hook lifecycle facts), and successor fresh-subscribe must re-establish
transports for surviving handles; a→b→a conformance test over live protected
+ public queries on node and an RN-shaped carrier.

Witness: rotate alice→mallory→alice on a live provider: transition resolves,
denial renderable in between, alice's rows re-render live afterwards.

## Resolution (2026-08-01)

RESOLVED — carrier-agnostic fix in `packages/snapback-client/index.mjs` +
`packages/snapback-react/index.mjs`, reproduced node-only first (fake-fetch
harness with connection-token-bound authority; all three symptoms matched the
arm witness exactly).

Root causes:

1. **Transition rejects although it completed** — `replaceBearerToken`
   collected EVERY resume rejection into the AggregateError, including the
   successor's expected server-answered `SNAPBACK_AUTH_PERMISSION_DENIED`.
   Fix: answered authorization denials (401/403 + `SNAPBACK_AUTH_*`
   diagnostic, custody-terminal codes excluded) are the successor's completed
   outcome — the transition settles. Transport loss/broken callbacks still
   reject loudly.
2. **Denial never surfaced** — the denied resume left the handle paused /
   'disconnected' with blank rows and no fact. Fix: `handle.resume`'s failure
   path records a frozen `handle.authorizationDenial = {code, message, atMs}`
   fact, delivers an `authorization_denied` update to `onUpdate`, and emits an
   `authorization-denied` subscription event; the React provider projects it
   as the `error` query state, and error snapshots now survive ordinary
   connection movement (pre-fix the trailing 'disconnected' event wiped them
   back to pending). Cleared by the next successful fresh subscribe and by
   the custody blank barrier.
3. **Rotate-back never re-subscribes** — the resume set was "handles not
   paused when THIS transition started", sampled before pause; a handle a
   previous transition left paused (denied successor, or a null-token logout)
   was permanently excluded from every later transition's resume set. Fix:
   transition-paused handles are parked (`__externalBearerParkedHandles`
   WeakSet) until a successor fresh-subscribe succeeds; parked handles are
   transition-owned and re-enter with the next transition. App-paused handles
   stay app-owned (never parked/resumed by transitions).

The differentiator is preserved: predecessor rows blank BEFORE the successor
subscribe reaches the server (asserted at request time in the regression),
and denials stay the server's uniform non-disclosing refusal.

Regression tests (proven-to-fail pre-fix):
`packages/snapback-client/bearer-rotation.test.mjs` (settle + denial fact +
a→b→a re-subscribe + logout/login revival + app-pause preservation +
transport-loss still-loud), `packages/snapback-react/authorization-denial.test.mjs`
(error-axis projection + survival across connection movement + clear on
restored authority). Docs: guide/auth/native-apps.md, guide/clients/headless.md,
LLP 0114 dated amendment (authorization-denial projection).

Witness satisfied: rotate alice→mallory→alice over live queries — transition
resolves, denial renderable in between (handle fact + hook error state),
alice's rows re-render live afterwards with no process restart.

---

**2026-08-01 (A4 Expo arm re-verification, pinned pre-fix packages):** the
second Track B arm (A4 events) ran against the published 0.1.7 closure,
which predates this fix lane, and reproduced the pre-fix behavior
unchanged on-device: rotating the on-device host to a seatless outsider
rejected with the lifecycle-failures AggregateError (custody completed,
predecessor rows blanked, successor denial never on the hook — query left
`refreshing`), and rotate-back never re-subscribed (connection wedged
`disconnected`, queries presenting ready/0 rows until process exit; logout
and retirement legs clean). Recorded here after the resolution for the
longitudinal ledger — it confirms the defect on the publication this fix
has not yet reached, not a regression of the fix. Evidence:
demos/improvement-sweep/arms/a4-snapback-expo-ios/evidence/scenario-evidence.json (EXPO-10).
