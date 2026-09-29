I'll review the net diff read-only, starting with the round-3 prompt, the report, and the change itself.The net range includes every round plus a large report trail. I'll isolate the product sources and look for leftover pre-identity custody.`identity-admission.ts` is still in the net diff. I'll read that wait path and the ordinary admission changes next.The wait class is small enough to audit against `mutate()`. I'll read that path and the online journal next.Auto-compacting conversation (80% full)...
Conversation compacted.
The review was cut off before a verdict. I’ll confirm the wait, identity fence, and leftover custody paths at the cited lines, then write the full review.**NOT READY.** A profile save during adoption can skip the in-memory wait, enter the outbox, and be sent. Durable pre-identity custody is gone, and the calibration wait itself is real, but the flag that decides who enters that wait is wrong.

## Findings

### 1. High — `identified` is set from a published store id while adoption is still required

`snapback4/packages/snapback4/src/local.ts:591`, and the same assignment at `local.ts:654` and `local.ts:721`. The gate is `local.ts:1213`.

`syncRound` does this before the sync POST:

```590:591:snapback4/packages/snapback4/src/local.ts
observeIncarnation(store_id ?? undefined, backendRequired && partitionCurrent);
storeIdentity = store_id ?? undefined; identified = !!storeIdentity;
```

When `device:backend-required` is already set and `store_id` is published, `observeIncarnation(..., true)` clears `identified` and sets `partitionCurrent` false, and the next line sets `identified` true again. Line 663 only clears it when `backendRequired && partitionCurrent`, which is now false. The sync POST then stays in flight with `identified === true`.

A save in that window sees an empty wait queue, so `waiting` is false. It does not wait and does not send `expected_store`, `expected_generation`, or `expected_backend` (`local.ts:1221`). Both fences are then skipped: wasm checks `backend_required` only when `expected_generation` is present (`web-journal.ts:346`), and native `require_admission_identity` runs only under the same condition (`call.rs:166-168`). `admit_with_replay` never reads `BACKEND_REQUIRED` (`device.rs:1040-1077`). If the meta store id still matches memory, the write is committed and can be sent before adoption. If `require_owner` fails, that error is `E_PREDICT` (`store_identity.rs:53-54`), `writeRefusal` keeps the localStorage row (`web-journal.ts:361-363`), and the next successful `adopt` or `observe_store` runs `journal.recover` (`web.ts:405-408`) and admits it.

The process replacement test only injects a new store when `expected_generation` is already on the request (`admit-before-identity.test.mjs:213`), so it never hits this skip.

Smallest fix: set `identified` only when `store_id` is present and `backend_required` is false, at all three assignments. A click during adoption then stays in `IdentityWait` and carries `expected_*`.

### 2. Medium — after identity is seen once, “not ready” becomes a store refusal, and a throw rejects the promise

`snapback4/packages/snapback4/src/identity-admission.ts:58-62`. The id stays reserved at `snapback4/packages/snapback4/src/writes.ts:106`.

The poll loop treats `false` as “keep waiting”. Once a check returns true, the 15s timer is cleared, the lane waits for the previous call, and the second check does this:

```61:62:snapback4/packages/snapback4/src/identity-admission.ts
const current = await Promise.race([check(), interrupted]);
if (current !== true) return refused(typeof current === "boolean" ? identityRefusal(false) : current);
```

`checkLocalIdentity` returns `false` when the state is missing or `backend_required` is still set, without a store or generation change (`identity-admission.ts:77-81`). That `false` is turned into `E_ADMISSION_STORE` (“The backend changed…”). The caller must use a new id even though the backend did not change. The second `check()` also has no `.catch`. If `call()` throws, `mutate()` rejects instead of returning a `Write`. The rejection handler in `MutationIds.run` only drops `running`; the id stays in `seen`, so a same-id retry goes to receipt recovery and will not submit again.

Concrete case: call A has passed the first check and is still inside admission. Call B has also seen ready, clears its timer, and waits on A. Before B’s second `sync_state`, a page sets `backend_required` with the same store id and generation. B fails with `E_ADMISSION_STORE`. If that read throws, B’s promise rejects and the form’s id is stuck.

Smallest fix: treat `false` like the first loop (sleep and keep the original deadline). Map only a real `Refusal` to a failure. On a throw, return a failed `Write` and finish the id.

This is not a hang of a healthy lane. Waiting out an earlier ordinary admission after identity is intentional (`identity-admission.ts:58`, and the fake-clock test at `admit-before-identity.test.mjs:244`). `release()` runs in `finally`, so a call that finishes unblocks the next one. A caller hangs only if that earlier admission never returns, which is the same stuck device call as ordinary `mutate`.

### 3. Medium — the native fence does not see `backend_required`

`snapback4/crates/snapback4-device/src/device.rs:1019-1023`, reached from `snapback4/crates/snapback4-device/src/call.rs:166-168`.

Even a call that waited and attached `expected_*` is accepted on a native host when generation, memory `store_identity`, and the backend digest match. A same-store reset sets `BACKEND_REQUIRED` without changing those (`store_identity.rs:129-158`). Wasm refuses that state (`web-journal.ts:346`). Native `require_admission_identity` does not look at the flag, and `admit_with_replay` then commits the outbox entry.

Concrete case: a watermark rewind sets `device:backend-required` to `"legacy"` and leaves `STORE_ID` in place. The wait’s second check can still pass if it races ahead of that meta write. Native admission then queues the profile save and delivery can send it before `adopt` clears the flag.

Smallest fix: in `require_admission_identity`, return `E_ADMISSION_STORE` when `BACKEND_REQUIRED` is non-empty.

### 4. Low — the public card and the old internal sentence are still there

`snapback4/crates/snapback4-lang/src/guide/codes.rs:90`. `snapback4/packages/snapback4/src/web-journal.ts:203`.

The `E_ADMISSION_STORE` card still says “a deferred write”. The runtime message in `identityRefusal` does not (`identity-admission.ts:8-10`). Separately, `capture()` still refuses with the calibration sentence, “the backend store is not identified yet; mutation was not admitted”, wrapped as `E_ADMISSION` (`admission.ts:14-16`, `web.ts:110-111`). That is the path a click takes when `identified` is true and the journal has no store id. It is not the public timeout or store code, and it is the sentence that stuck the form.

Smallest fix: describe `E_ADMISSION_STORE` as an unsent pre-admission refusal, and make the empty-store `capture()` refusal use `identityRefusal(true)` (or keep refusing only after the wait, never with the internal sentence).

## What is sound

Deferred pre-identity custody is gone. `IdentityWait` is an in-memory map (`identity-admission.ts:16-39`). Nothing in the client or device sources still stages a pre-identity mutation queue. `deferred::stage_identity` only stages sync publication. Reload during the wait loses the unadmitted call, and that is what LLP 3000.007 §20.4, `guide/why/E_ADMISSION.md`, and `CLIENT-AND-OPERATIONS.md` say.

The wait itself, for a call that actually enters it, is ordered. The lane is `previous.then(() => admitted)`, and `admit` runs only after the previous lane releases. Release is at ordinary admission, not at server settlement (`local.ts:1229-1230`, `app-online.ts:186-187`). Concurrent pre-identity calls therefore admit in call order.

An in-flight local waiter is bound to the schema store and generation captured at the call (`local.ts:1212`, `identity-admission.ts:74-81`). A different store id, a generation or backend fingerprint change, or `E_STORE_RESTORE` becomes `E_ADMISSION_STORE`. Close aborts with `E_CLOSED` (`local.ts:1407`, `identity-admission.ts:29`). Sign-out sets `sessionDead`, and the next check returns `E_AUTH` (`local.ts:327`). A same-session credential refresh does not abort the wait; the write is sent with the current credentials. That is the right outcome.

Timeout before the first ready returns `E_ADMISSION_TIMEOUT`, deletes the in-memory entry in `finally`, and does not capture. `waitSeconds: 0` does not skip the 15s identity wait. Online waits until `probe` yields a store, then journals (`app-online.ts:205-211`). A later id change is the raw client’s `E_STORE_REPLACED` / `E_STORE_RESTORE` path, which closes that wait. Online does not compare `/schema`; the first probed store is the identity.

Ordinary admission is otherwise the same machinery. Prediction still rolls a `Prediction` error back to an unpredicated outbox entry (`device.rs:1069-1072`). `E_WRITE_ID_REUSE` still runs before the wait (`writes.ts:70`) and again inside `admit_with_replay` (`device.rs:1044-1047`). `require_owner` still gates admission. The round-2 close path still resolves live waiters through `resolveClosingWrites` instead of marking them pending (`local.ts:1407-1410`). `explicitSync` still reserves the follow-up round (`local.ts:552-559`). The bug is the flag that classifies a call as ordinary while `backend_required` is set, not the admission transaction itself.

I did not rerun the suite. The lane report’s full `scripts/test.sh` was red; nothing here rechecked that.

## What would survive

A profile save started while `device:backend-required` is set, `store_id` is already published, and no other call is in the identity queue. It skips the wait, `capture()` writes a journal row, and either `admit_with_replay` commits it or `E_PREDICT` leaves the row for `journal.recover` to send after adoption. No current test holds that flag across a sync POST and then clicks.

**NOT READY.**
