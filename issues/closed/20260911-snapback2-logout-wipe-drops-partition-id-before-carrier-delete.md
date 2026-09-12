# Snapback 2 logout wipe drops the partition id before the carrier delete

**Status:** Closed
**Priority:** P1
**Date:** 2026-09-11
**Systems:** `snapback2/packages/snapback2/src/offline.ts` (`wipe`), `client-auth.ts` (`logout`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1012 ruling 10 (wipe on sign-out, no encryption claim); closed `20260904-snapback2-fence-trust-anchor-followups.md` (distinct)

## Symptom

`OfflineRuntime.wipe()` clears `this.partition` **then** awaits `store.wipe(partition)`. If the carrier delete throws, logout still `clear()`s the token (`client-auth.ts`: wipe failure is recorded, then `clear()` always runs, then the wipe error is rethrown).

`open(otherPrincipal)` only wipes a predecessor when `this.partition` is still set. After a failed wipe it is `undefined`, so the previous principal’s IndexedDB database / SQLite partition rows remain on disk. Same-origin XSS (or `indexedDB.databases()`) can reopen it.

LLP 1012’s “no encryption claim” is not this: the success path does wipe. Leftover after a failed wipe is a hole in that path.

## Evidence

```619:636:snapback2/packages/snapback2/src/offline.ts
  async wipe(): Promise<void> {
    ...
      const partition = this.partition;
      this.coverageRevision += 1;
      this.partition = undefined;
      ...
      await this.store.wipe(partition);
```

```122:137:snapback2/packages/snapback2/src/client-auth.ts
    try { await options.wipe(); } catch (error) { wipeFailure = error; }
    await options.clear();
    this.reset({ state: "anonymous" });
    if (requestFailure !== undefined) throw requestFailure;
    if (wipeFailure !== undefined) throw wipeFailure;
```

`open` at `offline.ts:531`: `if (this.partition !== undefined && this.partition !== principal) await this.store.wipe(this.partition)`.

## Proposed patch

Wipe the carrier **before** forgetting the partition id. In-memory facts can still be dropped first (they are not the disk leftover).

```ts
  async wipe(): Promise<void> {
    this.outbox.resetTrust();
    this.closeInbox();
    await this.serial(() => this.outbox.write(async () => {
      this.pendingGrant = undefined;
      if (this.partition === undefined) return;
      const partition = this.partition;
      this.coverageRevision += 1;
      this.facts = undefined;
      this.superseded = undefined;
      this.supersessionOrder = 0;
      this.held = undefined;
      this.sessionEpoch = undefined;
      this.bytes.bind(undefined);
      await this.store.wipe(partition);
      this.partition = undefined;
      this.outbox.notify();
    }));
  }
```

If `store.wipe` throws, `this.partition` stays set, so the next `open(otherPrincipal)` retries the predecessor wipe.

Optional hardening in `logout`: do not `clear()` the token until wipe succeeds, or persist a durable “dirty partition” marker the next `open` must drain. The reorder above is enough for the `open` retry.

## Acceptance

- Force `store.wipe` to throw once. Logout surfaces the error. `open(otherPrincipal)` still deletes the predecessor partition (or refuses to open until it can).
- Success-path logout still leaves no IndexedDB / SQLite partition for the signed-out principal.
- Follower logout remains a no-op on the writer’s store (documented LLP 1018).

## Resolution (2026-09-11)

Retain the active partition until its carrier wipe succeeds. A rejected deletion leaves its identity available so switching accounts retries predecessor deletion before opening the successor. The regression reproduced the former failure (principal became undefined after the injected I/O failure), then passed after the ordering fix; a fresh carrier confirms Alice has no retained rows after Bob opens.

Validation: affected offline public-state, auth ownership and client sessions suite passed 101/101; the added rendered expiry probe also passed. Package build and affected reference check pass.
