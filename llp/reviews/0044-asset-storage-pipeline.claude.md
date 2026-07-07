# Review: LLP 0044 — Asset storage pipeline

**Reviewed:** `llp/0044-asset-storage-pipeline.rfc.md` (working-tree revision, 2026-07-07 draft)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Fable 5
**Date:** 2026-07-07
**Redacted:** No — reviewed locally; nothing sent beyond the model serving this
session.
**Method:** Single-session independent read, verified against LLP 0009,
LLP 0028 (execution classes), LLP 0036 (grant model), and `src/manifest.rs`
(the `assets` gap and `asset_upload: false` are real manifest facts).
Same-family sub-agent passes assisted verification; this artifact is **one**
family's review.

> **Independence (LLP 0005).** Draft authored by Charlie Cheever / Codex
> (GPT-family); genuine cross-family review.

## Overall assessment

A sound, appropriately modest first asset design: metadata-in-app-data,
bytes-outside-rows, upload sessions with authorization, and "a signed URL is a
transport artifact, not the source of permission truth" are all consistent
with the root design and 0009's host-mediated posture. The main defect is a
silent dependency: "Processing jobs use the cron/action/background-work model
where available" — **there is no background-work model.** LLP 0028 defines
schedule-driven cron and invoke-driven actions; neither is an on-demand durable
job queue, and nothing today durably enqueues "process asset X after upload."
The honest v1 is a cron sweep over pending-state asset rows (`WhileLive` +
`NoOverlap` — pure 0028 machinery); a durable work queue is a later subsystem
no LLP owns yet. The RFC should say which one it means.

## Strengths

- The data model (checksum, upload state, processing state, owner principal)
  is complete enough to be buildable and small enough to review.
- The byte-store interface explicitly surfacing target differences (direct vs
  proxied upload, immutability, delete semantics, read-back) is the capability-
  honesty pattern applied correctly to a new subsystem.
- Non-goals cleanly excise the classic scope-creep (CDN, transcoding,
  scanning, billing).

## Concerns

1. **[HIGH] The processing runner rests on an unbuilt, unnamed subsystem**
   (see above). *Resolves with:* naming the cron-sweep as the first
   implementation and the durable queue as explicit future work.
2. **[MEDIUM] Upload-session lifecycle is half-specified:** nothing covers
   abandoned sessions — pending-state expiry, garbage collection of reserved
   ids and partial bytes, and re-request semantics.
3. **[MEDIUM] No size/quota story:** per-asset size limits and per-app storage
   quota are absent even as capability facts, and LLP 0047's invocation limits
   don't cover storage. At minimum name them as manifest-reported limits
   (`Enforced`/`Advisory`/`Missing`).
4. **[LOW] The signing key for signed URLs has no stated custody:** it is
   instance/system-owned material, not an app-declared LLP 0036 entry (0036's
   grant unit is the function); one sentence on where it lives and how it
   rotates closes the gap.
5. **[LOW] Missing Related links:** LLP 0028 (the processing model it invokes)
   and LLP 0039 (the auth model it authorizes through).

## Suggestions

- The first open question (system tables vs app tables for metadata) would
  benefit from stating the default the acceptance criteria already imply
  (system-owned metadata + app-visible reference), leaving only the exposure
  mechanism open.

## Recommended next step

Revise and stay `Draft`. One structural fix (processing model), two lifecycle
additions; the rest is linkage.

## Revisions applied (2026-07-07, at the author's request)

Applied to the draft: processing section rewritten around the cron-sweep v1
with the durable queue named as unowned future work (concern 1);
upload-session expiry/GC (concern 2); size/quota as manifest-reported limits
(concern 3); signing-key custody sentence (concern 4); Related links added
(concern 5). Status left untouched.
