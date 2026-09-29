I'll review the net diff read-only, starting with the round-3 and round-4 reports and the change itself so I can check each prior finding against the code.The net range is the identity-admission change plus the main merges. Next I’ll read the round-3 findings and the round-4 claim that they are fixed, then the admission code itself.Round 3 left both a store-switch bug and an adoption-gate bug. I’ll read the current wait and admission path and check whether round 4’s pins and refusals actually close them.Auto-compacting conversation (81% full)...
Conversation compacted.
The review still needs exact line numbers and a check that each round-3 defect is actually closed. I’ll confirm those against the current diff, then write the verdict.Round 3’s defects are fixed in the code that is on this branch. Nothing here should stop landing. Verdict: **READY**.

I did not re-run the suite. The detecting tests and the mutant log are what I checked. The lane’s own `full-suite.log` records `== 0 failure(s) in 1297 s`.

## Round 3, checked against this tree

| Prior finding | Where it stands | Detecting test |
| --- | --- | --- |
| Astra High: a waiter can switch stores after the first look | Fixed. Each call pins store id and `device:backend-identity` on the first ready read (`identity-admission.ts:95-102`). Later checks and `expected_store` / `expected_generation` / `expected_backend` use that pin, not the shared client identity. | `admit-before-identity.test.mjs:293`. Deleting the final recheck now fails both replacement schedules (`admissions` 2 ≠ 1) in `round4/mutant-delete-final-recheck-detecting.log`. |
| Astra Medium: the final read can hang or reject with a raw device error | Fixed. Initial and final reads share the 15s budget (`identity-admission.ts:61-70`). Only the FIFO wait behind an earlier ordinary admission extends it. A rejected final read becomes `E_ADMISSION_STORE`. | Same file, the hang/reject cases at `:335` and the fake-clock budget at `:394`. |
| Astra Medium: an async `E_ADMISSION` blocks same-id retry | Fixed. `MutationIds` drops the reservation when the fulfilled result is `E_ADMISSION` (`writes.ts:101-104`), not only when the synchronous marker is visible. | Wasm and Worker cases at `admit-before-identity.test.mjs:369`. |
| Grok High: `identified` while adoption is still required | Fixed at open and at all three sync assignments (`local.ts:203`, `:597`, `:660`, `:727`). Each requires a store id and `!backend_required`. | `admit-before-identity.test.mjs:424` (real legacy rewind, held sync or offline reopen). |
| Grok Medium: final `false` became `E_ADMISSION_STORE`, and a throw rejected the promise | Fixed. `false` keeps polling under the same deadline (`identity-admission.ts:70-75`). A throw on the final read is `identityRefusal(false)`. | `:445`, plus the reject case at `:335`. |
| Grok Medium: native admit ignored `BACKEND_REQUIRED` | Fixed under the admission writer transaction, only for the waited path (`device.rs:1046-1048`). | `:461`. |
| Grok Low: “deferred write” card, and `capture()` still using the calibration sentence | Fixed. The card is a pre-admission refusal (`codes.rs:90`). Empty-store capture throws `E_ADMISSION_STORE` (`web-journal.ts:203`). | `:476`. |

## 1. Deferred custody is gone

There is no pre-identity outbox, journal, or recovery path left in the client or device sources. `IdentityWait` is an in-memory map (`identity-admission.ts:17-40`). `deferred::stage_identity` only stages sync publication. A reload drops the waiter and nothing else; the browser and process tests assert an empty journal, an empty outbox, and no POST. Ordinary admission does not read leftover wait state: once `identified` is true and the map is empty, `mutate` builds the same admit request it always did.

## 2. The wait is correct

Call order is the promise tail in `IdentityWait.run`: the next admit starts only when the previous call releases, and release is at ordinary admission, not at server settlement (`identity-admission.ts:36-39`, `local.ts:1227`).

A waiter is bound to the first store id and backend digest it actually observed. A later store, generation, digest, or restore mismatch is `E_ADMISSION_STORE` before `admit`. The admission request carries those pins. On native, `require_admission_identity` checks them (`call.rs:171-172`), then `admit_checked` rechecks `BACKEND_REQUIRED` in the writer transaction. On wasm and Worker, the journal plan rechecks generation, `restore_refusal`, and `backend_required` before the device admit (`web-journal.ts:346`). Those two steps are back-to-back on the device chain (sync `runJournal` on wasm, one exclusive Worker transaction). A same-store legacy rewind after the last SDK read is refused with an empty outbox.

Close aborts the wait with `E_CLOSED` (`local.ts:1410`, `identity-admission.ts:30-31`). Sign-out closes, so the waiter ends the same way rather than sitting until the next poll. A same-session credential refresh does not abort; the write is sent with the credentials current at flush. That is the right outcome. An online store change still goes through `stopForStore` (`client.ts:398`); `refuseStore` closes that wait (`app-online.ts:288`). The online check does not pin a fingerprint because a second store id never replaces the first without that fence.

Timeout before capture returns `E_ADMISSION_TIMEOUT`, drops the in-memory entry in `finally`, and does not journal. `waitSeconds: 0` does not skip the 15s wait.

The caller’s promise does not hang on identity I/O. The only unbounded wait is the FIFO slot behind an earlier ordinary admission that itself never returns. That is the same class of hang as `mutate` after identification, and it is the exclusion the docs describe.

## 3. Ordinary admission is unchanged

Prediction eligibility, the viewer, and the eight minted ids are the same construction, moved to `mutationEntry` and run only after the wait (`admission.ts:31-37`). `E_WRITE_ID_REUSE` still happens before the wait and again inside `admit_checked`. `require_owner` still gates the writer transaction. A prediction error still rolls back to an unpredicated outbox row. `resolveClosingWrites` and the reserved `explicitSync` follow-up are still there and still do what rounds 2–3 required: close resolves in-flight admitted writers from the outbox, and `syncOnce(true)` queues the next round on the serial network tail.

`waiting` stays true for the whole call, so a refusal after a waited admit still remaps `E_PREDICT` / `E_STORE_RESTORE` / `E_GENERATION` to `E_ADMISSION_STORE` (`local.ts:1230`). On this path those codes are produced before commit (native transaction drop rolls back; the journal plan converts `backend_required` and `restore_refusal` into `E_ADMISSION_STORE` and deletes the row). The remap does not report “not sent” for a committed write.

## 4. Docs and codes

Reload loss is stated as loss of the not-yet-admitted call only (`guide/why/E_ADMISSION.md`, `CLIENT-AND-OPERATIONS.md` around the pending-write section). That matches the implementation. `E_ADMISSION_TIMEOUT` and `E_ADMISSION_STORE` both carry family, site, guide, message, and a rewrite that says what to do next. `E_ADMISSION` remains the same-id storage retry. `diag.rs` routes all three at `writes`.

## 5. Test strength

The mutation that beat round 3 no longer survives: deleting the final recheck admits the second call.

This one still survives every detecting test on the branch: delete `key(backend) !== capturedKey ||` in `localAdmissionIdentity` (`identity-admission.ts:101`). Those tests replace the store or the digest through raw `invoke`, or they drive `IdentityWait` with a boolean. They never swap the client’s `backend` object. The device digest pin and the native `BACKEND_REQUIRED` fence would still catch a real store change.

## Finding

**Low** — `identity-admission.ts:93` and `:101`, with the write at `local-native.ts:28-30`.

The JS “changed” check is `JSON.stringify([schema, programs, native])`. The device digest is schema, programs, and generation; it does not include `native`. `nativeInstaller` calls `setBackend` when a device-restored backend lacks the server-only native descriptor, the link is online, and the generation matches. A save that is still inside the identity wait then fails `E_ADMISSION_STORE` (“the backend changed”) even though the store id and the digest did not. The id is consumed. The fresh-web calibration path does not hit this: `/schema` already carries `native`, and the device is opened with that object. It is the offline reopen that fills in `native` while a save is waiting.

Smallest fix: drop `native` from that key and treat generation, the pinned store id, and the pinned `device:backend-identity` digest as the whole identity. `setBackend` of a native descriptor then does not burn the write id.

## Verdict

**READY.** Deferred pre-identity custody is gone, the wait admits in order against the store that actually arrived, and ordinary prediction, custody, dedup, and authorization are the same paths as before.
