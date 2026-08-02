# Diary 0051 — Snapdrop: the smallest React file-upload app

**Demo:** `demos/file-drop`
**Agent:** Codex
**Date:** 2026-08-02

## What I built

Snapdrop is one screen: choose a JPEG or PNG, see upload progress, and watch
the finalized image appear in a live gallery. The backend is one table, one
upload intent, one live query, and one mutation. The mutation uses
`ctx.assets.attach`, and the photo row's public sharing declaration plus the
intent's `public-immutable` delivery profile make the final rendition usable
by an ordinary `<img>`.

The retained acceptance run used a real PNG and proved four boundaries against
the running server: the task reached `ready`, the typed attachment committed,
the live query delivered the new row, and the public `display` rendition
returned `200 image/*` with non-empty bytes.

## What felt good

Once authority and routing were settled, the actual Snapback model was small
and coherent. `defineAssetUpload` held the byte limit, media types, GPS-strip
policy, required display rendition, delivery profile, and authorizer in one
place. `ctx.assets.attach` was one line, while still giving the row an atomic
reverse-reference edge. The upload hook supplied stable progress and a single
`task.done` terminal. The live gallery needed no application-owned readiness
table or polling.

Trusted image finalization was especially pleasant: the app wrote no EXIF
scrubber, content sniffer, hash verifier, thumbnail worker, or retry state.
Those facts came with the asset capability instead of becoming demo code.

## What felt hard

The guide-led minimal path was not runnable in a React browser without three
workarounds, recorded in
`issues/20260802-guide-gap-react-asset-vite-path.md`:

1. The first-party Vite relay refused every `/assets/*` route, despite being
   the documented browser path. Snapdrop added a local `/__snapdrop` Vite
   proxy while retaining the first-party plugin for lifecycle and generated
   artifact resolution.
2. Dev-mode asset HTTP is intentionally anonymous today; even a task carrying
   `userId` fails an authenticated intent. Snapdrop moved to sessions and added
   a trusted-local Vite mailbox helper. The helper reads the admin and
   impersonation capabilities server-side; neither enters the browser bundle.
3. Runtime codegen emitted `api.photoUpload`, but `api.d.ts` omitted it from
   `GeneratedApi`. The React code needed a narrow local type bridge before the
   upload hook would typecheck.

There was also a source-consumer packaging papercut: local `file:` packages
needed explicit overrides for their internal workspace dependencies, and the
codegen package's ignored `runtime-artifacts` snapshot had to be refreshed
before the installed copy contained the current ID-registry schema. Existing
repository demos already encode the override pattern, but the simple template
does not teach the source-checkout version of it.

## Compared honestly

Compared with Convex, Snapback's post-setup upload task is nicer than the usual
generate-upload-URL → POST → storage-ID choreography, and the typed attachment
plus declared delivery policy is much stronger than treating a storage ID as a
plain string. Convex would currently win the first fifteen minutes, though: its
React/Vite client path already reaches storage and its generated types include
the upload call without an app-owned proxy.

Compared with Supabase, Snapback kept schema, mutation authority, realtime,
image processing, and delivery policy in one model. Supabase's storage client
would be faster to start but would introduce a separate bucket/policy surface
and application-side coordination between the object and database row.

## Verdict

The asset pipeline itself is excellent and the final app is genuinely small.
The missing piece is the paved browser doorway: relay routes, session guidance,
and generated upload types need to agree with the strength of the backend.
Closing that three-part gap would turn this build from a debugging exercise
into the compelling five-minute demo the current API is already capable of.

## 2026-08-02 — the doorway is paved (Claude)

All three workarounds are gone; the demo now runs the guide-led path as
written and its acceptance rides the stock relay:

1. `@expo/snapback-vite`'s allowlist forwards the complete author-facing
   `/assets/*` AppData family (attempts, TUS, records, strict/signed/public
   delivery) and still refuses `/_snapback/*`. Snapdrop's `/__snapdrop`
   proxy and the private relay prefix are deleted — everything is
   `/__snapback` relative URLs, including the gallery `<img src>`.
2. Codegen now emits explicit and derived upload references as typed
   `AssetUploadReference` members of `GeneratedApi` (and types the
   `defaults.<table>.<field>` subtree), so `api.photoUpload` feeds
   `useSnapbackAssetUpload` directly — the local type bridge is deleted and
   `tsc --noEmit` stays clean.
3. The Assets guide gained a "Browser apps" section that states the two
   authority facts we had to discover the hard way: dev-mode asset HTTP is
   deliberately anonymous (a task `userId` does not authenticate an
   authenticated intent — sessions custody is the browser path, `--user` is
   the CLI/host-op lane), and the sessions sign-in code arrives through the
   trusted-local mailbox seam with both admin carriers held server-side.
   The mailbox Vite middleware stays, now as the documented pattern rather
   than a workaround.

The retained acceptance moved to
`tests/acceptance/browser-relay.mjs` — self-contained (kit server +
programmatic Vite on ephemeral ports) and wired into
`scripts/verify-local-proof`, so the browser path is CI-verified: relay
health, the system-route refusal, mailbox sign-in, typed upload to `ready`,
typed attachment, the live gallery over the relayed WebSocket, and public
rendition delivery through the relay (7/7).

With the fixes in, the first fifteen minutes match what the backend
deserved all along: the whole app is the schema field, the intent, one
attach mutation, the typed hook, and relative URLs — no proxy, no cast, no
undocumented authority cliff. Ticket
`issues/20260802-guide-gap-react-asset-vite-path.md` is closed with this
entry.
