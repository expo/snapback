# Diary 0058 — Relay Room, Expo messaging on Snapback and Convex

**Demo:** `demos/relay-room-bakeoff/`
**Arms:** `snapback-expo/`, `convex-expo/`
**Surfaces:** Expo SDK 57 / Expo Router, Snapback source checkout at
`758f6f135`, Convex 1.43.0 cloud development deployment
**Date:** 2026-08-05
**Brief:** build the same WhatsApp-shaped messaging app twice: DMs and group
chats, text and image messages, emoji reactions, reply pointers without
threads, seeded data, typing indicators, offline-readable history, and a fast
test-persona switcher. Record the experience and compare both current systems
and hypothetical very-mature versions.

**Independence:** another agent was working in
`demos/tandem-expo-bakeoff/`. I did not inspect, modify, or derive this build
from that arm. Relay Room has its own directory, visual treatment, model, test
data, acceptance scripts, and measurements.

---

## Outcome

Both implementations satisfy the interactive brief on their online path. Both
have real cloud/local backend evidence for text, images, replies, reactions,
typing, and seed data, and both build native iOS and web bundles.

The offline result is intentionally not described as equivalent:

- **Snapback:** the app uses Snapback's retained-query store and durable
  mutation outbox. The two-boot acceptance test reads three messages live,
  stops the server, creates a fresh client over the same Expo-style file store,
  and gets the same three rows with `freshness: "retained"` and
  `retainable: true`. The store honestly reports `durable: false` with
  `native-files-no-power-loss-cut`, so this proves ordinary relaunch retention,
  not survival of a power cut at the wrong instant.
- **Convex:** the React Native client did not expose a documented persistent
  offline query cache, so the app writes every successful query result into an
  app-owned `expo-sqlite` localStorage snapshot. A cold-snapshot test reads six
  real cloud rows, discards the network source, and reconstructs all six,
  including three reply pointers and one image-message record. Sends and
  reactions are disabled offline; I did not invent a second mutation protocol
  for the comparison. Image bytes are best-effort through Expo Image's
  `memory-disk` cache, while message and image metadata are explicitly saved.

The current winner is **Convex, 86/100 vs Snapback, 84/100**, mostly because it
was dramatically faster and smoother to get to a live, phone-reachable backend.
Snapback's underlying product fit for this particular local-first app is
stronger, which is why the hypothetical mature-system score reverses:
**Snapback 97/100 vs Convex 96/100**.

## Measurement

Wall-clock boundaries came from local epoch timestamps, not estimates:

| Lane | Started | Finished | Wall time |
|---|---:|---:|---:|
| Snapback | 03:36:19 PDT | 04:02:22 PDT | **26m03s** |
| Convex | 04:02:22 PDT | 04:13:37 PDT | **11m15s** |

The clocks include scaffolding, dependency installation, backend authoring,
Expo UI, debugging, live backend proofs, bundles, offline acceptance, and the
Snapback repository issues filed from the run. They exclude the shared LLP and
guide orientation done before the Snapback clock and this diary/scoring pass.
That exclusion favors Snapback in the comparison, because most of the shared
orientation was Snapback-specific.

**Model token counts are unavailable.** This Codex surface did not expose a
per-lane token meter, and reconstructing counts from visible prose would be
fictional. I tracked the requested wall time instead. Weak complexity proxies,
not substitutes for model tokens:

| Lane | Hand-authored source/test lines | Hand-authored source/test files | iOS JS/Hermes bundle |
|---|---:|---:|---:|
| Snapback | 1,202 | 14 | 4.7 MB |
| Convex | 868 | 13 | 2.9 MB |

Generated Snapback and Convex artifacts are excluded from the line counts.
The UI implementations are separate and formatting differs, so lines are only
a rough ceremony signal.

---

## Build log

### 03:36 — Snapback starts with a clear design

The Snapback guide and governing LLPs mapped unusually well to the brief:

- public, authority-independent, single-table live queries for retainable chat
  history;
- declarative mutations for outbox-replayable text/reply sends and reactions;
- TTL ephemeral state for typing;
- typed `assetRef` fields plus `ctx.assets.attach` for atomic image attachment;
- server-authored IDs and timestamps;
- explicit freshness and connection facts instead of treating every cached
  result as generically “offline.”

I chose a visibly labeled, test-only persona seam in both arms. User IDs travel
as operation arguments; neither app pretends that tapping “Ada” is production
authentication. A real app would use session/Convex Auth identity and derive the
sender server-side.

The data model settled quickly: users, conversations, memberships, messages,
reactions, plus typing presence. Replying stores only `replyToId`; there is no
thread table and no nested route.

### 03:38 — first Snapback sidetrack: local package closure

Expo SDK 57 scaffolded cleanly. Installing local
`@expo/snapback-client`/`@expo/snapback-react` did not: Bun tried to resolve the
client's unpublished exact dependency on `@expo/snapback-contract@0.1.0` from
the registry. The repair was an explicit local contract dependency plus a
package override before installing the client and React packages.

This is understandable in a framework source checkout, but it is ceremony the
Convex arm did not have. Convex was one `bun add convex`. Filed
`issues/closed/20260805-local-source-package-closure-needs-contract-override.md` with
the exact dependency edge and cold-install acceptance criteria.

### 03:42 — codegen was fast and useful

The first codegen rounds caught three authoring mistakes immediately:

1. I described a deletion with a raw `{ kind: 'delete' }` record rather than
   the `del(...)` authoring helper.
2. A declarative insert used raw `'text'` instead of `lit('text')`.
3. `seedVersion` must be a portable string token, not the integer `1`.

All three diagnostics named the failing concept and no stale artifacts were
written. After those fixes codegen produced five tables, six live queries,
five mutations, one ephemeral collection, generated data-model types, and no
warnings. Asset references now appear in generated result contracts, which is
important because an older published closure could not query an `assetRef`
field at all.

### 03:44 — Expo client implementation

The Snapback React surface felt good once the generated API existed:

- `useSnapbackQuery` exposes rows, freshness, retention, and errors;
- `useSnapbackConnection` and `useSnapbackOutbox` expose separate facts the UI
  can label honestly;
- `useSnapbackPresence` directly models typing without an application table or
  cleanup job;
- the asset hook exposes upload progress and resumable task state;
- Expo file-system registration is a small, explicit boot step.

I did have to hand-roll the provider's async boot state and generated-manifest
binding. The UI is intentionally route-thin (`src/app` only re-exports screens),
with `FlatList`, native Stack, haptics, image picker, semantic palette, keyboard
avoidance, and a persona panel.

TypeScript passed. The first web export failed because I evaluated
`PlatformColor` at module scope on web even though the value was unused. That
was my mistake; removing it fixed the export.

### 03:50 — the managed Snapback dev loop is broken for this app

Runtime bootstrap itself was excellent: it reused existing vendored
Ibex/Hermes artifacts, linked the exact checkout, launched the binary, created
the restricted no-eval handler VM, and wrote a digest-bound readiness receipt
in about 14 seconds.

Then the documented managed loop failed:

```text
SNAPBACK_DEV_SERVER_LOAD_FAILED: schema/function load failed
Error: host-ops error response was not JSON
Failed to read JSON: expected value at line 1 column 1
```

The generated backend was not the problem. Starting the same binary manually
and issuing the same native `load` returned two successful JSON result
documents—one for `schema.load`, one for `functions.load`. The package wrapper
expects one JSON document and rejects the two-document success output.

This was the biggest Snapback detour. I filed
`issues/closed/20260805-managed-dev-multi-json-load.md` and built
`scripts/dev-server.mjs`, which starts a LAN-reachable dev server and provisions
through `SnapbackClient.ensureApp`. That launcher works and prints the exact
`EXPO_PUBLIC_SNAPBACK_ORIGIN=… bun run start` command for Expo Go.

### 03:52 — a smaller declarative-plan mismatch

My first `sendText` had an optional `replyToId`. Codegen correctly generated a
TypeScript property that callers may omit. The mutation plan read
`arg('replyToId')`, and an omitted property then failed at runtime:

```text
SNAPBACK_ARG_MISSING: handler arg replyToId was not provided
```

Passing JSON `null` succeeded, but the generated caller type did not accept
`null`. I replaced the one mutation with two declarative operations,
`sendText` and `sendReply`. Both remain offline-replayable and the model is
clearer, but the type/runtime disagreement is real. Filed
`issues/20260805-declarative-optional-arg-plan-missing.md`.

### 03:53 — Snapback backend proof, including real bytes

Manual host operations then passed cleanly:

- versioned seed installed 24 rows in one reset;
- users and conversation messages queried with complete read/write provenance;
- text mutation committed a generated ID and deterministic runtime timestamp;
- a real 393,493-byte PNG uploaded through `messageImageUpload` with
  end-to-end verification;
- `sendImage` attached the typed asset and updated the conversation in one
  mutation;
- `GET /assets/public/<asset>/chat` returned `200 image/png` while the private
  record-bytes lane correctly returned `403` without authority.

The image model is the best Snapback-specific part: declared media types/size,
GPS stripping, a required 1440px rendition, typed attachment admission, and a
reverse reference all live in the backend contract. The worse part is the dev
authority story: normal browser/Expo upload authority still has more ceremony
than the operator `assets put` proof, and the public-immutable lane is suitable
for this test app, not private chat production.

Relay Room's second-app evidence is now recorded on
`issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md` and
`issues/20260805-expo-asset-upload-guide-gap.md`. The update distinguishes the
proven operator/image pipeline from the client upload that could not receive
session custody; it does not claim a device 403 I did not capture.

### 03:55 — Metro issues and a blocked visual-inspection tool

Web development exposed two Expo integration details:

- `expo-sqlite` web needs `wasm` added to Metro `assetExts`;
- the monorepo/local package path resolved another React instance until Metro
  pinned `react` to the app's installation.

Static server rendering amplified the React-instance issue, so both apps use
Expo Router's single-page web output. After that, the Snapback web runtime
logged a clean application start. The iOS Hermes export completed at 4.7 MB.

I attempted in-app visual inspection as a separate proof. The browser-control
runtime failed during its own setup with `Cannot redefine property: process`
even after a clean kernel reset. Its instructions prohibit switching to a
different automation surface, so I stopped there. This is why the receipt is a
bundle/runtime-console proof rather than a screenshot or tap-through recording.
It is not counted as a Snapback defect.

### 03:58 — Snapback offline proof needed two test revisions

The first test waited on `onUpdate` but did not see the initial rows. The second
read `.rows` from the object returned by `startLiveQuery`, but that object is a
`StartedLiveQueryHandle`; the actual live handle is `.current` after
`.started()`. The type declarations were accurate, and changing the harness to
the intended lifecycle fixed it.

Final result:

```json
{
  "ok": true,
  "onlineRows": 3,
  "offlineRows": 3,
  "offlineFreshness": "retained",
  "retainable": true,
  "store": {
    "implementation": "file",
    "durable": false,
    "reason": "native-files-no-power-loss-cut"
  }
}
```

This is much stronger than merely observing that a React component still has
memory after airplane mode. It creates a second client after the server is
gone and exercises the same Expo-style file carrier the app registers.

The documentation audit found that `guide/clients/react.md` describes this
persisted-receipt cold start, while `guide/clients/react-expo.md` still says
`prepareReactBinding` requires a reachable server. The existing open ticket
`issues/20260804-guide-gap-react-expo-offline-cold-boot.md` already records the
contradiction and its browser-carrier failure, so I did not create a duplicate.
This demo adds positive evidence for the Expo-style file carrier; it does not
invalidate the ticket's negative IndexedDB evidence.

### 04:02 — Convex starts

Expo scaffold plus dependencies took under a minute. I then ran:

```text
convex dev --configure new --once --project relay-room-bakeoff
```

It created the project and cloud dev deployment, wrote ignored Expo environment
variables, generated types, added eleven indexes, and deployed all functions
without a code correction. I declined Convex's optional AI files because this
repository already has governing agent instructions and skills.

This was the starkest comparison point: the Snapback backend needed bootstrap,
three codegen corrections, a managed-loop diagnosis, a custom launcher, and
manual load/reset steps before it was live. Convex was reachable from the phone
as soon as one command returned.

### 04:05 — Convex backend and seed

The Convex model mirrors the domain but uses idiomatic queries/mutations. A
single `relay.ts` holds the backend. The seed mutation inserts users first,
captures their generated IDs, then inserts conversations, memberships,
messages, reply pointers, and reactions; a `seedMarkers` row makes it
idempotent.

This was easier to author than Snapback's separate schema/function/seed JSON
graph, especially because generated Convex IDs can be used directly inside the
seed transaction. Snapback's reviewable seed JSON is nicer to inspect, but the
fixed cross-row IDs are more manual.

### 04:07 — where Convex needed application machinery

Three requested features do not map to a first-class Convex client/backend
primitive in the same way:

1. **Offline history.** `useCachedQuery` wraps every relevant Convex query and
   persists the last successful value to the SQLite-backed localStorage
   adapter. A cold launch can render that snapshot while `useQuery` is still
   undefined. The connection badge comes from NetInfo. This is a parallel cache
   the application owns, versions, and must keep consistent.
2. **Typing.** Typing is a durable `typing` table. A mutation upserts a row with
   `expiresAt`, schedules an internal cleanup mutation, and the client
   heartbeats every two seconds. It works, but typing activity consumes durable
   writes and scheduled-function traffic. Snapback's ephemeral collection is a
   substantially better semantic match.
3. **Offline writes.** I disabled the composer and reactions offline. Building
   an app-owned mutation outbox with optimistic IDs, replay, idempotency, and
   reconciliation would be a significant feature, not a fair incidental shim.

The positive side is that all of this remained ordinary TypeScript. No separate
plan DSL or generated-manifest boot existed.

### 04:09 — Convex images are easy but less atomic

The app follows the documented three-step flow:

1. mutation returns a short-lived upload URL;
2. Expo posts the blob and receives a storage ID;
3. mutation inserts the image message and calls `storage.getUrl` on reads.

The UI code is straightforward, and the live proof stored and returned a real
image URL. There is an orphan window between steps 2 and 3: if the final message
mutation fails, the uploaded blob exists without the message. Snapback's typed
attach puts asset admission and row/reference commit in one transaction after
upload finalization, which is conceptually stronger.

Convex storage URLs are bearer URLs, so persisting them in the offline snapshot
is metadata persistence, not a claim that bytes are available. Expo Image uses
`memory-disk` caching to make previously rendered bytes best-effort offline.

### 04:10 — live Convex proof

Cloud function calls proved:

- seeded users and three conversations for Ada;
- live text message insertion;
- a reply whose `replyToId` points at the prior message;
- reaction toggle returning `{ active: true }`;
- typing upsert visible immediately and absent after its scheduled cleanup;
- a real PNG uploaded through the generated URL and attached to an image
  message whose query result contains an image URL.

The current Engine Room query ended with the exact three new shapes: ordinary
text, reply-pointer text, and image message.

### 04:12 — Convex bundles and cold snapshot

TypeScript passed. iOS Hermes export was 2.9 MB; web was a single 1.4 MB bundle.
The web development runtime started with no console errors.

The cold-snapshot acceptance pulls the real Engine Room from the cloud, writes
it through the same cache functions the hook uses, drops the query source, and
reconstructs:

```json
{
  "ok": true,
  "source": "app-owned-snapshot",
  "liveRows": 6,
  "coldRows": 6,
  "replyPointers": 3,
  "imageMessages": 1
}
```

This proves the app shim, not a Convex platform offline guarantee. That
distinction is central to the scores.

### Final audit and verification

The LLP-maintain-style audit found no governing LLP drift and no LLP or `@ref`
change to propose. `node scripts/check-guide.mjs` passed with the repository's
existing freshness warnings. Both TypeScript checks, both final iOS exports,
the Snapback retained-query acceptance, the Convex cold-snapshot acceptance,
and a final `convex dev --once` deployment check passed.

The repository-wide `./ref-check --verbose` scanned this demo without finding
an error in it, but its overall exit was red because the other independently
authored bakeoff lane currently has two broken anchors. I did not change that
lane. The generated native bundles and local Snapback runtime database are
ignored build state, not proposed source files.

---

## What went especially well

### Snapback

- Retainable live queries and the offline outbox are the right primitives for
  chat. The app reports freshness, connection, and queued intent separately.
- Typing as TTL ephemeral state is exactly right—lossy, bounded, no cleanup
  table, and no claim of durable history.
- Typed asset references, declared image processing, and atomic attachment are
  much stronger than storing an arbitrary URL string.
- Codegen diagnostics were fast, stable, and failed without stale outputs.
- The offline story could be proven with a second client after server shutdown.
- Runtime bootstrap's binary/Hermes qualification is unusually rigorous.

### Convex

- Project creation, deployment, generated types, indexes, and a
  phone-reachable backend took one command and one clean compile.
- The TypeScript query/mutation model is compact and easy to refactor.
- Realtime data simply updated after every mutation; no subscription lifecycle
  code was required in the screens.
- File upload was small and unsurprising.
- Dashboard/deployment operations felt mature, and no local tunnel or runtime
  build was needed.
- The resulting client bundle was materially smaller in this build.

## What frustrated or sidetracked me

### Snapback

- Local npm dependency closure needed an explicit unpublished contract override.
- The packaged managed dev loop rejected a successful two-envelope native load.
- Optional generated argument types disagreed with declarative plan runtime
  behavior.
- LAN/device startup needed a custom launcher after the managed loop failed.
- Expo/web integration needed Metro wasm and React-instance fixes.
- The surface area I had to understand—guide, LLPs, codegen, runtime bootstrap,
  manifests, provider binding, RQS, outbox, ephemeral, assets—was much larger.
- Direct mobile image upload authority is still less smooth than the operator
  asset proof, even though the backend asset lifecycle itself worked.

### Convex

- Offline history is not an owned platform contract here; it is a second cache
  I had to write and label.
- Offline send/replay is absent, so the two apps are not feature-equivalent
  offline.
- Typing indicators are modeled as database writes plus scheduled cleanup,
  which is semantically and operationally heavy.
- File upload is a three-step protocol with an orphan window.
- `storage.getUrl` produces bearer URLs; snapshotting those URLs requires care.
- The test persona seam is easy to author but, like the Snapback arm, is not
  authentication. A real comparison with auth would add more work to both.

---

## Current scores

Weights reflect this brief: offline behavior is worth as much as core online
functionality, while local-first semantics and typing are not hidden inside a
generic “features” bucket.

| Dimension | Weight | Snapback | Convex | Rationale |
|---|---:|---:|---:|---|
| Functional completeness | 20% | 96 | 97 | Both cover every requested online interaction; Convex was marginally simpler to prove end to end. |
| Realtime + typing | 10% | 95 | 80 | Both realtime; Snapback ephemeral is native to the domain, Convex typing spends durable writes/schedules. |
| Offline behavior | 20% | 94 | 62 | Snapback retains/query-classifies and queues writes; Convex has an app snapshot and online-only writes. |
| Images/assets | 10% | 82 | 92 | Snapback policy/attachment is stronger but current dev upload/authority is rough; Convex's three steps are easy and worked immediately. |
| Data model + type safety | 10% | 94 | 91 | Both excellent; Snapback generated contracts are stricter, with one optional-arg inconsistency. |
| DX, docs, setup | 15% | 55 | 95 | 26m03s with two framework issues/custom launcher vs 11m15s and one clean deploy. |
| Testability + diagnostics | 5% | 87 | 88 | Snapback proves deeper offline/runtime facts; Convex live CLI/cloud proofs are faster. |
| Operations + current maturity | 10% | 62 | 96 | Convex cloud dev is productized; Snapback local runtime is rigorous but the main dev wrapper failed. |
| **Weighted overall** | **100%** | **84** | **86** | Convex wins the build today; Snapback wins the local-first architecture. |

## Hypothetical scores if each system is very mature

This is not “give both every imaginable feature.” It imagines each system's
current design carried to a polished conclusion: Snapback's managed loop,
package closure, mobile asset authority, hosted profile, and Expo integration
are boring and reliable; Convex has a documented durable React Native cache,
first-class presence, and a supported offline mutation strategy while keeping
its present deployment/DX quality.

| Dimension | Weight | Mature Snapback | Mature Convex |
|---|---:|---:|---:|
| Functional completeness | 20% | 99 | 99 |
| Realtime + typing | 10% | 99 | 95 |
| Offline behavior | 20% | 98 | 90 |
| Images/assets | 10% | 97 | 97 |
| Data model + type safety | 10% | 97 | 96 |
| DX, docs, setup | 15% | 94 | 98 |
| Testability + diagnostics | 5% | 97 | 95 |
| Operations + maturity | 10% | 94 | 99 |
| **Weighted overall** | **100%** | **97** | **96** |

Why Snapback edges ahead in that imagined state: chat is fundamentally a
local-first replicated log plus ephemeral coordination and referenced media.
Snapback's existing concepts already line up with those semantics; most of the
deductions today are implementation/packaging maturity. Convex's present
strength is the opposite: the mature online product and authoring loop are
excellent, while matching Snapback's offline/outbox semantics requires adding
new client guarantees, not merely polishing existing ones.

## Bottom line

If I had to ship this prototype this week, I would choose **Convex**: the cloud
backend, generated types, realtime updates, and images reached a green proof in
less than half the time, and the remaining offline snapshot shim is easy to
understand if offline sending is not required.

If offline relaunch plus queued writes is a product requirement rather than a
demo checkbox, I would keep investing in **Snapback**. It made the correct
properties explicit and testable, and its typing/asset semantics are a better
fit. I would not call it the easier system today: the failed managed loop and
package/Expo integration detours are exactly the sort of papercuts a mature
developer platform must eliminate.

## 2026-08-15 — loopback-safe launcher default

The historical phone-reachable run above used a LAN bind, but LAN delivery to
a physical iOS device is an **unsupported workaround**, not a supported
Snapback carrier. The Relay Room launcher now binds `127.0.0.1` by default.
Opting into the workaround requires `RELAY_ROOM_BIND_HOST=0.0.0.0` and prints
the consequence that, with dev auth, anyone on the network can assert any
identity. The simulator, Android USB, and hosted release targets remain the
supported paths while the physical-iOS carrier decision stays open.
