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
