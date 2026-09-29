I'll review the deferred-admission change read-only: the prompt, the report, and the diff from `b7d05ba` to `2ccdf26ba`, then check whether a write can go to the wrong store, be duplicated, or stay stuck.The report claims deferred custody before store identity. Next I’ll read the admission path itself and the tests that are supposed to pin wrong-store, duplicate, and stuck-form cases.The handoff stores writes before `store_id` exists. I’ll trace how that captured identity is checked against the store that later identifies.Auto-compacting conversation (80% full)...
Conversation compacted.
The review is ready to close. I’ll confirm the exact lines for the store-binding path, then write the verdict.The calibration stuck-save is fixed, and deferred custody does not double-send, reorder, or drop a write across reload. It is not safe to land: on the web, a click made after the first sync page can be executed on a replacement incarnation.

## What is sound

A ready web or worker client (backend fingerprint loaded, `device:store_id` still unset, no staged transfer id yet) no longer refuses with `E_ADMISSION`. `AdmissionJournal.capture` writes the original id, arguments, minted row ids, and order to `localStorage` before `mutate`'s first await (`web-journal.ts:202`). Promotion into the device outbox happens only in `IdentityAdmissions.queued` (`identity-admission.ts:97`).

These properties hold:

- **Not sent twice.** If the process dies after the outbox insert and before `admitted: true`, the next `queued()` reuses the existing outbox row by id (`identity-admission.ts:119-122`). A later `queued()` drops metadata once that row is gone (`identity-admission.ts:129`).
- **Not reordered.** The sender stops at `admission_waiting` instead of skipping the head (`local.ts:1096`). A direct `op: "admit"` runs only when the store is known and nothing is still deferred (`identity-admission.ts:80`).
- **Not lost across reload.** Capture is synchronous. Timeout and store refusals are stored on the record and replay as the same refusal without a resend (`identity-admission.ts:105-110`).
- **Prediction and authorization are not opened early.** The deferred view is `predictable: false` (`identity-admission.ts:68`). The device predicts only when that flag is set and the program is a mutation (`device.rs:1049-1052`). Ephemeral and non-mutation ops never enter deferred custody (`identity-admission.ts:85-86`).
- **`E_ID_REUSED` is unchanged.** The server still compares principal, operation name, and the canonical args digest, not `new_ids` (`store.rs:1058-1067`). Local `sameInput` matches that and also refuses a different viewer before send (`identity-admission.ts:35-38`).
- **Native binding prefers `/schema`.** `expectedStore ?? transfer_store_id` (`identity-admission.ts:92`). A cross-process adopt between that check and the SQLite insert is refused inside `require_admission_identity` (`device.rs:1158`).
- **The mounted form is no longer stuck on the old path.** While `admission_waiting` is set, `usePendingWrites` reports `queued` / "waiting for backend identification" (`pending-writes.ts:32`, `local.ts:1246`). `onWrite` stays terminal. Timeout, fingerprint mismatch, restore refusal, and a real store mismatch settle `E_ADMISSION_TIMEOUT` or `E_ADMISSION_STORE` with a public "new attempt" message (`identity-admission.ts:10-14`). Both codes are in the writes guide (`guide/why/E_ADMISSION.md:14-24`, `guide/codes.rs:89-90`). The online app journal commits the intent before `identifyDispatch` (`app-online.ts:155-176`).

The pre-ready refusal "the backend has not loaded; reopen the client before writing" (`web-journal.ts:209`) is still synchronous `E_ADMISSION`. It drops the id reservation, so the same id can be retried. That is not the calibration case.

## Findings

### High — a web click after the first sync page is sent to the replacement store

`snapback4/packages/snapback4/src/web-journal.ts:213`

```213:213:snapback4/packages/snapback4/src/web-journal.ts
      const identity = this.storeId ? undefined : { backend: this.backendId!, store: this.transferId ?? (typeof request.expected_store === "string" ? request.expected_store : undefined), deadline: Date.now() + IDENTITY_WAIT_MS };
```

`/schema`'s store id is `expected_store` (`local.ts:1230`). Capture keeps it only when `transferId` is unset. The captured identity is what `admit` stores; the later `expected_store` argument is ignored once `identity` is present (`web.ts:384`, `identity-admission.ts:92`).

`transferId` is set while `device:store_id` is still unset. The first `observe_store` on a fresh device stages `device:deferred:identity` and does not publish the store (`store_identity.rs:162-168`). The first sync request is a snapshot (`local.ts:599-604`), and a snapshot page returns before publication (`device.rs:820-824`; publication is the `publish_first` observe at `device.rs:828`). That gap is the whole initial snapshot, not one turn. `remember` copies the staged id into `transferId` (`web-journal.ts:130`) as soon as that first page commits.

**Failing scenario.** `/schema` returns store `A` at the current generation. The store is replaced with incarnation `B` (same schema, programs, and generation, so the backend fingerprint matches). The client starts sync. The first page names `B`; observation stages `B` and leaves `device:store_id` empty. The user saves the profile during that snapshot. Capture binds the write to `B` and drops `A`. Publication then sets the store to `B`. `queued()` compares `B` with `B` (`identity-admission.ts:106-110`), admits, and `POST`s to `B` (`local.ts:1116`). The mutation runs on the replacement. LLP §20.4 says `/schema` supplies the store identity so a replacement between schema and sync cannot inherit that click (`llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md:3241-3243`). Native does not have this inversion.

The incarnation test does not catch it. It saves before `start()`, while `transferId` is still unset (`admit-before-identity.test.mjs:149-157`).

**Smallest fix.** Bind a non-empty `expected_store` first, and use `transferId` only when `/schema` named no store — the same order as `identity-admission.ts:92`. Do not refuse at capture; let `queued()` settle `E_ADMISSION_STORE` when the staged or published id differs. Add the test above: save after the replacement id is staged and before `device:store_id` is published, and assert no `POST`.

### Low — a native in-device store refusal does not match the documented refusal on `onWrite`

`snapback4/crates/snapback4-core/src/error.rs:214`

`require_admission_identity` returns `E_ADMISSION_STORE` as `Structural` (`device.rs:1160`). `family()` falls through to `"schema"` (`error.rs:214`) and `refusal()` adds no site, rewrite, or guide. `queued()` stores that value as `why` (`identity-admission.ts:124`). `flushOnce` emits it raw (`local.ts:1091-1094`). `write(id)` later rewrites the stored receipt to `identityRefusal` (`writes.ts:113`). The listener and `write(id)` disagree: one has family `schema` and no rewrite, the other has family `store`, site `client.mutate`, and a rewrite. The sentence is still the public one, and the write is not sent. Web does not hit this path.

**Smallest fix.** Give this `Structural` arm family `store`, site, rewrite, and guide in `error.rs`, or map that code through `identityRefusal` before `completeWrite`.

## Test strength

I did not re-run the reported 96, 319, or 10,000 sequences. Nothing in those suites is the mutation that survives: a profile save on a fresh web client after `observe_store` has staged a different store id and before publication. That write is delivered to the replacement. The pre-`start()` incarnation case, which the suite does cover, correctly refuses.

## Verdict

**NOT READY.** One web capture line sends a deferred mutation to a replacement incarnation. Swap the binding order and cover that save with a test before landing.
