# Party Wall 🎉

A photos wall for events, and the first demo built on the full Snapback
asset pipeline (LLP 0044). Guests join an event, post photos, and watch the
wall update live. Photos are GPS-stripped at upload, get a required
thumbnail and a ThumbHash placeholder, and are readable by exactly the
people who can see the wall — join grants, leave revokes, nothing in the
app code re-implements any of it.

## What it demonstrates

- **Upload intents** — `photoUpload` (strip, `private-strict`,
  via-references over the event membership), `coverUpload`
  (`public-immutable` event covers), `sharePhotoUpload` (`private-signed`
  bearer links; strict photos refuse issuance by design).
- **The canonical attach** — `createPost` runs `ctx.assets.attach`; the
  row, the reverse-reference edge, and the sharing grant commit atomically.
- **Direct typed live wall** — each `posts.photo` is a `v.assetRef` carried
  directly by the `eventWall` live-query result (the wire value is its opaque
  asset-id string), plus the React hooks
  (`useSnapbackAssetUpload` for optimistic capture, `SnapbackAssetImage`
  for preview → ThumbHash → best-width rendition).
- **Lifecycle honesty** — referenced deletes refuse; deleting the post
  clears the edge and the cascade completes; reference GC is enabled with
  a 61s grace (the runner reclaims unreferenced photos).
- **Seed fixtures** — four PNGs ship through the trusted finalization path
  and resolve `$assetFixture` placeholders into seeded rows.

## Run it

```sh
# 1. serve the app (sessions mode) on the demo port
cargo run -- --port 4433 --memory \
  --startup-artifacts <(node -e 'const s=require("./demos/party-wall/snapback/generated/schema.manifest.json"),f=require("./demos/party-wall/snapback/generated/functions.manifest.json");console.log(JSON.stringify({formatVersion:1,schema:s,functions:f}))')

# 2. the browser wall
cd demos/party-wall/surfaces/react
VITE_SNAPBACK_ADMIN_TOKEN=<the server's admin token> bun install && bun run dev
# sign in as ada@example.com; the demo reads the emailed code from the dev
# mailbox with the admin token — a trusted-local convenience only.

# 3. poke a seeded asset from the CLI
snapback assets list --state ready
snapback assets inspect <asset-id>   # lifecycle, receipts, quota, edges —
                                     # never staging keys or bearer URLs
```

## Acceptance

```sh
node demos/party-wall/tests/acceptance/headless.mjs    # required, 12 checks
node demos/party-wall/tests/acceptance/react-build.mjs # browser arm builds
```

The headless suite runs the whole story on a real sessions server (plus a
dev-mode sibling for the operator-lane seed fixtures). See
`demo.snapback.json` for the honest capability gaps this demo recorded —
and `diaries/0041-party-wall-asset-pipeline.diary.md` for the full build
experience, including the platform findings it surfaced.
