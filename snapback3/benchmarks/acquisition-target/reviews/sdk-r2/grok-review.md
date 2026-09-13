The skip predicate is sound. Several surrounding paths are not: one dataset denial wipes every durable dataset; invalidation without a seq advance can republish withdrawn data if the invalidate write fails; a rejected mutation advances known seq without withdrawing the pool; reconnect does not resume a failed acquire.

## Confirmed bugs

### 1. One page denial wipes every durable dataset

`snapback3/packages/snapback3/src/client.ts:776-782`

```776:782:snapback3/packages/snapback3/src/client.ts
            if (envelope.state === 'denied') {
              this.acquiredFacts.delete(id);
              const denied = new SnapbackError(envelope.rule ?? 'S3_FORBIDDEN', 'The acquired dataset is no longer authorized.');
              handle.seal(denied);
              try { await this.persist({ clearAcquisitions: true, acquisitionsInvalidated: true }); }
              catch { try { await this.persist({ session: null }); } catch { /* RAM is already sealed. */ } }
              throw denied;
```

Counterexample:

1. `books` is durable-ready at seq 12. `authors` is durable-ready at seq 12. Both are in `acquiredFacts`.
2. Revalidation of `books` receives one `state: 'denied'` page.
3. Only `acquiredFacts.delete('books')` runs in RAM. `authors` stays ready and remains readable through `readLocal` (`client.ts:468-472`).
4. `clearAcquisitions: true` deletes **all** IndexedDB/memory acquisition records (`storage.ts:66-68` and `storage.ts:210-212`).
5. Process restart: `restoreAcquisitions` sees no rows (`client.ts:482-498`). `authors` is gone even though it was never denied.

That breaks “unrelated declared datasets can remain ready.” Denial is per-envelope, not per-account. The catch path that writes `session: null` is worse: it can erase the session on disk while this tab still has `this.session` set.

Fix: persist a per-id withdrawal (`clear` / seal only `books`), leave other checkpoints in place, and bump `acquisitionEpoch` for the denied id only.

---

### 2. Seq-less invalidation can republish withdrawn data if the invalidate write fails

`snapback3/packages/snapback3/src/client.ts:504-515` with callers `client.ts:1060` and `client.ts:1159`

```504:515:snapback3/packages/snapback3/src/client.ts
  private suspendAcquisitions(seq?: number): void {
    this.acquisitionEpoch++;
    if (seq !== undefined) this.minimumSeq = Math.max(this.minimumSeq, seq);
    this.acquiredFacts.clear(); this.acquiredIdentities.clear();
    void this.persist({ ...(seq !== undefined ? { acquisitionFloor: seq } : {}), acquisitionsInvalidated: true,
      invalidateAcquisitions: true })
      .catch(async error => {
        this.storageFailure(error);
        try { await this.persist({ session: null }); } catch { /* RAM is already redacted. */ }
      });
    if (this.allowedOnline && this.session) for (const id of this.acquisitionSpecs.keys()) this.resumeAcquisition(id);
```

`redactReceived` (`client.ts:1060`) and `invalidate()` (`client.ts:1159`) call `suspendAcquisitions()` **with no seq**. RAM pools are cleared; `minimumSeq` is not advanced.

`persist()` swallows failure into a resolved chain (`client.ts:1279-1283`: `this.persistence = next.catch(() => {})`). `runAcquisition` then does `await this.persistence` (`client.ts:569`) and `storage.load()` (`client.ts:573`).

Counterexample:

1. Dataset `books` is durable-ready at seq 7. A live read arrives with `S3_FORBIDDEN` / dropped row refs. `redactReceived` must withdraw eligibility immediately (`client.ts:1036-1037`).
2. The invalidate write fails. Durable state is still `{ status: 'ready', seq: 7, acquisitionsInvalidated: false }`. `minimumSeq` is still ≤ 7.
3. `resumeAcquisition('books')` starts `runAcquisition`. After the swallowed persist, load still sees ready-at-7.
4. `client.ts:639-651` restores the pool and `handle.finish({ status: 'ready', seq: 7 })`.

The forbidden snapshot is published again. Seq-advancing suspend (`receive` at `client.ts:938`, `loadManifest` at `client.ts:453`) is safer because `metadata.seq >= this.minimumSeq` fails. The no-seq path does not have that backstop.

Fix: on any invalidation, either advance a monotonic epoch that restore treats as a floor, or refuse the ready-restore branch unless *this process* has a successful invalidate receipt. Do not resume-from-durable-ready after a failed redact persist.

---

### 3. Known seq from a non-committed receipt does not withdraw the pool

`snapback3/packages/snapback3/src/client.ts:1103-1110`

```1103:1110:snapback3/packages/snapback3/src/client.ts
        this.minimumSeq = Math.max(this.minimumSeq, terminal.seq);
        const settled: StoredOperation = { ...entry, status: terminal.state, receipt: ownJson(terminal), error: undefined };
        if (terminal.state === 'committed' && !this.awaitingObservation(settled)) settled.observed = true;
        await this.persist({ operations: [settled] });
        this.journal.set(entry.id, settled); this.updateIntent(settled); intent.finish(settled.receipt!); this.publish();
        if (epoch === this.accountEpoch && terminal.state === 'committed') this.renewResources();
```

`minimumSeq` moves for `rejected` and `conflict` as well as `committed`. Only `committed` calls `renewResources()` → `suspendAcquisitions(this.minimumSeq)` (`client.ts:1169-1175`).

Counterexample:

1. `acquire({ id: 'books', ... })` completes. Handle is `ready`, `acquiredFacts.get('books').seq === 5`.
2. `mutate(...)` settles `rejected` with `receipt.seq === 10`.
3. `minimumSeq` is 10. `acquiredFacts` still holds seq 5. Handle stays `ready`. Durable checkpoint stays `ready` with `acquisitionsInvalidated: false`.
4. New `watch()` misses (`client.ts:468` filters `item.seq >= this.minimumSeq`). Already-filled `Resource` snapshots keep seq-5 bytes (`staleResources` is not called).
5. A concurrent in-flight acquire hits `persistProgress` at `client.ts:622-623` (`metadata.seq < this.minimumSeq`) and fails `S3_SEQUENCE_CHANGED` instead of revalidating, unless `renewResources` later races in.

Invariant: a known seq transition withdraws eligibility until every reachable page is at that seq. Restart hides this (`initialize` at `client.ts:347-349` includes journal receipts in `minimumSeq`, so restore refuses seq 5), but this session does not.

Committed receipts have a smaller window of the same shape: `minimumSeq` is raised **before** `await this.persist({ operations })` (`client.ts:1103-1108`), and only then `renewResources()`. During that yield, `persistProgress` can throw `S3_SEQUENCE_CHANGED` with `acquisitionEpoch` still unchanged.

Fix: any `minimumSeq` advance should `suspendAcquisitions(seq)` (or equivalent) before yielding. Revalidation belongs on rejected/conflict too if that receipt seq is owner-authoritative.

---

### 4. `acquire()` is not a retry; reconnect does not resume acquisitions

`snapback3/packages/snapback3/src/client.ts:209-214` and `client.ts:294-305`

```209:214:snapback3/packages/snapback3/src/client.ts
    const existing = this.acquisitionHandles.get(spec.id);
    if (existing) {
      const previous = this.acquisitionSpecs.get(spec.id)!;
      const identity = (value: AcquisitionSpec<any>) => canonicalJson({ revision: value.revision,
        root: { key: value.root.key, op: value.root.op, args: value.root.args, cursor: value.root.cursor } });
      if (identity(previous) === identity(spec)) return existing;
```

```294:305:snapback3/packages/snapback3/src/client.ts
  async reconnect(): Promise<void> {
    await this.ready;
    if (this.closed || !this.allowedOnline) return;
    ...
      await Promise.allSettled([...this.resources.values()].filter(resource => resource.active).map(resource => this.acquireResource(resource)));
      await this.drain();
```

Counterexample:

1. Startup calls `client.acquire({ id: 'books', revision: '1', root: pages(...) })`.
2. Mid-turn `POST /api/acquire` fails (`S3_NETWORK`). `runAcquisition` throws. The `acquire()` catch at `client.ts:235-238` calls `handle.fail`. Status is `error`; `completed` is rejected.
3. `reconnect()` / `setOnline(true)` refreshes watches and the mutation journal. It never calls `resumeAcquisition`.
4. The app calls `acquire()` again with the same spec. Identity matches, so the **failed** handle is returned and `runAcquisition` is not started.

Ordinary live resources retry on reconnect (`client.ts:303`). Declared offline datasets do not. `resume()` exists, but nothing in the connectivity path invokes it, and `acquire()` is a map lookup after the first call.

This is a retry/liveness hole, not a corrupt-ready-pool hole.

---

### 5. `expand` does not receive `PageChain<Root>`

`snapback3/packages/snapback3/src/resource/acquisition.ts:133-153` vs `acquisition.ts:33-40`

```33:40:snapback3/packages/snapback3/src/resource/acquisition.ts
export interface AcquisitionSpec<Root = unknown> {
  id: string;
  revision: string;
  root: PageChain<Root>;
  expand?: (root: Root) => readonly PageChain<unknown>[];
}
```

```148:153:snapback3/packages/snapback3/src/resource/acquisition.ts
    const value = expandRows(envelope);
    if (Array.isArray(value)) values.push(...value); else values.push(value);
    if (envelope.next === null) break;
    args = ownJson({ ...args, [chain.cursor]: envelope.next });
  }
  return values as T;
```

Counterexample:

- `getBook` returns `{ id, title }` (`next: null`). Typed as `pages(getBook, { id })` → `PageChain<{ id: string; title: string }>`.
- `expand: (book) => [pages(listChapters, { bookId: book.id })]`.
- `chainValue` returns `[{ id, title }]`. `book.id` is `undefined`. If `expand` returns `[]` instead of throwing, `runAcquisition` at `client.ts:676-688` treats derived as empty, walks only the root, and can take the fresh skip at `client.ts:689-707`.
- Handle becomes `ready` with `chains: 1`. Chapters are never acquired. Restart restore (`restoreAcquiredPool`, `acquisition.ts:104-117`) will re-admit that incomplete set because status is `ready`.

Paginated `T[]` pages accidentally match because of the flatten. Singleton / object pages do not. That is declaration binding, not a type nit: it can persist a ready checkpoint whose reachable set is wrong.

---

## Fresh-traversal skip

No confirmed bug in the skip predicate itself.

`freshTraversal` starts only on an empty RAM resource map (`client.ts:589`). It is cleared on durable resume / invalidate / ready-revalidate (`client.ts:656-657`), owner `unchanged` (`client.ts:761`), sequence change (`client.ts:726`), and any non-`follow: true` full page (`client.ts:788-790`). It is never written to storage.

Skip requires (`client.ts:689-691`): still traversing, `metadata.seq` defined, `freshResources` exactly the walked `resourceKeys`, every key at that seq. `expectedSeq` is always sent (`client.ts:710-715`); a mismatched 200 is protocol-rejected (`client.ts:739-740`). `walk` only reaches the skip when `missing.length === 0`.

Persisting `status: 'ready'` after a skip is consistent with “skip is RAM-only”: crash during an unfinished traversal reloads `freshTraversal === false` and normalizes; a completed skip is a full-envelope set at one real seq, which restore may admit.

Time/connected refusals hold: `resolveChain` rejects `read_time_granularity_ms` (`acquisition.ts:49-51`); `assertOfflineEnvelope` rejects `connected` / `readTime` (`acquisition.ts:99-101`).

---

## Persistence-before-publication (success path)

The happy path is ordered correctly:

- Progress snapshot: `await persistProgress(...)` then `handle.set({ status: 'acquiring', ... })` (`client.ts:821-822`).
- Ready: `metadata.status = 'ready'` then `await persistProgress([], [], true)` then `acquiredFacts.set` / `handle.finish` (`client.ts:697-707`).
- `assertCurrent()` after the ready persist (`client.ts:701`) drops RAM publication if authority moved during the write.

The failures above are invalidate/denial/seq-floor paths, not this sequence.

Incompatible same-id revision withdraws even offline: RAM is dropped in `acquire()` (`client.ts:215-220` / `222-230`), then `!compatible` rewrites metadata before the offline throw (`client.ts:579-637`, `655`). Unrelated ids are not touched on that path.

---

## Not safety bugs (ergonomics / hardening / test gaps)

**Ergonomics**

- `.completed` is a one-shot (`types.ts:64-67`, `client.ts:87-100`). Later revalidation uses the snapshot. Cancel sets `cancelled` and never rejects `completed` (`client.ts:526-530`). Matches the stated contract.
- `cancel()` does not drop `acquiredFacts`. This session can still `readLocal` a cancelled id; restart will not restore it (`restoreAcquiredPool` requires `status === 'ready'`).
- `acquire()` identity is untagged raw root JSON (`client.ts:212-214`), not `declarationIdentity(resolveChain(...))` (`acquisition.ts:66-70`). Equivalent optional-cursor spellings seal and restart.
- Progress `pages` uses `resources.size` (`client.ts:818`); ready uses walked `resourceKeys.length` (`client.ts:697`).

**Hardening**

- Overlapping chains that share a `queryKey` overwrite `chainKey` (`client.ts:786-787`); `walk` then sees a mismatch (`client.ts:609`) and can oscillate until `S3_ACQUISITION_LIMIT` (`client.ts:824`). Validation keys are specified unique per ordinary query; the SDK should reject the second chain rather than loop.
- Full pages are bound to chain identity, not to the requested args (`client.ts:748-754`). Accounted-for checks (`client.ts:811-812`) still catch a dropped request if the owner also returns a never-executed continuation, but a same-key extra cursor can be stored as a stray resource. Prefer `canonicalJson(page.args) === canonicalJson(requested.args)` for the executed record.
- `resolveChain` does not refuse connected programs; only the envelope assert does (`acquisition.ts:99-101`). Fail at declaration time.
- `POST /api/acquire` is not locally capped at 64 unique keys or 16 executions; a duplicate-key `pending` slice can violate the owner unique-declaration rule (`client.ts:710-715`).
- Denial/invalidate persist failure tries `session: null` without `clearAuthority()` (`client.ts:780-781`, `client.ts:510-512`). Disk and RAM authority can diverge.
- `restart()` empties RAM resources but does not delete durable resource records (`client.ts:630-635`). Harmless given `resourceKeys` filtering (`acquisition.ts:126-130`); still a leak.

**Test gaps (not executed here)**

- Sibling dataset survival when one acquire turn is denied.
- `redactReceived` / `invalidate` persist failure, then `runAcquisition` ready-restore.
- Rejected/conflict receipt seq vs ready pool / `persistProgress`.
- Reconnect after `S3_NETWORK` during acquire, and second `acquire()` with the same spec.
- `expand` on a non-array singleton root, including skip-to-ready.
- Crash after N traverse persists (flag must not skip; must validate).
- Unchanged / `acquisitionsInvalidated` / incompatible revision while `allowedOnline === false`.

No production or benchmark claim is made.
