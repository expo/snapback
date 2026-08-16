# Media Happy Post

Media Happy Post is a deliberately small Expo SDK 57 acceptance vehicle for
the LLP 0239 R3/R4 device path. It exercises the generated media surface rather
than hand-assembling asset IDs: a profile avatar is a `v.media()` field consumed
through `useSnapbackMedia`, and every post owns an ordered zero-to-four item
`assetCollection` consumed through `useSnapbackMediaCollection`. The generated
`createPost` command owns image/video uploads, one application mutation, and the
collection append. A post may contain text and no media.

The two named personas are a test-only sign-in seam, not production auth. The
launcher creates their password-session accounts and owner-scoped profiles in
the local database. Sessions are intentional: app-side asset uploads cannot be
authorized through Snapback's anonymous dev-asset lane.

## Prepare and verify

From the Snapback repository root:

```sh
scripts/bootstrap-ibex-runtime
node scripts/install-local-snapback-packages.mjs demos/media-happy-post
bun run --cwd demos/media-happy-post generate
bun run --cwd demos/media-happy-post smoke
bun run --cwd demos/media-happy-post typecheck
```

These commands build the local runtime prerequisite, install a self-contained
local package closure, regenerate the app descriptor/API, smoke-load the
projected commands and collection operations, and typecheck the Expo source.

## Run the operator-owned device path

In one terminal:

```sh
cd demos/media-happy-post
node scripts/dev-server.mjs --reset
```

The equivalent repository-root command used by the demo catalog is
`node demos/media-happy-post/scripts/dev-server.mjs --reset`.

The launcher binds loopback on port 4431, provisions the empty application seed
plus the Ada Lovelace and Grace Hopper test accounts, and prints the exact next
command:

```sh
EXPO_PUBLIC_SNAPBACK_ORIGIN=http://127.0.0.1:4431 bun run start
```

Start Expo with that printed origin and open the app in Expo Go. Choose a
persona, tap the avatar to pick one image, then create a text-only post and a
post with up to four selected images/videos. The composer exposes the media
task phase and per-item progress. Feed video children remain labeled delivery
tiles; this demo does not claim a player or playback.

Omit `--reset` on later runs to keep local posts and accounts.

## Unsupported LAN carrier

Delivering Media Happy Post to a **physical iOS device** over the LAN is an
**unsupported workaround.** Snapback has no accepted iOS physical-device
development carrier. If you deliberately accept that limitation, set
`MEDIA_POST_BIND_HOST=0.0.0.0`; the launcher prints the LAN origin and the
standard insecure-dev-auth warning. This demo still authenticates its actual
media requests with test password sessions, but the server is plain HTTP on a
network interface and is not a production deployment. The simulator, Android
USB, and hosted release targets are the supported paths. The open carrier
decision remains in
[`issues/20260811-ios-physical-device-dev-carrier-decision-packet.md`](../../issues/20260811-ios-physical-device-dev-carrier-decision-packet.md).

This phase creates and verifies source only. It does not launch Metro, a
simulator, or a device, and it does not produce a physical-device receipt.

## Boundaries

- Owner-principal visibility means Ada and Grace do not share profiles or
  posts.
- A denied or unavailable collection child degrades in its own tile without
  blanking siblings.
- Video kind admission and delivery are shown; playback is not claimed.
- Hosted deployment and production authentication are not claimed.

The governing design is [LLP 0239](../../llp/0239-asset-collections-and-media-field.rfc.md),
with typed finalized media projection in
[LLP 0244](../../llp/0244-media-ref-projection.spec.md).
