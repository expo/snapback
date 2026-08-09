# Shindig 🎈

A Partiful-style events app on Snapback: throw a party, invite people, RSVP
from the card, and watch the guest list and event wall update live. The
interesting part is the authorization shape — events are membership-rooted
resources (LLP 0056), and the demo keeps the roster and the rendered RSVP
state honestly separate.

## What it demonstrates

- **Resource-scoped membership as product structure.** `createEvent` uses the
  declaration's atomic `bootstrap()` to mint the event and seat the host;
  the guest list, wall, and event detail are gated by `memberOf()` /
  `requireRole()` — the host-owned boundary, not handler convention.
- **Roster privacy as a design constraint.** v1 membership tables are private
  (no reads, no existence oracle), so everything the UI shows is a
  denormalized `invites` row: the feed card, the statuses, the guest list.
  RSVP'ing seats the guest via the single declared `by: ['none']` self-insert
  transition — see the diary for why the "pending invite → accept" role
  transition is not spellable in v1.
- **Partiful-honest locking.** Until you respond, the event page is a locked
  card: the server's invariant `SNAPBACK_AUTH_PERMISSION_DENIED` renders as
  product state, and gated live queries deliver nothing to non-members.
- **The hand-wired React arm.** Live queries bound per the React-arm guide:
  one connection per hook, snapshot applied from the handle, honest
  connection axis in the header, StrictMode-safe disposal.

## Run it

```sh
node packages/snapback-codegen/index.mjs demos/shindig/snapback   # after editing the backend
node demos/shindig/tests/acceptance/headless.mjs                  # required surface
node demos/shindig/tests/acceptance/react-browser.mjs             # React browser integration
node demos/shindig/tests/acceptance/contract-browser.mjs          # Contract browser integration
```

Interactive (one server feeds both arms):

```sh
cargo run -- start --port 4431 --memory                            # terminal 1
cd demos/shindig/surfaces/react && bun install && bun run dev      # terminal 2 → :5187
cd demos/shindig/surfaces/contract && bun install && bun run dev   # terminal 3 → :5188
```

Open `http://127.0.0.1:5187/?user=ada` (React) or
`http://127.0.0.1:5188/?user=ada` (Contract), throw a party, then open a
second window as `?user=grace` and invite her. The React arm switches
personas in-app; the Contract arm selects persona and event via URL because
the multi-live surface binds each live query's args once, at boot. This demo
runs `auth: dev`; the rbac demo is the sessions-mode membership proof.

## The two arms, compared

Same backend, same testIds, same product claims. The React arm hand-wires
`client.liveQuery` into hooks (~90 lines of glue, per-render control); the
Contract arm declares bindings in `.contract` files over the generated
binding modules and gets optimistic overlays, observability lints, and the
agent surface for free — but live-query scope is fixed at boot, so screen
changes are navigations. Diary 0015 records the full comparison.
