# Build log — faceplate/snapback-r2 (fresh-context round-2 builder)

Wall clock start: 2026-08-01 15:22:26 PDT (epoch 1785622946), at arm-dir creation.

Format: timestamped entries, stumbles recorded verbatim as they happen.

## 15:22 — orientation

Read `demos/upload-bakeoff/faceplate/README.md` (checklist) and
`guide/index.md`. Plan: read `getting-started/your-first-backend.md`,
`backend/assets.md`, `auth/sessions-and-principals.md`,
`clients/headless.md`, then decide the package surface.

## 15:23 — guide reading

The assets page (`guide/backend/assets.md`) lists `demos/party-wall` as its
example and the auth page transcludes `demos/party-wall/tests/acceptance/
headless.mjs` verbatim (the "complete local recipe" for minting personas), so
I read that demo's `schema.mjs`, `functions.mjs`, and headless suite as
guide-designated documentation. That suite is the single most valuable
artifact I found: it shows the sessions-server boot via `startupArtifacts`
carrier (avoiding the dev→sessions restart dance), the mailbox persona mint,
`SnapbackAssetClient(client).start({ upload, file })`, mutation calls with
`authorityCapture`, and authorized byte fetches with
`authorization: Bearer` + `x-snapback-auth-client-protocol: 1`.

**Package surface decision: workspace packages** (repo-relative imports of
`packages/snapback-client`, `packages/snapback-contract`,
`packages/snapback-codegen` + the `demos/_kit` shims), not published 0.1.8.
Why: I am building inside the repo worktree; every guide-linked example and
transcluded snippet imports the workspace paths; the server-lifecycle kit
(`demos/_kit/server-process.mjs`) is workspace-only; nothing in my headless
arm needs a registry install.

## 15:25 — STUMBLE 1 (self-inflicted path slip)

Command:
`node demos/upload-bakeoff/faceplate/snapback-r2/fixtures/../../_shared/gps-jpeg.mjs`
Diagnostic (verbatim):
```
Error: Cannot find module '/Users/ccheever/projects/snapback-0044-l1/demos/upload-bakeoff/faceplate/_shared/gps-jpeg.mjs'
  code: 'MODULE_NOT_FOUND'
```
What happened: `_shared` lives at `demos/upload-bakeoff/_shared`, one level
above `faceplate/`; my relative path resolved into `faceplate/_shared`. Also
broke the `&&` chain so codegen never ran on that invocation (the
`codegen exit: 1` echoed was the module error's exit, a misleading readout I
noticed only because codegen printed no output). Fixed the path; instrument
prints `fixture bytes: 914 hasGpsExif(fixture): true hasGpsExif(plain): false`.
Not a Snapback defect.

## 15:26 — MILESTONE: first successful codegen (elapsed 3m47s)

`node packages/snapback-codegen/index.mjs demos/upload-bakeoff/faceplate/snapback-r2/backend`
→ exit 0, first attempt:
```
Codegen summary for snapback-r2
  tables 1; operations 2 (query 1, live query 0, mutation 1, action 0); live 0; ephemeral 0
  files 18 (review manifest 1, consumer committed 0, ignored cache 17); warnings 0
```
Backend: 1 table (`profiles` with `v.assetRef({upload:'avatarUpload'})`,
`assetSharing public-read`, sessions mode), `avatarUpload` intent
(image/png+jpeg, `private-strict`, `via-references`, `location: 'strip'`,
required 64px thumb), declarative `getProfile`, inline-JS `setAvatar` upsert
using `ctx.assets.attach`. Notable: codegen named the app `snapback-r2`
(walked up past my `backend/` dir for the app name) — harmless here.

## 15:31 — STUMBLE 2: server launch refused on identity verification

First driver run. Command:
`node demos/upload-bakeoff/faceplate/snapback-r2/run.mjs`
Diagnostics (verbatim, abridged to the operative lines):
```
prebuilt /Users/ccheever/projects/snapback-0044-l1/target/debug/snapback skipped: this checkout is dirty or has no committed identity to verify it against; using the source-tree `cargo run` rung (LLP 0030 ladder)
Error: spawned server identity verification failed: health commit c78d7f7a69fc7349fbbe4b2422a05cfe0e6a77af does not match checkout 786a771f229e22aedcd90395348075dec1f99e3c
  diagnostic: { code: 'SNAPBACK_SERVER_LAUNCH_FAILED' }
  recovery: {
    repairCommand: '/Users/ccheever/projects/snapback-0044-l1/scripts/bootstrap-ibex-runtime',
    overrideCommand: 'SNAPBACK_SERVER_BINARY="/Users/ccheever/projects/snapback-0044-l1/target/debug/snapback"'
  }
```
What happened: my worktree is dirty (my own new files), so the kit refused
to trust `target/debug/snapback` implicitly, fell to the `cargo` rung, and
the cargo-launched... no — the RUNTIME RECOVERY record shows the cargo rung
*also* resolved to the same stale binary whose `/health` build stamp names a
different commit than HEAD. Diagnostics quality: genuinely good — the
machine-readable recovery record hands you the exact override env var.
What I did: took the printed `overrideCommand` verbatim
(`SNAPBACK_SERVER_BINARY=.../target/debug/snapback`), which is the explicit
caller-configured rung. Rebuilding via cargo would cost many minutes and the
binary is today's build.

## 15:30 — first successful driver run: 8/8 PASS (elapsed 7m40s)

With the override, the driver ran green end to end on its first executed
attempt: boot, two personas, upload→attach→serve, cross-user view, GPS
strip, replacement, lifecycle, signed-out probe. The kit printed
`spawned snapback binary identity: unpinned-binary` — an honest posture
label for the override rung.

## 15:31 — STUMBLE 3 (self-inflicted): item-6 evidence conflation

My first driver issued the explicit `DELETE` *before* the GC sweep, so the
sweep reported `referenceReclaimed=0` and the final 404 was my own delete,
not GC — the "orphaned?" question got a muddy answer. Reordered the checks
(fetch → sweep → fetch → delete → fetch) and reran; second run green with
clean evidence. Driver-logic mistake, not a platform defect, but note the
measurement lesson: the lifecycle has enough distinct actors (references,
GC, explicit delete) that evidence ordering matters.

## 15:32 — MILESTONES (wall clock from arm-dir creation 15:22:26)

| Milestone | Clock | Elapsed |
| --- | --- | --- |
| Arm directory created, log started | 15:22:26 | 0:00 |
| First successful codegen (first attempt) | 15:26:13 | 3:47 |
| First successful server boot | 15:30:06 | 7:40 |
| Checklist item 2 passing | 15:30:06 | 7:40 |
| Final rerun (clean item-6 evidence) 8/8 PASS | 15:30:36 | 8:10 |
| Completion (log finalized) | ~15:33 | ~10:30 |

Reading time before touching the keyboard is inside the 3:47: the guide
index, four guide pages, and the party-wall demo.

## Ceremony count: 18 distinct concepts to get item 2 passing

1. Backend dir convention (`schema.mjs`/`functions.mjs`/`seed.json`) + the
   codegen CLI invocation
2. `defineSchema`/`defineTable` + the `v.*` validator vocabulary
3. `auth: { mode: 'sessions' }` schema config
4. `v.assetRef({ upload })` typed reference field
5. `assetSharing` (row-visibility-derived asset read authority)
6. `defineAssetUpload` intent (accept / delivery / access / authorize)
7. Mandatory image `location` policy (`'strip'`) + declared variants
8. Inline-JS mutation form (`defineJsMutation`: args/writes/result/handler)
   + `results.*` contracts
9. `ctx.db` builder surface + `ctx.auth.userId`
10. `ctx.assets.attach` admission
11. `_kit` `startServer` lifecycle (ready file, OS-assigned port,
    adminToken) + the LLP 0030 resolver ladder and
    `SNAPBACK_SERVER_BINARY` override
12. Startup-artifacts carrier (`{formatVersion:1, schema, functions}`) to
    boot a sessions app without the dev→sessions restart
13. `AuthCoordinator` + memory custody storage (`snapback-contract`)
14. `SnapbackClient` construction options (auth protocols ×3,
    `clientStoreId`)
15. Email-code flow + dual-gated test mailbox (admin token +
    impersonation capability, `captureImpersonationCapability`)
16. `authorityCapture: coordinator.capture()` on mutations
17. `SnapbackAssetClient.start` upload task + the File-shim shape
    (`{name, size, slice().arrayBuffer()}`) + `task.done`
18. Asset delivery routes + bearer carriage
    (`/assets/records/{id}/bytes/{variant}`, `authorization: Bearer` +
    `x-snapback-auth-client-protocol: 1`)

## Package surface

Workspace packages (repo-relative `packages/snapback-client`,
`packages/snapback-contract`, `packages/snapback-codegen`, `demos/_kit`
shims), not published 0.1.8 — building inside the repo worktree where every
guide-linked example imports these paths, and the server-lifecycle kit is
workspace-only.

## Recorded findings (per checklist)

- **Identity posture (1):** sessions mode; email-code sign-in; the test
  mailbox read requires two local-only carriers (admin token +
  impersonation capability). Real principals, zero third-party setup.
- **GPS (4):** location metadata does NOT serve back —
  `hasGpsExif(served)=false` under the *mandatory* `image.location`
  declaration (omission refuses at generation). Far from "never mentions
  EXIF": the provider forces the author to choose a location policy.
- **Cache (5):** `Cache-Control: no-store, private` on private-strict
  bytes; replacement is immediately visible to B (per-request re-auth, no
  shared cache to invalidate).
- **Old avatar (6):** orphaned after replacement; still owner-fetchable by
  URL; an app-wide `asset.gcSweep` at +25h reclaimed 0 (this app declared
  no `assets.referenceGc` policy — unreferenced assets persist until
  explicit delete or a declared GC grace); explicit DELETE then 200
  (`availability: "deleted"`) and bytes 404.
- **Signed-out (7):** bare fetch = 400
  `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` (no protocol offer);
  anonymous fetch with the protocol offer = 403. Matches the documented
  private-strict default (every request re-authorizes). Consequence: a
  sessions-mode avatar URL is not pasteable into a plain `<img src>`.
