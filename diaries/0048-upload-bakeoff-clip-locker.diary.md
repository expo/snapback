# Diary 0048 — Clip Locker backend bakeoff (LLP 0139 App C)

Large-video upload across six arms against the frozen checklist in
`demos/upload-bakeoff/clip-locker/README.md`. Author context, disclosed:
this session's forks built Snapback's asset pipeline this week — bias
runs toward Snapback; the frictions below are therefore the credible
part. Fixtures: 120,212,515-byte deterministic MP4 (testsrc2/x264,
faststart), 549 KB playable clip, and a GPS-tagged clip
(`location=+37.7749-122.4194/`, verified present via ffprobe).

## 2026-08-01 — snapback, round 1, PASS (with one real defect found)

### Environment
- This repo at the LLP 0139 freeze; sessions-mode server via the
  `cargo run` rung (dirty-worktree identity), official JS workspace
  packages; driver `snapback/run.mjs` with an instrumented fetch
  (PATCH byte accounting + one injected connection drop at ~50%).

### Milestones
- Boot (codegen → server → session mint): 26.3 s wall. Ceremony: one
  schema table, one `defineAssetUpload` intent, two mutations — the
  intent declaration reads like config and carries the whole policy
  (accept list, byte bound, delivery profile, location strip).
- 120 MB upload with kill at 58.7 MB → resume → ready: 17.4 s
  transfer wall total, 58 PATCHes.

### The headline numbers
- **Bytes re-transmitted after the drop: 0.** `patchBytesTotal` equals
  the file size exactly; TUS HEAD → offset → continue is byte-exact.
- Integrity: `end-to-end-verified` (per-chunk SHA-256 + whole-upload
  digest at finalize); downloaded digest == source digest.
- Range: real `206` with correct `content-range` (`bytes 100-4099/…`),
  suffix ranges honored, `cache-control: no-store, private` on the
  signed lane.
- Share link: headerless (pasteable) GET 200; after a 1.5 s TTL → 401;
  after delete: outstanding URL 404, new issuance 404.
- Deletion truth: referenced delete → 409 while the clip row held the
  reference; after clearing, delete 200 and everything dies at origin.
- **GPS: gone.** The strip-declared intent rewrote the geo clip
  (digest changed); ffprobe on the served bytes shows no location tags
  where the source carried `©xyz`-style `+37.7749-122.4194/`.

### What felt bad or frustrating (the real findings)
1. **Default-config uploads fail on the sessions lane** — the policy
   gate's 2 MiB body-inspection ceiling 413s the client's own 4 MiB
   default chunk (`SNAPBACK_VALUE_TOO_LARGE`, "request body exceeded
   the policy-gate inspection limit"), and the declared 8 MiB chunk
   fact is unreachable. First real 120 MB upload found what the
   64-byte-chunk conformance suite could not. Workaround: 2 MiB
   chunks. Filed: `issues/20260801-0044-policy-gate-caps-tus-chunks.md`.
2. **The failure shape was intermittently misleading**: same defect
   surfaced once as bare `fetch failed` (connection cut mid-stream) and
   once as the clean 413 diagnostic — racing the stream decides which
   you get.
3. Handler-surface guessability: `ctx.db.update` does not exist
   (`undefined is not a function` at runtime, not codegen); the
   spelling is `ctx.db.patch`. Cost five minutes; a codegen-time
   unknown-member check or a guide table would have cost zero.
4. The `saveClip`/`clearClip` ceremony (declared `writes:`, separate
   `handlers.mjs`, `source`/`exportName` indirection) is heavier than
   the intent declaration it sits next to; fine once known, opaque
   the first time.

### What felt good
- The intent-declaration model: privacy (`location: 'strip'`), delivery
  profile, and byte bounds are one visible declaration — nothing else
  in this bakeoff will put GPS stripping one line from the schema.
- `resumePersisted` is a real contract: kill the process state, hand
  back `{assetId, file}`, and it re-derives the offset from the server
  and finishes with the whole-upload digest still spanning every byte.
- Signed URLs dying at origin on delete (generation recomputation)
  gives revocation semantics the "signed URL" name usually lies about.

### Outcome
All nine checklist items pass; `snapback/results.json` carries the
receipts; limits recorded from the server-declared capability manifest
(4 GiB app quota, 8 MiB chunk fact — see finding 1, 6 h attempt TTL,
three delivery profiles, sha256, export facts).
