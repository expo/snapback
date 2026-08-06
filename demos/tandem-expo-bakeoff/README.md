# Tandem: Expo messaging backend bakeoff

Tandem is the same Expo Router messaging product implemented against two
backends. The `shared/` directory owns all product UI; `snapback/` and
`convex/` contain independent backend schemas, functions, client adapters,
seed data, and acceptance proofs.

The app includes:

- two direct-message conversations and one four-person group;
- live text and image messages;
- WhatsApp-style reply pointers without threaded conversations;
- long-press emoji reactions; and
- live, conversation-scoped typing indicators.

The seed viewer is Ada. This is a product-surface bakeoff, not a production
authentication example: both arms accept the seeded identity supplied by the
client, while the Snapback image path additionally uses a real authenticated
session because typed asset ownership requires one.

Use the four identity buttons at the top of the inbox to message as Ada, Mina,
Ravi, or Noor. Pick different people on two clients, open the same conversation,
and type to exercise the live typing indicator.

## Run the Snapback arm

From the repository root, bootstrap the vendored runtime once:

```sh
scripts/bootstrap-ibex-runtime
```

Then use three terminals:

```sh
(cd demos/tandem-expo-bakeoff && bun install)
(cd demos/tandem-expo-bakeoff/snapback && bun install && bun run generate)
(cd demos/tandem-expo-bakeoff/snapback && bun run backend)
(cd demos/tandem-expo-bakeoff/snapback && bun run start)
```

`bun run backend` installs the versioned seed, starts Snapback on port 4477,
starts a trusted-local session broker on 4478, and writes ignored Expo config
to `.env.local`. Do not expose that development broker as a production auth
service.

## Run the Convex arm

Use an anonymous local Convex deployment or link your own deployment:

```sh
(cd demos/tandem-expo-bakeoff && bun install)
(cd demos/tandem-expo-bakeoff/convex && bun install)
(cd demos/tandem-expo-bakeoff/convex && npx convex dev)
(cd demos/tandem-expo-bakeoff/convex && npx convex run seed:seed)
(cd demos/tandem-expo-bakeoff/convex && bun run start)
```

Keep `convex dev` running. `convex dev --once` deploys the functions but stops
the anonymous local backend when the command exits.

## Verify

```sh
(cd demos/tandem-expo-bakeoff/snapback && bun run typecheck && bun run test)
(cd demos/tandem-expo-bakeoff/convex && bun run typecheck && bun run test)
```

Each acceptance suite runs the same eight product checks: seed shape; image,
reply, and reaction projection; DM/group/reply sends; a second-client live
delivery; reaction toggling; real image upload and delivery; typing expiry;
and refusal of invalid membership/cross-conversation replies.

## iOS development clients

`snapback/native-shell` and `convex/native-shell` are small EAS carrier inputs
with the exact native dependencies and configuration used by their parent
apps. They omit the monorepo and product JavaScript; the installed development
clients load the real app from the corresponding Metro server.

EAS resolves this checkout's Git root even when invoked from a nested app, so
use the staging helper to avoid uploading the whole Rust/JavaScript monorepo:

```sh
demos/tandem-expo-bakeoff/scripts/build-ios-dev-client snapback
demos/tandem-expo-bakeoff/scripts/build-ios-dev-client convex
```

The build is ad hoc and works only on devices registered to the selected Apple
Developer team.

### Current iOS handoff (2026-08-05)

- [Install the Snapback development client](https://expo.dev/accounts/ccheever/projects/tandem-snapback/builds/8cc22eca-a64d-427a-b7c8-99cd9ef51c6c), then open
  `tandem-snapback://expo-development-client/?url=https%3A%2F%2Ftandem-snapback.tuft.host`.
- [Install the Convex development client](https://expo.dev/accounts/ccheever/projects/tandem-convex/builds/763dd305-ad53-4350-8979-6dc1b007b829), then open
  `tandem-convex://expo-development-client/?url=https%3A%2F%2Ftandem-convex.tuft.host`.

Those Metro/backend URLs are served by the current development machine, not a
production deployment. They work only while its launch agents, local backends,
and Tuft host bindings remain online.
