# Warble

A small local-first microblog on Snapback, running on Expo (iOS, Android, web)
from one codebase.

The point of the demo is the offline behavior, not the feature list. With the
backend stopped, a relaunched client still renders the timeline **and** the
viewer's like set from disk, composing and liking still work, and everything
replays in order — exactly once — on reconnect.

## Run it

Two processes. Backend first:

```sh
node demos/warble/scripts/dev-server.mjs          # add --reset to wipe the db
```

It prints the loopback origin to use. Then the app:

```sh
cd demos/warble/app
EXPO_PUBLIC_SNAPBACK_ORIGIN=http://127.0.0.1:4420 bun run start
```

Press `w` for web or use an admitted simulator/emulator carrier.

Delivering Warble to a **physical iOS device** over the LAN is an **unsupported
workaround.** Snapback has no accepted iOS physical-device development carrier.
If you deliberately accept that limitation, set `WARBLE_HOST=0.0.0.0`; the
launcher prints the LAN origin and warns that dev auth lets anyone on the
network assert any identity. The simulator, Android USB, and hosted release
targets are the supported paths. The open carrier decision remains in
[`issues/20260811-ios-physical-device-dev-carrier-decision-packet.md`](../../issues/20260811-ios-physical-device-dev-carrier-decision-packet.md).

## Trying the offline path

**Keep the app open for this.** With the app already running:

1. Let the timeline load (connection dot goes `live`).
2. Stop the backend (Ctrl-C).
3. The connection fact drops to `stale` and the rows you already have stay on
   screen — they are never relabeled live.
4. Post something and like a post. Both queue — the banner shows the pending
   count. The queued post deliberately does **not** appear in the timeline:
   this arm runs no local execution, so fabricating the row would be a lie.
5. Restart the backend, then press **Send now**. The queue drains in order, the
   post appears, and the like count moves exactly once.

### What does not work yet: reloading while offline

Reloading the app with the backend down shows a boot error, **not** the
retained timeline — even though the rows are sitting in IndexedDB. The React
binding receipt that would let `prepareReactBinding` admit an offline boot is
never committed on the browser arm. Confirmed and filed with a repro in
[`issues/20260804-guide-gap-react-expo-offline-cold-boot.md`](../../issues/20260804-guide-gap-react-expo-offline-cold-boot.md).

The retention machinery itself is fine — the acceptance suite below proves a
*fresh headless client* renders both queries from disk with the server stopped.
It is the React boot seam that drops it.

## How it is built

`snapback/schema.mjs`, `snapback/functions.mjs`, `snapback/seed.json` are the
whole backend. Two constraints shaped all of it:

- **Retention is opt-in per query.** A live query cold-retains only if the
  server can derive `rqsEligible`: `auth: 'public'`, `authorityIndependent:
  true`, and a single-table plan whose filters read no authority or ambient
  input. That last clause is why the viewer's like set is keyed by an
  **argument** (`arg('handle')`) rather than `authUserId()` — argument-keyed
  viewer scoping retains, authority-keyed does not. It is also why author names
  are denormalized onto every post: a joined query cannot be single-table, and
  therefore cannot retain.

- **Only declarative mutations replay.** Plan presence is the replayability
  predicate, so every write is an IR plan rather than a JS handler — including
  the like, which needs a read, an insert, and a counter patch in one commit.

The security boundary that buys: argument-keyed viewer scoping is **not**
server-enforced. It is right for public facts like likes and wrong for private
data, which needs the lease-backed retention path instead.

Auth is `dev` mode (client-asserted identity) with a persona switcher. The
server binds loopback by default. The unsupported LAN workaround requires
`WARBLE_HOST=0.0.0.0`; the launcher keeps the explicit `SNAPBACK_PROFILE=dev`
pin and `--allow-insecure-dev-auth` override because both are required for that
non-loopback bind. None of those demo conveniences is a production posture.

## Proof

```sh
SNAPBACK_SERVER_BINARY=$PWD/target/debug/snapback \
  node demos/warble/tests/acceptance/offline-local-first.mjs
```

Six checks: both queries retainable with resume tokens, retained render with
the server down, durable ordered queueing, pre-intent retained frames while
writes are pending, and exactly-once ordered replay with a correct like count.

Build notes and platform friction are in
[`diaries/0056-warble-local-first-microblog.diary.md`](../../diaries/0056-warble-local-first-microblog.diary.md).
