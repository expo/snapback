# Clip Locker — Snapback round-2 build log (fresh-context builder)

Builder: fresh-context agent (Claude Fable 5), no round-1 context.
Arm dir created: 2026-08-01 15:52:35 PDT (epoch 1785624755). All T+ marks
are wall-clock from that instant.

## Milestones

- T+0:00 — arm dir created; read clip-locker/README.md (checklist) and
  guide/index.md.
- T+0:00→~3:00 — guide reading: index → backend/assets → your-first-backend
  → the-authoring-loop → clients/headless → auth/sessions-and-principals →
  testing/acceptance; then the guide-named package surface
  (`@expo/snapback-client/assets` .d.mts + .mjs), the guide-named
  conformance/example apps (party-wall headless suite = the sessions+assets
  template), and the kit shim.
- T+4:16 — first codegen attempt (failed, stumble 1).
- T+4:32 — **first successful codegen** (after location-policy fix).
- T+4:40 — fixture generation started (shared make-fixtures.sh, ffmpeg);
  finished ~T+5:00 (clip-120mb.mp4 = 120,212,515 bytes).
- T+7:55 — first driver run (**first server boot** inside it, ready ~T+8:24
  after the 29 s cargo rung; 2/9 checks green on first contact — items 4
  and 5, i.e. ranged strict delivery and the whole signed-URL story worked
  on the first try).
- T+9:43 — second driver run; **first successful ~120 MB upload** ready at
  ~T+10:05 (12.9 s transfer, 29 PATCHes, defaults untouched).
- T+12:00 — third driver run; **9/9 PASS at T+13:08** (evidence.json
  written). Remaining time was log-writing.

## Headline: defaults vs a 120 MB file

Defaults survived contact completely. The packaged client's default 4 MiB
chunk is *narrower* than the server's advertised 8 MiB ceiling
(`transfer.maxChunkBytes` in the attempt-create response,
`Snapback-Max-Chunk-Bytes: 8388608` on every TUS response), so nothing was
tuned, nothing 413'd, no timeout fired: 120,212,515 bytes → 29 checksummed
PATCHes → finalize → `ready`, integrityGrade `end-to-end-verified`, in
12.9 s on loopback. The interrupted transfer resumed from the server's
HEAD-acknowledged offset and re-transmitted exactly the unacknowledged
remainder (57,297,955 of 120,212,515 bytes).

## Stumbles (verbatim, as hit)

**Stumble 1 (T+4:16, codegen refusal).** Video intents refuse without an
explicit location policy, and `strip` is not admissible for video, so
`retain` is forced:

```
[error] SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED (asset) clipUpload: media types video/mp4 carry location metadata; declare image.location ('strip' or 'retain') — omission refuses at generation, there is no implicit fallback
[error] SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED (asset) shareClipUpload: media types video/mp4 carry location metadata; declare image.location ('strip' or 'retain') — omission refuses at generation, there is no implicit fallback
codegen failed: no artifacts written (no silent stale output).
```

The fix is `image: { location: 'retain' }` on a *video* intent — the block
being named `image` for a video policy is itself a small surprise. This is
the checklist item-7 story in one diagnostic: retain is the only choice,
GPS survives by design.

**Stumble 2 (T+7:55, first driver run).** `assets.start({ upload:
'clipUpload' ... })` — the string-intent form the client's own
`intentIdentity()` documents ("or its intent name") — is refused
server-side:

```
{"diagnostic":{"code":"SNAPBACK_REQUEST_JSON_INVALID","severity":"error","subsystem":"server","message":"request body was not valid JSON for this operation","details":{"error":"Failed to deserialize the JSON body into the target type: intentPolicyHash: invalid type: null, expected a string at line 1 column 48"}}}
```

The client serializes `intentPolicyHash: null` for a string intent and the
server's DTO requires a string. The generated `api.clipUpload` reference
works. The client accepts a surface the server rejects — a seam mismatch.

**Stumble 3 (T+7:55, first driver run).** My item-7 probe assumed the
ffmpeg `-metadata location=` tag would be a raw ISO6709 string in the MP4
bytes; ffmpeg actually writes a binary 3GPP `loci`/udta atom, so
`grep 37.7749 clip-geo.mp4` finds nothing while
`ffprobe -show_format` reports `TAG:location=+37.7749-122.4194/`. Driver
bug, not a Snapback bug; switched the probe to ffprobe.

**Observation (T+7:55, not a failure).** First server boot inside the
driver printed:

```
prebuilt /Users/ccheever/projects/snapback-0044-l1/target/debug/snapback skipped: this checkout is dirty or has no committed identity to verify it against; using the source-tree `cargo run` rung (LLP 0030 ladder)
spawned snapback binary identity: unpinned-binary
```

so the boot took ~29 s (cargo run rung) instead of launching the existing
debug binary. Honest provenance discipline, but it costs half a minute per
suite run in a dirty checkout and there is no documented way to say "I
accept this dirty checkout's binary".

**Stumble 4 (T+~11:30, second driver run).** I asserted metadata 404s
after a successful `DELETE /assets/records/{id}` — it doesn't:

```
✗ 6. deletion truth — refusal while referenced, then real deletion
    metadata gone, got 200
```

The actual deletion truth (recorded in evidence.json): delivery bytes 404
on the immediately following request; the metadata record stays readable
(200) as a tombstone with `availability: "deleted"`, and survives even an
operator `asset.gcSweep` (tombstoneRetentionMs is 7 days by manifest).
Driver expectation bug, but the tombstone-lingers behavior is a real
provider fact a builder must learn from probing, not from the assets page.

**Stumble 5 — the big one (T+~12:30). The guide's strip-video claim is
stale against the server it ships with.** The assets guide page says,
verbatim:

> A `location: "strip"` **image** intent admits and publishes here; a
> strip-declared **video** intent still refuses at generation everywhere
> (`asset-video-finalization` is a declared Missing nonclaim).

I therefore authored `image: { location: 'retain' }` (and stumble 1's
codegen diagnostic — which, notably, offered `'strip' or 'retain'` for
video/mp4 — was the first hint the prose might be wrong). My mitigation
probe then found: a strip-declared video intent **generates cleanly (exit
0), uploads, publishes `ready`, and actually strips the GPS atom** — the
served clip-geo.mp4 has no `location` tag (ffprobe-verified) and a new
canonical digest, and the capability manifest declares
`asset_video_finalization_v1` with `video/mp4` + `video/quicktime`
formats. So the mitigation the checklist asks about *exists and works*,
and the guide denies it. Had I trusted the guide alone (no probe), item 7
would have been recorded wrong.

## Ceremony ledger (distinct concepts)

From zero to first stored 120 MB object (checklist item 1): **17**
distinct concepts —

1. `defineSchema`/`defineTable` + `v.*` validators
2. `.sync()` declaration
3. `.index()` declaration
4. `auth: { mode: 'sessions' }` schema config
5. `defineAssetUpload` intent (accept / delivery / access / authorize)
6. `image.location` policy (required on a *video* intent, under the name
   `image`)
7. `v.assetRef({ upload })` typed reference field
8. `.assetSharing(...)` declaration
9. inline `defineJsMutation` + declared `writes` + `results.*` contract
10. `ctx.assets.attach`
11. declarative `defineQuery` (`eq`/`authUserId`/`index`)
12. codegen invocation + generated-artifact custody (commit the review
    manifest, not the cache)
13. generated `api.*` references (required in practice — see stumble 2)
14. `startServer` kit + the sessions startup-artifacts carrier
15. admin token + impersonation capability (two carriers) for the test
    mailbox persona mint
16. `AuthCoordinator` + custody storage (from `@expo/snapback-contract`) +
    `authRequestCode`/`authExchange` + `authorityCapture` on mutate
17. `createAssetClient` task lifecycle (`start`/`done`/`subscribe`)

The full nine-item checklist added **8** more: 18. `AssetTaskStore`
interface (file-backed impl for cross-process resume), 19.
`resumePersisted`, 20. `createExternalSessionClient` bearer custody (child
processes), 21. strict-delivery routes + HTTP ranges, 22. signed-URL mint
route (`POST .../signed-url`, ttlMs), 23. `DELETE /assets/records/{id}` +
referenced-409 + tombstone semantics, 24. host-ops (`asset.gcSweep`,
`SNAPBACK_ASSET_RUNNER_DISABLED`), 25. capability manifest as the limits
oracle. (Harness concepts `createSuite`/`runAcceptance` excluded as
measurement scaffolding, as is the `x-snapback-auth-client-protocol`
header — the packaged client owns it; my raw probes only repeated it.)

**Total: 25 distinct concepts** for the whole app + driver.

## Package surface used

Workspace packages (source checkout), not the published 0.1.8 closure:
`packages/snapback-client` (`@expo/snapback-client` 0.1.0 workspace) root +
`/assets` entries, `packages/snapback-contract` (AuthCoordinator),
`packages/snapback-codegen` via `demos/_kit/define.mjs` shim + direct
codegen invocation, and the `demos/_kit` harness/server-process kit.
Server: source tree via the `cargo` resolver rung (the prebuilt
`target/debug/snapback` was skipped as unverifiable in a dirty checkout —
see the observation above), identity verdict `unpinned-binary`.

## Wall-clock summary

| Milestone | T+ |
| --- | --- |
| Arm dir created, guide reading starts | 0:00 |
| First codegen (failed, location policy) | 4:16 |
| First successful codegen | 4:32 |
| Fixtures generated (120,212,515-byte MP4) | ~5:00 |
| First server boot | ~8:24 |
| First successful 120 MB upload | ~10:05 |
| 9/9 checklist PASS, evidence.json written | 13:08 |

Post-pass time was spent on this log and the commit — the measured
build-to-green is **13 minutes 8 seconds** from an empty directory,
including all guide reading.

## Evidence table (the nine frozen items)

| # | Item | Result | Evidence (evidence.json) |
| --- | --- | --- | --- |
| 1 | Big upload | **PASS** | 120,212,515 bytes → ready in 12.9 s at pure client defaults; 29 TUS PATCHes (4 MiB default chunk, server ceiling 8 MiB), 31 requests total, 120,212,900 body bytes (385 bytes JSON overhead) |
| 2 | Kill at ~50% → resume | **PASS** | process killed at acked offset 62,914,560 (52.3%); resume HEAD reported 62,914,560; **re-transmitted 57,297,955 bytes** (exactly the remainder; full re-send would be 120,212,515; 62,914,560 bytes saved); asset id stable across the kill |
| 3 | Integrity | **PASS** | server digest == full-download digest == source sha256 `6f821fe4…`, integrityGrade `end-to-end-verified` |
| 4 | Seekable playback | **PASS** | three ranged GETs on strict delivery all 206 with exact `Content-Range` (`bytes 0-1023/549153` etc.), `Accept-Ranges: bytes`, `Cache-Control: no-store, private` |
| 5 | Share link | **PASS** | private-signed mint 200 → URL serves a completely bare fetch (no session, no headers) 200; after 4 s TTL → 401; after asset deletion → 404; strict-intent issuance refused 422 |
| 6 | Deletion truth | **PASS** | referenced DELETE → 409; after reference row removed → DELETE 200; bytes 404 immediately; metadata lingers 200 as `availability: "deleted"` tombstone (7-day retention, survives gcSweep); dedup sibling asset with identical bytes still serves 206 |
| 7 | Video metadata privacy | **PASS** | default (retain): GPS `+37.7749-122.4194/` survives byte-identically to consumers; mitigation: strip-video **works** (publishes ready, ffprobe shows no location tag) despite the guide claiming it refuses — guide-stale finding |
| 8 | Limits honesty | **PASS** | manifest: maxChunkBytes 8 MiB, app quota 4 GiB, attempt TTL 6 h, ≤8 open attempts/principal, signed-URL TTL default 15 m / max 24 h, video maxParseBytes 256 MiB, missing: byte-backup, custom read authorizers, deferred length; no pricing cliff (self-hosted local; hosted reports assets Missing) |
| 9 | Ledger | **PASS** | this log + evidence.json (milestones, per-request byte ledger in tmp reports during runs) |
