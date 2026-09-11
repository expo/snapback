# snapback2: abandoned uploads exhaust an account's asset staging quota with no published recovery path

**Date:** 2026-09-06 · **Area:** snapback2 assets (LLP 1006) / operator surface · **Source:** Clique full run, astra-snapback2 lane (diary "Continued session and final accumulated-state limitation", final report)

Distinct from `20260906-snapback2-owner-asset-staging-ceiling-refuses-reseeds.md` (the ceiling is
too small for the fixture pack). This ticket is about the ceiling being **unrecoverable**.

## What happened

Repeated proof runs accumulated failed and abandoned uploads against one persona's staging
allowance (the builder reports hitting a 20-object ceiling for that account). After that:

- media-dependent writes **timed out** on the client rather than refusing fast with a diagnostic;
  the intents never committed;
- a normal owner restart did not reclaim the abandoned staging objects;
- the published surface offers no discard, sweep, or list-staging verb, so the builder could not
  reclaim quota without editing internal storage (which it correctly refused to do);
- the lane therefore aborted final validation of four milestones (M1/M2/M5/M6) even though its
  historical receipts were green. Its words: "an operational recovery gap as well as a reminder
  that repeated proof attempts can create state a small initial build never reaches."

## Proposed

1. Sweep abandoned staging on owner start (anything staged but not attached within a TTL).
2. A published verb to list and discard staged objects for an account (`snapback2 data assets
   staging --discard` or equivalent), and a client-side discard for a failed upload.
3. A fast refusal with a stable code when staging is full instead of a write that never settles.
4. A test: fill staging with abandoned uploads, restart the owner, assert the quota is reclaimed.

## Resolution — 2026-09-06

Implemented authenticated `client.listUploads()` and `client.discardUpload(id)`
(`GET /api/uploads`, `POST /api/uploads/discard`) over the existing lifecycle
ledger. Listing survives restart and is scoped to the creator; disposal checks
creator and null locator in the writer transaction. Receiving files close before
quota release; running finalizers stay charged until their bytes close. Ready
assets release quota for the existing fork-aware sweep to remove blobs. Claimed ids
refuse `E_ASSET_IN_USE`; foreign and missing ids return the same answer.

Automatic File/native-source substitution now discards this call's uploads on
a definitive rejection or a failure before mutation submission. It preserves
queued intents and ambiguous responses, including a committed response that was
lost. Two-phase uploads remain explicitly owned by their caller. Caps and the
24-hour automatic grace period remain unchanged. Quota admission now checks
before reading the upload body and reports current usage with the recovery API;
`guide operator` documents it.

Proof: 24 actual refused File mutations leave zero usage; HTTP restart recovery
discovers and discards a full 20-object account without reset, preserving another
account's uploads; core tests cover disposal before finalize/claim and refusal
after claim; real clients retain queued media and reject disposal of an image
whose successful mutation response was lost.

Review corrections: pre-persistence outbox admission and prediction failures now
clean up without creating an intent or sending a mutation; an attempted storage
commit remains ambiguous. Cleanup 401 expires the session but preserves the
already settled rejection. Paused body cancellation closes/unlinks its staging
file under the same lock as writes, so late chunks cannot recreate it. The
sweeper retains active finalizers and their charges until physical release.
Focused regressions cover each case, including a storage acknowledgement lost
after an intent committed and three discarded uploads with sockets still paused.

Final review corrections: wire custody starts immediately before fetch, after
serialization and local checks; 24 cyclic-argument File mutations leave zero
staging usage and send no mutation. Terminal-result expiry follows automatic
discard; superseded terminal receipts still invalidate their captured token,
without clearing a successor's custody. Failed finalizer deletion returns its path
to shared custody, retaining quota until disposal or the grace sweep can retry
after permissions are repaired. A failed staging unlink stays pending without
stopping the writer or blocking sibling reclamation; explicit disposal continues
to report its I/O refusal.

Integration review corrections: the discard deadline now races the complete
operation, so a fetch or body that ignores abort cannot pin a tracked mutation
or its auth transition. The owner-shaped mutation HTTP 401 defers current-token
expiry until cleanup, while superseded terminal evidence still clears only
captured custody. First-upload HTTP 401 also expires custody, including explicit
uploads; late cancelled cleanup never changes the successor snapshot or token.

Integration follow-up: fetch and XHR parse upload HTTP 401 before authority
suppression; failed overlapping login cannot restore the invalid bearer, and a
completed successor remains untouched. The shared raw asset response boundary
also fences refused and successful body completion. Terminal expiry cancels
sibling outbox waits while preserving the originating refusal and durable intent.

The byte-delivery follow-up fences the complete Blob-to-ArrayBuffer conversion,
including the no-cache/bypassed-cache return, and supplies the same authority plus
cancellation guard to cache hits, admission, and final lease reads. A successor
login or abort during any of those waits suppresses public delivery.

FIFO session death now propagates before a new mutation acquires outbox custody,
matching the post-enqueue guard. Replay and log-tail regressions preserve the
original terminal, seal custody, and recover only the older exact envelope once.
The optional sibling-abort/seal diagnostic race remains nonblocking: a secondary
cancelled call may see the sealed carrier refusal, while its accepted intent
stays durable. The ordinary FIFO stop policy is retained so an offline cut can
still queue new work; this fix changes originating terminal evidence only.


The typed-terminal audit shares JSON expiry and delivery fencing between HTTP
401 and supported HTTP 200 terminal receipts. Replay and log-tail receipts now
stop before ordinary settlement; resume receipts stop before renewed trust.
Expiry releases sibling waiters and seals the exact queued envelope for login
recovery. Direct mutation/channel receipts retain their typed public result,
and automatic upload cleanup retains its earlier bearer and ordering. Existing
cancellation and captured-successor fences apply before terminal interpretation.
Five added cases cover first replay/tail with sibling drains, FIFO admission, and
resume recovery; ordinary rejections still settle only their own intent.

## Historical duplicate fragment retained — filed 2026-09-07

The following was later found as a same-name open fragment. It is preserved here
verbatim rather than replacing or truncating this record:

> ## Mechanism, from the independent grade of the astra-snapback2 lane (2026-09-07, blocker d-01)
>
> The grader reproduced the exhaustion and isolated it to **retries**: 26 distinct uploads are fine,
> but the same media send retried with an identical client mutation id fails on the seventh retry
> with `E_ASSET_TOO_LARGE: the owner has reached the 536870912 byte or 40 object staging ceiling`,
> after which ordinary media sends fail for every account on the instance while text sends still
> commit. Cause: the app stages the upload, then calls a mutation whose idempotent early return
> (`if exists messages[id]: return { id }`, and the same shape on the intents table) never attaches
> the staged object, and nothing releases an unattached staged object at commit or later. A backend
> restart does not clear it. The lane's own view-once path re-uploads once per conversation member,
> which multiplies the leak.
>
> So the platform-side fix is narrower than a sweep verb: **a staged object that the committing
> mutation did not attach must be released at commit** (or at least be subject to a short TTL), and
> the idempotent-retry recipe in the guide must say that a retry re-stages nothing. The sweep and
> discard verbs above remain the recovery path for state that already leaked.

## Duplicate reconciliation — 2026-09-11

**Status:** Closed — duplicate scope resolved by the implementation already recorded above.
**Priority:** Resolved.

Commit `67a082084` implemented transaction-bound discard of caller-owned staged
arguments that a successful mutation did not attach. Fresh BLACK verification at
`15c134d056` ran the exact retry regression:

```text
cargo test -p snapback2-core --test assets pending::seven_retried_photo_sends_discard_both_charges_at_commit -- --exact --nocapture
# 1 passed; 35 filtered out; 0.01s; exit 0
```

That test covers seven identical sends, discard of both charges at commit, and one
attached asset. The same-name open fragment is removed as an explicit duplicate; its
additional evidence remains above. Physical cleanup failure accounting is not folded
into this closure and remains in `20260906-snapback2-asset-custody-gc-follow-up.md`.
