# Lane AV — asset resolution, round 0

Date: 2026-09-29. Branch: `sb4-intent/av-asset-resolution`.
Starting commit: `7f540f09467fcbdd73d4faa05db14fce696e9e85`.
No push or publication.

## Finding and its limit

**The builder's pattern is valid. The reported permanent-loading defect d-02
did not reproduce, including on published 0.4.8 and the supplied frozen app.**
It would be incorrect to call the separate hook fix below the root cause or
closure of d-02. The original failing backend/browser state is still needed;
the [follow-up ticket](../../../issues/20260929-snapback4-cal26-sender-avatar-failure-unreproduced.md)
preserves that request. The grader's markdown infers a hook state from DOM
measurements and contains no captured hook value or failed asset response.
The grader's served build hash is also unavailable; the frozen-export results
qualify the supplied `dist-scale` artifact whose hash is recorded here.

Source comparison:

- `Chats.tsx:503–510`: `Bubble` reads `profileById({ principal: m.sender })`,
  takes `a.data` when present, then calls `useAsset(author?.avatar?.id ?? null)`.
  Its quote query and reaction page are separate reads.
- `Chats.tsx:69–77`: `ChatRow` uses the same profile query and asset call,
  selecting the other DM principal instead of `m.sender`.
- `Feed.tsx:140–151`: `PostCard` also reads `profileById`; it can use the
  profile already joined by `social.global`/`social.home` as `authorProfile`.
- The profile schema has an ordinary optional `image` avatar, a public read
  rule and public sync. The uploaded image is placed on that profile through
  `placeAvatar`. A readable message is neither an additional asset grant nor
  a competing home. The bubble forwards a ready URL as `senderAvatarUri`, and
  the kit forwards it to `Avatar.uri`.

The unchanged Quarry and the same read/asset call resolve on all three client
paths. No evidence supports weakening authorization, adding observation grants,
changing cache identity or copying avatars onto message rows. Replacing a
profile avatar revokes its previous upload. Removing conversation membership
revokes private message media and does **not** revoke a public profile avatar.

## Reproduction

`asset-avatars.test.mjs` copies all seven `.q` files unchanged, starts a real
server, signs in three real accounts, uploads and places avatars through the
public APIs, and writes 20 DM messages, 20 group messages and 20 feed posts.
Real React in headless Chromium renders those three surfaces plus both inbox
rows. Assertions require `ready` **and** a loaded image with positive
`naturalWidth`, not merely a successful HTTP response. The final fixture uses
the original benchmark's 729-byte `avatar-alice.png` used by the builder's seed
for Alice and Carol. Earlier controls used a valid 68-byte PNG; both pass.

| Client/server | Online | Process | Wasm |
|---|---|---|---|
| Published `snapback4@0.4.8` + `snapback4-linux-x64@0.4.8` | 62/62 painted | 62/62 painted | 62/62 painted |
| This checkout's built public entries and binary | 62/62 painted | 62/62 painted | 62/62 painted |

Each count is DM 20, group 20, feed 20, inbox 2. Process uses the actual
`processDevice` over its JSON transport, bridged to Chromium's
`createLocalClient`/`SnapbackProvider`. Online and wasm use `createApp`;
wasm uses the normal IndexedDB device. No query, asset or authorization reply
is mocked. Published-package controls select the unpacked dist via
`AV_CLIENT_DIR` and its CLI via `SNAPBACK4_BIN`. Final controls additionally
pass replacement, revoked-id refusal, independent handles, one-view consumption,
private-media membership revocation and sign-out on every tier.

The separate `frozen-app.mjs` witness serves the supplied `dist-scale` Expo
export, replacing only its baked backend URL and adding a hook-state recorder
to the served JavaScript, without editing the app. Login uses the UI. The
archive omitted its wasm; the package's exact file restores it: its MD5 is
`a8d025c5f3a6835e5aa89f2c560f6f4a`, matching the baked asset filename. The
original avatar fixture paints 20/20 DM and 20/20 group images, then all 20
Global feed images plus the two inbox images. Hook traces include `ready`.
React Native Web's successful image root is itself a `DIV`, containing a
loaded `<img>` and `data-source-uri`; a DIV root alone cannot prove fallback.
This does not disprove the grader's original failure, whose runtime state is
unavailable. It does disprove a deterministic failure of the supplied pattern
on a newly seeded store. Frozen-export observation windows are five seconds;
the integration test waits for successful readiness, with a 15-second limit.
An additional frozen-export control disables the hook recorder entirely and
still paints every avatar (`frozen-app-no-recorder.log.gz`); the recorder is not
required to make the images render.

Evidence: `inputs.sha256`, `quarry.sha256`, `published-lifecycle.log.gz`,
`avatars-final.log.gz`, `frozen-app-original-avatar.log.gz` and the witness source.

## Proved defect and local change

`useAsset` previously returned its last state until a passive effect reset it.
A render with a new id or client could therefore commit the preceding ready
URL. Returning to an id after clearing it could similarly expose a revoked
handle. With a raw provider, sign-out did not itself cause the asset hook to
retire its existing handle.

The hook now ties a resolved outcome to one selection of client and id, and
the client's explicit signed-out boundary. It hides a mismatched outcome in
the render, releases old/late handles, and gives a signed-out non-null id an
actionable `E_AUTH` without fetching. `null` stays `empty`. Live raw clients
have one credential scope; app account changes replace the facade. An online
bearer may initially have an unknown `viewer()`: discovery is not sign-out and
must not trigger another fetch, especially for a one-view image. Going offline
also does not refetch a held handle.

The controlled React regression fails before the fix at “new id must not
commit the old ready URL” (`hook-before.log.gz`), then passes with the fix. It also
covers client replacement during a held response, id clear/reselection,
in-place sign-out, late cleanup and bearer viewer discovery. This is a
render-time handle ownership defect; it does **not** establish a cause for
permanent loading in d-02.

No core, wire, device, contract, cache, retry or asset authorization code changes.
One-view state remains server-owned and never cached or implicitly retried.
The governing decision is recorded in LLP 3000.008.002.000 §6. `guide media`
(the `assets` alias) now contains the DM/group author-avatar recipe and separate
profile-loading, empty and refusal states. The client reference links it.

## Verification

- Final focused React + avatar tests: **56 passed, 0 failed, 0 skipped**
  (`affected-final.log.gz`).
- Original-asset avatar integration alone: **4 passed, 0 failed**
  (`avatars-final.log.gz`). Published control: **4 passed, 0 failed**
  (`published-lifecycle.log.gz`).
- Frozen export + original avatar: **1 passed, 0 failed**
  (`frozen-app-original-avatar.log.gz`).
- Existing asset lists, Blob lifecycle and Expo storage tests:
  **72 passed, 0 failed, 1 skipped** (`asset-lifecycle.log.gz`). The skip needs
  macOS Foundation/AVFoundation; no native-platform qualification is claimed.
- Whole guide: **98 passed, 0 failed** (`guide-final.log.gz`).
- Package build/typecheck and syntax checks pass. `ref-check --verbose`:
  **523 LLP docs, 9,855 refs in 28,968 files, 0 errors, 0 unchecked**
  (`ref-check-final.log.gz`).
  Whitespace checks pass.

The single complete `scripts/test.sh` run exited 1 with this exact summary:

```text
== 2 failure(s) in 1380 s
   cargo test
   client tests
```

Rust totals: **4,297 passed, 2 failed, 33 ignored**. Client totals:
**4,564 passed, 3 failed, 10 skipped** (two failed cases and their parent).
The fixture wrapper passed **9/9**, and the final model stage passed **79/79**.
All other stages passed. The two Rust failures are our corrected guide draft;
the client failures are the baseline intermittent admission waits below. No
full-suite failure is assigned an environmental exemption. The existing
60-second suite target remains missed; no test count or timeout was reduced.
This is not a claim that the complete suite was green after the corrections:
only the affected tests and the entire guide were rerun.

Commands, from `snapback4/` after building the binary, wasm and package:

```sh
node --test packages/snapback4/test/react.test.mjs packages/snapback4/test/asset-avatars.test.mjs
AV_CLIENT_DIR="$PWD/target/av-published/package/dist" \
  SNAPBACK4_BIN="$PWD/target/av-published/linux/package/snapback4" \
  node --test packages/snapback4/test/asset-avatars.test.mjs
node --test reports/20260929-av-asset-resolution/frozen-app.mjs
AV_RECORD_HOOKS=0 node --test reports/20260929-av-asset-resolution/frozen-app.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Logs are preserved byte-for-byte as deterministic gzip files; read with
`gzip -dc <name>.log.gz`.

### Every failed diagnostic execution

Parent tests that repeat a child failure are not counted as separate causes.
The initial failed harnesses are retained, not presented as product failures.

| Evidence | Failed test(s) | Classification and resolution |
|---|---|---|
| `reproduce-main.log.gz` | `online`, `process`, `wasm` | Ours: missing Vite `react/jsx-dev-runtime` alias; fixed. |
| `reproduce-main-2.log.gz`, `reproduce-048.log.gz` | `process` in each | Ours: attempted browser `createApp` around a process bridge without browser admission ownership; used the supported process `createLocalClient` path instead, without inventing that capability. |
| `hook-before.log.gz` | `useAsset never commits a previous id, client or principal's handle` | Baseline: expected failing proof of the old-ready-URL defect; fixed. |
| `affected.log.gz` | `process`, `wasm` | Ours: reused Bob's session after the preceding online sign-out; each tier now logs in separately. |
| `guide.log.gz` | `every_card_compiles_clean` | Ours: new example's unbounded public sync emitted `N_NO_HORIZON`; added its explicit horizon. |
| `guide.log.gz` | `definitions::w11_every_registered_code_quotes_its_definition` | Ours: the recipe mentioned a refusal before its canonical definition; moved the recipe after serving semantics. |
| `test-sh.log.gz` | The same two guide tests above, in `cargo test` | Ours: the single full run compiled the first draft before the correction; the complete guide was rerun afterward and passed 98/98. The original full-run failures are retained. |
| `test-sh.log.gz` | `replacement after validation refuses the original orphan binding at the server (ordinary transport)` | Baseline intermittent: unchanged web-admission fixture, `page.waitForResponse` 5,000-ms timeout at line 1114; case 12,397.211 ms. Its app/web/auth dependencies do not load the changed React hook. Unchanged isolated rerun passes. |
| `test-sh.log.gz` | `replacement after validation refuses the original orphan binding at the server (exit transport)` | Baseline intermittent: same 5,000-ms wait, case 12,339.913 ms. The parent also counts as failed. Unchanged isolated rerun passes. |
| `frozen-app-3.log.gz`, `frozen-app-4.log.gz` | `frozen calibration app` in each | Environmental: supplied frozen export omitted wasm, so login could not open the device; restored exact published bytes after matching their filename hash. |
| `frozen-app-5.log.gz` | `frozen calibration app` | Ours: “Chats” locator matched a link and heading; selected the link. |
| `frozen-app-6.log.gz` | `frozen calibration app` | Ours: expected navigation/poll cancellations were mistakenly counted as page errors; retain transport observations separately. Images and hook states were already ready. |
| `frozen-app-final.log.gz` | `frozen calibration app` | Ours: selector omitted `sm-feed-author-avatar`; inspect the kit's actual avatar nodes. |

`frozen-app.log.gz` and `frozen-app-2.log.gz` were preliminary observations at the
login page (wrong baked URL/session setup and then missing wasm), with no
assertion of rendered avatars. Their passing exit status is **not** evidence
for asset readiness. Only the later asserted witnesses qualify the export.

The admission rerun passes **3/3** (two children and parent), with no timeout or
assertion change (`admission-failures-rerun.log.gz`). An earlier instance and
passing baseline/candidate controls are in
[Lane OK round 1](../20260928-ok-owner-key-coverage/ROUND1.md#failure-ledger).
The underlying timing cause is unconfirmed; these are not newly introduced
asset failures and are not silently excused as infrastructure. Follow-up:
[orphan response timeout ticket](../../../issues/closed/20260929-snapback4-orphan-binding-response-timeouts.md).

## Wasm and scope

Canonical `scripts/build-wasm.sh`: **2,040,529 B raw / 592,975 B gzip**, against
**593,719 B**, leaving **744 B**. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
The full suite rebuilds the same artifact. No ceiling changed and no wasm
source changed. Node is 24.13.1 on Linux with 96 available CPUs. The fleet
file named by the root instructions is absent on this host; all work stayed
in this isolated worktree with headless Chromium.

The provided app was treated as data and never edited. No remote messages,
pushes or publications were made. The commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
