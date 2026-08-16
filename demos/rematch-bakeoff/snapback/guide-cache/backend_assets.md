---
title: Assets
id: backend.assets
order: 9
audience: agent-first
capabilities: [backend.assets]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0044-asset-storage-pipeline.rfc.md, llp/0064-native-client-surfaces.rfc.md, llp/0096-auth-profiles-for-protocol-clients.spec.md, llp/0176-expo-messaging-golden-path.plan.md, src/assets.rs, src/assets_cut.rs, src/cli.rs, src/local.rs, src/server.rs, packages/snapback-codegen/define.mjs, packages/snapback-react/index.d.mts, packages/snapback-vite/allowlist.mjs, tests/acceptance/asset-lifecycle-v1-evidence.md]
examples: [demos/party-wall, demos/file-drop, demos/tandem-expo-bakeoff]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-05
reviewed-commit: f3c7d9fbb394a413370a9264f22e72b6f151a25e
---

# Assets

> **Local target only.** `asset_lifecycle_v1`, the image pipeline
> (`asset_image_pipeline_v1` — GPS stripping, declared renditions,
> ThumbHash placeholders, dominant color), and video location
> finalization (`asset_video_finalization_v1` — MP4/QuickTime location
> atoms blanked in place, no transcoding) all ship on the local target
> with the filesystem store, TUS resumable transfer, and
> `private-strict` delivery. Location-bearing media require an explicit
> media-specific location declaration either way: images use
> `image: { location }`, while videos use the distinct sibling
> `video: { location }`. A `"strip"` image or video intent admits and
> publishes here with location metadata provably absent from served
> bytes; `"retain"` preserves the source bytes identically and records
> the choice in lifecycle evidence. Hosted targets report the whole
> capability Missing.

Use an asset when your app stores a file: bytes live outside document rows
under a Snapback-owned lifecycle — upload, trusted finalization, typed
attachment, authorized delivery, deletion — and your tables hold only a
typed reference.

## The minimal path: one field, one attach line

The simplest case needs no upload intent at all. A bare `v.assetRef()`
field derives a generated **default intent** — strict delivery, GPS
stripped, owner-only reads, JPEG/PNG up to 10 MB — with a stable identity
in the manifest like any explicit intent (LLP 0044 §Ceremony floor):

```js fragment reason="minimal-path schema shape; the authoring suite verifies derivation"
// schema.mjs — the whole backend declaration for an avatar:
profiles: defineTable({
  ownerId: v.principal(),
  avatar: v.optional(v.assetRef()),
}).sync(),
```

Upload under the derived reference (`defaults.<table>.<field>` in the
generated api), then attach in any ordinary mutation:

```js fragment reason="client flow over the derived reference; conformance covers the transport"
import { defaults } from './snapback/generated/api.mjs';
const task = client.assets.start({ upload: defaults.profiles.avatar, file });
// in a mutation handler:
//   { avatar: await ctx.assets.attach(args.assetId) }
```

Sized thumbnails need no declared variants either — request any width and
the ladder rendition materializes once, then serves immutably:

```js fragment reason="width selector URL shape; the Rust e2e verifies materialization"
assets.deliveryUrl(assetId, { variant: 'primary', width: 128 });
// → /assets/records/<id>/bytes/primary?width=128 (ladder-normalized)
```

That is the whole ceremony: **one schema field plus one attach line.**
Declare an explicit intent (below) when you need different bounds, media
types, sharing, variants, callbacks, or delivery profiles — the derived
default is the paved floor, not the ceiling. The prior unrestricted
bare-field semantics keep the explicit spelling
`v.assetRef({ upload: null })`.

## Declare the upload intent and the reference field

Upload authorization and policy are declared in source and compiled into a
generated reference. The intent fixes what a client can never widen:
accepted media types, byte bounds, delivery profile, and read-access
policy. The authorizer runs server-side and returns the owner.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export const avatarUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: ['profiles'],
  accept: { mediaTypes: ['application/pdf', 'application/octet-stream'], maxBytes: 10_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

Reference assets from tables with `v.assetRef`. A restricted field
(`{ upload: 'avatarUpload' }`) admits only that intent's assets and is
writable from host plans; an unrestricted field is attachable only through
handler-side `ctx.assets.attach`. `assetSharing` declares who may read
assets referenced from a table's rows — without it, a reference confers no
read authority and the asset stays owner-only.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export default defineSchema({
  profiles: defineTable({
    ownerId: v.principal(),
    avatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
    attachment: v.assetRef(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .assetSharing({ kind: 'owner', field: 'ownerId' })
    .sync(),
});
```

`assetSharing` takes the closed union `{ kind: 'public-read' }`,
`{ kind: 'owner', field }`, or `{ kind: 'membership', membership, roles? }`.
Declaring `access: { read: 'via-references' }` on an intent whose fields
can land in tables without the declaration emits
`SNAPBACK_ASSET_SHARING_UNDECLARED` at generation, listing the tables.

## Upload and attach

**A dev/test server with no real client session can never complete a
multi-step upload over the ordinary client HTTP surface — for any intent auth
mode.** Every upload attempt records the non-optional owner principal returned
by `authorize`. Transfer, finalization, and attachment compare that owner with
the caller resolved from each request. An anonymous browser, React Native, or
Expo request has no caller principal, so the server refuses attempt creation
before running the authorizer or reserving state with
`SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE`. Setting `auth: 'public'` does
not make ownership checks anonymous — a public intent remains legitimate with
session custody — and `public-immutable` controls delivery rather than upload
authority. Passing a `userId` option to the task is not authentication.

There are exactly two paved local-development answers:

1. For an operator, fixture, or headless proof, use the admin-impersonated CLI
   lane: `snapback assets put ... --user <handle>`. This is not an in-app
   upload path.
2. For an interactive browser or native app, run the app in settled Sessions
   auth mode and give it an ordinary session. A trusted local process that
   already holds the ready-file/operator authority can mint one through the
   shipped wrapper:

```sh
snapback session mint --email expo-dev@example.com --ready-file .snapback/dev.ready.json
```

The command prints a `hostOpsResult` whose `data.token` is the ordinary
session bearer; it never prints the impersonation capability. In an app, keep
the command or equivalent `auth.mintSession` host operation behind a trusted
development broker that authenticates its caller and returns only that
caller's session. Never put the ready file, admin token, impersonation
capability, mailbox reader, or a generic mint-for-email endpoint in an Expo
bundle. Adopt the returned bearer with `createExternalSessionClient` before
preparing the React provider, as described in
[native auth](../auth/native-apps.md):

```tsx source=demos/tandem-expo-bakeoff/snapback/src/backend.tsx
      const client = createExternalSessionClient(origin, { bearerToken: brokerPayload.bearerToken });
      const binding = await client.prepareReactBinding({
        generatedManifest: { schema, functions, capabilityManifest },
      });
      return { status: 'ready' as const, client, provider: createSnapbackReactProvider(binding) };
```

The client flow is: create an attempt (the generated reference plus the
declared byte length — deferred length refuses), transfer bytes over TUS
1.0.0 (`PATCH /assets/tus/{id}`, checksum every chunk), then finalize.
Finalization re-validates the admission witness, verifies length and
integrity, detects the content type from bytes, computes the SHA-256
canonical digest, dedups within the app, and publishes atomically. The
asset id is stable from creation — an expired attempt's authorized
successor keeps it.

Dedup is by canonical bytes, by design: uploading byte-identical files
twice in one app yields two assets sharing one stored blob (each still
consumes logical quota). Two consequences worth knowing when you batch:
a burst of *identical* test images collapses to one set of stored bytes
— make fixtures byte-distinct (a unique comment segment suffices) when
your test needs distinct blobs; and attachment does not wait for
publication — `ctx.assets.attach` admits a `pending` asset (the
optimistic path), so you can attach in the same flow that started the
upload and let live readiness catch up.

Attach the asset to a row in an ordinary mutation:

```js source=tests/acceptance/fixtures/asset-conformance/handlers.mjs
  async createPhoto(ctx, args) {
    return await ctx.db.insert('photos', {
      ownerId: ctx.auth.userId,
      caption: String(args.caption ?? '').trim(),
      image: await ctx.assets.attach(args.assetId, { upload: 'photoUpload' }),
    });
  },
```

Enforcement lives at the storage commit boundary, not the helper: a raw
id-shaped string written into a `v.assetRef` field fails the commit with
`SNAPBACK_ASSET_REF_UNVERIFIED` on every write path, and the reverse
reference edge commits in the same changeset. Deleting an asset refuses
while typed references remain.

## Upload from Expo ImagePicker with an ordinary session

Once the provider owns the real session above, bridge the native picker URI
with `expo/fetch` (`import { fetch as expoFetch } from 'expo/fetch'`) and
import `ImagePicker` from `expo-image-picker`. The messaging bakeoff first
captures the picker metadata:

```tsx source=demos/tandem-expo-bakeoff/shared/chat-screen.tsx
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      mediaTypes: ['images'],
      quality: 0.82,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    setAttachment({
      uri: asset.uri,
      fileName: asset.fileName ?? `message-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
    });
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
  };
```

Its backend hook converts that URI to a Blob with `expoFetch`, starts the
generated upload reference, exposes byte progress, awaits `task.done`, and
accepts only the completed `ready` receipt with a non-null `assetId`:

```tsx source=demos/tandem-expo-bakeoff/snapback/src/backend.tsx
function useImageUpload() {
  const upload = useSnapbackAssetUpload({ upload: api.messageImageUpload });
  const [error, setError] = useState<string | null>(null);
  const progress = upload.state.totalBytes > 0 ? upload.state.bytesTransferred / upload.state.totalBytes : 0;
  return useMemo(() => ({
    state: {
      status: error ? 'error' as const : upload.state.status === 'idle' || upload.state.status === 'ready' ? 'idle' as const : 'uploading' as const,
      progress,
      error: error ?? upload.state.diagnostic?.message ?? null,
    },
    upload: async (input: { uri: string; mimeType: string; fileName: string }) => {
      setError(null);
      try {
        const response = await expoFetch(input.uri);
        const blob = await response.blob();
        const task = upload.start(blob, {
          declaredContentType: input.mimeType,
          declaredFilename: input.fileName,
          previewUrl: input.uri,
        }) as { done: Promise<{ status: string; assetId: string | null; diagnostic?: { message?: string } | null }> };
        const result = await task.done;
        if (result.status !== 'ready' || !result.assetId) {
          throw new Error(result.diagnostic?.message ?? 'Snapback could not finish the image upload.');
        }
        return result.assetId;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        throw cause;
      }
    },
  }), [error, progress, upload]);
}
```

The screen awaits that receipt before calling its ordinary authenticated
message mutation. The mutation performs the typed attachment; do not write
the returned id directly into a `v.assetRef` field:

```js source=demos/tandem-expo-bakeoff/snapback/snapback/functions.mjs
    if (args.imageAssetId) {
      values.image = await ctx.assets.attach(args.imageAssetId, { upload: 'messageImageUpload' });
    }
```

That is the complete custody chain: trusted dev broker mints an ordinary
session → `createExternalSessionClient` owns it → ImagePicker supplies a URI
→ `expo/fetch` produces the Blob → `useSnapbackAssetUpload.start` owns the
TUS task → `task.done` yields the ready asset id → an ordinary authenticated
mutation calls `ctx.assets.attach`. Render `upload.state.bytesTransferred /
totalBytes` while active and surface `rejected`/`failed` diagnostics rather
than treating attempt creation as success.

## Run lifecycle callbacks

An explicit upload intent may name an ordinary mutation for `ready` and/or
`rejected`. The mutation must declare exactly `{ event: v.string(), assetId:
v.string(), facts: v.json() }`; the facts are safe lifecycle metadata, never
byte authority, staging keys, or delivery bearers.

```js source=tests/acceptance/fixtures/asset-conformance/functions.mjs
export const fileUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream', 'application/zip'], maxBytes: 100_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  on: { ready: 'recordAssetReady' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

```js source=tests/acceptance/fixtures/asset-conformance/functions.mjs
export const recordAssetReady = defineJsMutation({
  auth: 'authenticated',
  args: { event: v.string(), assetId: v.string(), facts: v.json() },
  source: 'handlers.mjs',
  exportName: 'recordAssetReady',
  writes: ['assetCallbackLog'],
});
```

The runner uses the stable mutation identity
`asset-cb:<asset>:<event>:<generation>`, so retrying the same work cannot
double the committed effect. A callback failure retries independently and
never degrades an already-ready asset.

Authority differs honestly by auth mode. Dev callbacks preserve the existing
asset-owner dev authority. Sessions callbacks run under one per-app, narrowly
granted service principal named `asset-callbacks`; Snapback never mints an
owner session or bearer. In sessions callbacks `ctx.auth.sessionId` is `null`,
`ctx.auth.kind` is `"agent"`, and `ctx.auth.actorKind` is
`"asset-callbacks"`, so application code and stored audit rows can distinguish
the scheduled actor from an interactive user. The callback still follows the
ordinary staged mutation, commit-time grant validation, authorization-event,
and receipt path. The asset work-completion receipt records the service actor
and exact grant, without carrying any bearer.

```js source=tests/acceptance/fixtures/asset-conformance/handlers.mjs
  async recordAssetReady(ctx, args) {
    return await ctx.db.insert('assetCallbackLog', {
      assetId: args.assetId,
      event: args.event,
      actorId: ctx.auth.userId,
      actorKind: ctx.auth.actorKind,
      provider: ctx.auth.provider,
      sessionId: ctx.auth.sessionId,
    });
  },
```

## Put typed photos directly in a live feed

`v.assetRef` is a first-class result-contract leaf. A query or live query may
return a table containing typed references directly; each reference is the
opaque asset-id string on the JSON wire. Do not duplicate it into a plain
string display column or split the reference into a side table merely to make
the row live-queryable.

Party Wall keeps the photo, membership-backed sharing policy, reverse-reference
edge, seed fixture, and live-feed row together:

```js source=demos/party-wall/snapback/schema.mjs
    posts: defineTable({
      eventId: v.id('events'),
      authorId: v.principal(),
      authorName: v.string(),
      caption: v.string(),
      photo: v.optional(v.assetRef({ upload: 'photoUpload' })),
    })
      .index('by_event', ['eventId'])
      .assetSharing({ kind: 'membership', membership: 'eventMembers' })
      .sync(),
```

## Browser apps: the paved React + Vite path

A browser app reaches every asset route through the first-party dev relay:
`@expo/snapback-vite` forwards the complete author-facing `/assets/*`
family — attempts, TUS transfer, records, strict/signed/public delivery —
under `/__snapback`, while continuing to refuse `/_snapback/*` system and
admin routes (`packages/snapback-vite/allowlist.mjs`). No app-owned Vite
proxy is needed, and a relative URL such as
`/__snapback/assets/public/<id>/display` works directly as an `<img src>`.

Two facts shape the browser flow:

- **Interactive uploads need sessions custody.** The ordinary browser and
  native HTTP carriers resolve as anonymous when no real session is present,
  so the reservation refusal described under Upload and attach applies to
  every intent auth mode. The `--user` lane under Operate below is the
  CLI/host-op path (admin authority for agents and fixtures), not a browser or
  Expo path.
- **The sign-in code arrives through a trusted-local seam.** The dev
  mailbox is admin- and impersonation-gated
  ([sessions guide](../auth/sessions-and-principals.md)), so a browser demo
  reads it through a small server-side dev middleware that holds both
  carriers and hands the page only the one-time code — neither credential
  enters the bundle, and the relay never forwards the mailbox route.

Explicit and derived upload references are typed members of the generated
api (`AssetUploadReference` in `api.d.ts`; derived defaults are typed per
table and field on `defaults`), so the generated reference is accepted
directly — no cast:

```tsx fragment reason="hook call shape; the demo app strict-typechecks it in the proof"
const upload = useSnapbackAssetUpload({ upload: api.photoUpload });
```

```js source=demos/file-drop/tests/acceptance/browser-relay.mjs
    const task = assets.start({
      upload: api.photoUpload,
      file,
      declaredFilename: 'snapback-balloons.png',
      declaredContentType: 'image/png',
    });
```

The complete path — relay health, the system-route refusal, mailbox
sessions sign-in, typed upload to `ready`, typed attachment, the live
gallery update over the relayed WebSocket, and public rendition delivery
through the relay — is CI-verified by
`demos/file-drop/tests/acceptance/browser-relay.mjs` (run from
`scripts/verify-local-proof`); Snapdrop
([`demos/file-drop`](repo:demos/file-drop/README.md)) is the runnable demo.

## Deliver

`GET /assets/records/{id}` serves authorized metadata;
`GET /assets/records/{id}/bytes/{variant}` serves bytes (variant
`primary` in v1) under `private-strict`: every request re-authorizes
through the declared read-access policy, responses carry
`Cache-Control: private, no-store`, HTTP ranges work for media playback,
and active-content types are never served inline. Revoking access or
deleting the asset denies the next request. Two sizing selectors ride
the byte routes: `best?maxWidth=N` picks the largest *declared* variant
within the bound, and `?width=N` ladder-normalizes to a bounded
on-demand rendition (materialized once under the image ceilings, then
immutable; refused above the declared 2048 ceiling or without the
image-finalization fact). Signed issuance accepts `widthPx` the same
way and signs the concrete ladder variant.

Intents may instead declare `delivery: { kind: 'public-immutable' }`
(ready renditions on `GET /assets/public/{id}/{variant}` with
year-long immutable cache headers — public product media) or
`{ kind: 'private-signed' }` (`POST /assets/records/{id}/signed-url`
issues a bearer URL under per-request authorization, valid until its
TTL). Both serve lanes are **pasteable**: the URL is the entire
authority, so a plain `<img src>`, a CDN pull, or a link pasted into an
email fetches with no Snapback headers — including on sessions-mode
servers, where every other asset route requires the auth-client
protocol offer. Signed issuance and strict delivery keep full
per-request authorization.

On a sessions-mode server, a plain signed-out request to a
`private-strict` byte URL that omits the auth-client protocol offer is
malformed before the server can decide whether it is unauthorized. It
therefore returns HTTP 400 with
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`, not 401 or 403; send
`x-snapback-auth-client-protocol: 1` (and the session bearer when signed in)
on strict delivery requests. Public-immutable and already-issued signed byte
URLs are the pasteable exception: plain HTTP clients need no protocol offer
and receive their ordinary 200/403/404 delivery semantics. This ordering is
the reviewed status posture in [LLP 0012](repo:llp/0012-headless-integration-contract.spec.md)
and the per-profile offer contract in
[LLP 0096](repo:llp/0096-auth-profiles-for-protocol-clients.spec.md).

## Images

Declare a location policy on every image intent — omission refuses at
generation, and `strip` (the conventional choice) removes GPS metadata
from the canonical bytes before they are digested or stored, applying the
EXIF orientation and keeping only safe facts (dimensions, captured-at).
Declared variants render off the canonical bytes; mark one `required` and
it gates `ready`, produced atomically with the primary.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export const photoUpload = defineAssetUpload({
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 1_000_000 },
  // Public display media follows the 2026-08-16 performance-default ruling.
  delivery: { kind: 'public-immutable' },
  image: { location: 'strip', variants: [{ key: 'thumb', width: 128 }] },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

Every published image carries typed media facts on its primary rendition:
`width`/`height`, `placeholder: { algo: "thumbhash.v1", value }` (render
it client-side for instant previews), `dominantColor`, `locationPolicy`,
and `capturedAt` where the source declared one. Deliver a specific variant
by key, or let the server pick the best fit:

```text
GET /assets/records/{id}/bytes/thumb
GET /assets/records/{id}/bytes/best?maxWidth=480
```

Processing is bounded and adversarial-input safe: decoded pixels,
dimensions, decompression ratio, metadata size, step time, and output
bytes are all Enforced ceilings in the manifest's `assets.image` block,
and a hostile file (decompression bomb, dimension lie, truncated stream)
rejects the asset with a structured `SNAPBACK_ASSET_IMAGE_*` diagnostic.
Retain-declared intents (`location: 'retain'`) keep metadata intact and
record that policy in the asset's lifecycle evidence.

## Video

Video location policy is a sibling declaration, not an alias through the
image block. Use `video.location` for accepted video types; an intent that
accepts both location-bearing images and videos declares both blocks. On the
local target, `strip` blanks MP4/QuickTime location atoms in place without
transcoding, while `retain` publishes the received bytes unchanged.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export const clipUpload = defineAssetUpload({
  accept: { mediaTypes: ['video/mp4'], maxBytes: 100_000_000 },
  // Public display media follows the 2026-08-16 performance-default ruling.
  delivery: { kind: 'public-immutable' },
  video: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

## Operate

The CLI drives the same lifecycle for agents and fixtures (dev/test
targets, admin authority):

```sh
snapback assets put photo.pdf --upload avatarUpload --user user_a --url http://127.0.0.1:4287
snapback assets inspect <asset-id> --url http://127.0.0.1:4287
snapback assets list --state ready --url http://127.0.0.1:4287
snapback assets retry <asset-id> --url http://127.0.0.1:4287
snapback assets gc-sweep --now-ms 1785484800000 --url http://127.0.0.1:4287
snapback assets delete <asset-id> --user user_a --url http://127.0.0.1:4287
```

Deletion is two truths, both deliberate: bytes die at the origin
immediately (delivery 404s on the next request), while the metadata row
lingers as a declared `availability: "deleted"` tombstone through its
retention window (default seven days — a GC sweep will not purge it
early). The tombstone is what lets clients and reverse-reference repair
observe *that* something was deleted rather than never existing; do not
read a 200 metadata response with `deleted` availability as a failed
delete.

`put` uploads chunk-checksummed and finalizes end-to-end verified.
`inspect` prints the lifecycle — availability, receipts, quota, reference
edges, runner claims — and never byte samples, staging keys, or bearer
URLs. `retry` re-drives pending publication/ledger work under the
generation fence; it never reopens a terminal attempt. `gc-sweep` requires
an explicit portable Unix-millisecond clock and runs the same attempt,
pending-asset, reference, tombstone, blob, retained-intent-artifact, and
publication cleanup as the background runner. Its report echoes `nowMs`;
each semantic reclamation keeps the ordinary asset lifecycle receipt.

Background maintenance (finalization re-drives, GC sweeps, publication
reconciliation) runs on the asset runner; set
`SNAPBACK_ASSET_RUNNER_DISABLED=1` to drive it deterministically in tests,
then invoke `asset.gcSweep` (or the CLI command above) with the suite's
chosen clock. Host operations do not keep a response replay ledger; the sweep
itself is idempotent, and each reclaimed asset receives its canonical
`reference-gc` lifecycle receipt exactly once.

## Export the asset component of a logical backup

The local target advertises `assets.export.cutExport: true`. Capture its asset
component into an absolute, empty-or-absent directory:

```sh
snapback assets export-cut \
  --dir "$PWD/backups/assets-2026-08-04" \
  --ready-file .snapback/server-ready.json
```

The command opens one read transaction and pins its storage head as
`cutVersion`. That transaction captures all `ready` asset records and their
`ready` renditions, deleted-asset tombstones, each referenced immutable blob
exactly once, and the settled quota snapshot. It deliberately excludes
in-flight attempts, pending/rejected assets, staging bytes, and reverse
reference edges; the edges derive from application rows and belong to the
app-data export component.

After the transaction closes, Snapback copies the immutable blobs under
`blobs/sha256/`, verifies each copy against its recorded SHA-256 and length,
then writes `asset-cut.manifest.json` last. An unreadable or mismatched blob
fails the command instead of producing an admissible partial cut. The failed
directory may contain copied objects but no valid complete manifest; retry
into a new empty directory.

This is a **logical export component**, not a full application or SQLite
backup. The capability manifest still lists `asset-byte-backup` as Missing,
and a portable application export must coordinate the separately owned
app-data component.

### Validate the complete cut before restore

`importValidation: true` is the refuse-partial half of the shipped surface.
Without `--apply`, `import-cut` only validates the tagged manifest digest and
every declared blob object:

```sh
snapback assets import-cut \
  --dir "$PWD/backups/assets-2026-08-04" \
  --ready-file .snapback/server-ready.json
```

A missing object, changed byte length, digest mismatch, or tampered manifest
returns a structured refusal before any asset row lands. Restore application
is a separate experimental capability (`importApply: "experimental"`):
`--apply` requires the server-side `SNAPBACK_ASSET_IMPORT_EXPERIMENTAL=1`
acknowledgment and an empty asset state. It is not the paved full-app restore
path.

### Invalidate every outstanding signed URL

Rotate the instance signing key when every already-issued `private-signed`
URL must stop validating immediately:

```sh
snapback assets rotate-signing-key --ready-file .snapback/server-ready.json
```

Rotation retires every active signing key, mints a fresh one, and emits an
instance-scoped receipt without returning key ids or key material. New signed
URL issuance works under the fresh key. This is deliberately a wide operator
action; use ordinary authorization changes when the intent is to revoke one
principal rather than every outstanding signed bearer URL.

The local proof drives these exact native CLI commands against a real server,
checks the pinned manifest, observes an issued URL fail after rotation, and
proves incomplete-cut validation exits non-zero with the structured refusal:

```js source=tests/acceptance/asset-conformance-v1.mjs
  const rotation = await runAssetsCli(sessionsServer, 'rotate-signing-key');
  assert.equal(rotation.exitCode, 0);
  assert.equal(rotation.envelope.ok, true);
  assert.equal(rotation.envelope.data.rotated, true);
  const signedAfterRotation = await fetch(`${sessionsServer.baseUrl}${issuanceBody.url}`);
  assert.equal(signedAfterRotation.status, 403, 'rotation invalidates the outstanding signed URL');

  const exportDir = join(scratch, 'asset-cut-export');
  const exported = await runAssetsCli(sessionsServer, 'export-cut', '--dir', exportDir);
  assert.equal(exported.exitCode, 0);
  assert.equal(exported.envelope.ok, true);
  assert.equal(exported.envelope.data.cut.formatVersion, 'snapback.asset-cut.v1');
  assert.ok(exported.envelope.data.cut.assetCount > 0);
  assert.ok(exported.envelope.data.cut.blobCount > 0);
  const cutManifest = await readJson(join(exportDir, 'asset-cut.manifest.json'));
  assert.equal(cutManifest.cutVersion, exported.envelope.data.cut.cutVersion);
  assert.equal(cutManifest.manifestDigest, exported.envelope.data.cut.manifestDigest);

  await rm(join(exportDir, cutManifest.blobs[0].objectPath));
  const incomplete = await runAssetsCli(sessionsServer, 'import-cut', '--dir', exportDir);
  assert.notEqual(incomplete.exitCode, 0);
  assert.equal(incomplete.envelope.ok, false);
  assert.equal(incomplete.envelope.diagnostics[0].code, 'SNAPBACK_ASSET_IMPORT_INCOMPLETE');
  checks.nativeCliCutExportAndRotation = true;
```

## Evidence and limits

The acceptance traceability map is
[`tests/acceptance/asset-lifecycle-v1-evidence.md`](../../tests/acceptance/asset-lifecycle-v1-evidence.md);
the manifest facts (stores, profiles, integrity grades, enforced limits,
and the explicit Missing nonclaims — byte backup, custom read
authorizers, deferred length) live in
`schemas/capability.manifest.local-dev-sqlite-ibex.json` under `assets`.
Live no-polling readiness ships as the reserved `_snapback.assetRecord`
projection (subscribe via the asset client's `watch`/`watchStore`), and
the framework-neutral upload task comes from the `@expo/snapback-client/assets`
entry: `createAssetClient(client)` wraps your `SnapbackClient`, and
`createAssetClient(client).start({ upload, args, file })` is the task
(there is no `client.assets` accessor on `SnapbackClient` itself); the
React/Expo hook and renderer are
`useSnapbackAssetUpload` / `useSnapbackAssetImage` in
`@expo/snapback-react`, and the real-server JS conformance vectors are
`tests/acceptance/asset-conformance-v1.mjs`.

The declared limits are preflightable, not discover-by-failure: the
attempt-create response's `transfer.maxChunkBytes` carries the chunk
ceiling (the packaged client narrows its chunk size to it
automatically), every TUS response advertises `Tus-Version`,
`Tus-Extension`, `Tus-Checksum-Algorithm`, and `Snapback-Max-Chunk-Bytes`
on the wire, and the manifest's `assets` block declares the byte, quota,
TTL, and count ceilings a suite can read before sending a byte. Ready
records expose the canonical `digest`, `digestAlgorithm`, and
`integrityGrade` as ordinary queryable facts on the record view and
`snapback assets inspect`.
