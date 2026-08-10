# Snapdrop

A deliberately small React + Vite app that exercises Snapback's local asset
pipeline: authenticated image upload, TUS transfer, trusted image finalization,
typed attachment, a live gallery query, and public immutable delivery.

## Run

From this directory:

```sh
bun install
bun run dev
```

The one `dev` command owns code generation, the local Snapback server, app
loading, Vite, and both source watchers. Open the URL Vite prints, choose a
JPEG or PNG up to 10 MB, and the photo will appear in the live gallery.

This is a local-dev demo. It signs into a real Snapback session through the
trusted-local dev mailbox (the admin token stays server-side in Vite), then
publishes the declared `display` rendition through the `public-immutable`
delivery profile so an ordinary browser `<img>` can render it.

Everything rides the stock `@expo/snapback-vite` relay at `/__snapback`: the
relay forwards the author-facing `/assets/*` route family (and keeps refusing
`/_snapback/*` system routes), and the generated upload reference is used
exactly as typed — `api.photoUpload` with `useSnapbackAssetUpload`, no cast
and no app-owned proxy.

## Acceptance

```sh
bun run test
```

`tests/acceptance/browser-relay.mjs` is self-contained (CI runs it from
`scripts/verify-local-proof`): it boots a sessions-mode Snapback server and a
real Vite dev server on ephemeral ports, then proves relay health, the
system-route refusal, mailbox sessions sign-in, typed upload to `ready`,
typed attachment, the live gallery update over the relayed WebSocket, and
public rendition delivery through the relay.

Not claiming: private/per-user sharing, non-image uploads, or hosted asset
storage. This is a local pipeline witness.
