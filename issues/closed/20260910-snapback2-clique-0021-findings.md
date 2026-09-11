# snapback2: platform findings from the Clique rerun on 0.0.21 (astra + grok)

**Filed:** 2026-09-10 (orchestrator, wave 3 of the RFC implementation program)
**From:** `benchmarks/runs/2026-09-10-clique-ri-0.0.21/` — the astra scorer's notes, the M7 diary,
the day-2 brief diary and run log. Each is a builder-observed platform behavior; none is yet
reproduced in this repository.

1. **View-once descriptor omitted from durable snapshots.** The scorer's media note: "a platform
   defect stripped `oncePhoto` from durable snapshots" (M5 view-once refusal worked live; the
   durable query's snapshot lost the descriptor). Reproduce with a `image <=N once` column in a
   durable query and a cold reopen.
2. **Maintained-aggregate disagreement on durable queries.** M8: "durable queries returned zero
   maintained aggregates despite receipt guards, requiring authenticated transport" — the twin
   served a maintained count of zero before the server receipt arrived and the builder had to route
   around it ("Insights rendered local twin zero before server receipt (before=0 after=52)").
   LLP 1012's typed-zero completeness rule (a maintained value the client never held is `partial`,
   never zero) is the contract to check against this shape.
3. **A schedule/schema diagnostic** the run log names as a third platform finding (the diary:
   "binder-ID type diagnostic while trying to keep the count update rule narrowly expressed";
   "a text slice did not reduce the compiler's inferred bound") — the run record cites them as
   limitations with workarounds; reproduce from the M7 lane's schema.
4. **Group-route resolution over the first 20 memberships.** The day-2 brief's extra M7 run hit
   "a pre-existing first-20-memberships limitation in group-route resolution after repeated fixture
   creation"; fresh accounts pass. Likely the template's/app's `first 20` on a membership read;
   decide whether the guide should warn or the app shape should page.
5. **Day-two friction to weigh for LLP 1020's next round:** the global-search closure budget
   refusing a page of 20 after adding one nullable column (CR1: page 20 → 19), and the drain's
   ascending-append-only contract making a descending mutable list (pins) need a live query (CR2).

**From the grok wave** (the grok-4.6 scorer's notes, the build diary, the claude-opus-5 grader's
defect list; same run record):

6. **Live vs one-shot disagreement, second family.** The grok build's diary: "live `useQuery` for
   insights returned 0 while `createClient().query` returned 3" (M8), and the scorer names the same
   split for view-once photos, `groups.get`, and poll tallies (M5, M7). This is item 2's class
   (maintained-aggregate disagreement on durable queries) reproduced by a second builder on a
   second app shape; treat items 2 and 6 as one defect to find.
7. **Browser mutations through the IndexedDB range store hang while a bare token client commits
   in 50 ms** — the grok diary (M6, M8) and the scorer ("stalling mutations past 15 s forced a
   token-only aux client for online writes and the offline flush, including dual-Alice and
   m7-a05"). The dual-Alice shape (two browser contexts for one persona in one Playwright
   partition) is the known shared-storagePartition custody artifact — the follower tab waits on
   the writer — so check the harness partitions before filing this as a store defect; but a
   single-context mutation stalling past 15 s (m7-a05's offline vote flush, first run) is not
   explained by that artifact and needs a reproduction against the 0.0.21 web client.
8. **`E_ASSET_NOT_READY` for a consumed or deleted asset** (grader d-10, cosmetic): a raw fetch of
   a consumed view-once URL refuses with `{"code":"E_ASSET_NOT_READY","family":"input"}` — the
   refusal is right, the diagnostic reads as a transient staging state. Name the terminal case
   (consumed / deleted) with its own word or wording.
9. **Evidence for LLP 1019 D6** (no action): the grok build authored `purgeMessage` setting
   `tombstone: true` on expiry, and the grader's d-06 found an expired message left as a
   persistent "This message was deleted" bubble — the authored purge/tombstone pattern conflates
   expiry with delete-for-everyone. D6 removes that pattern from the template (native `removed`
   events; expiry is a direct deletion).

## Disposition — 2026-09-11

Triaged against current main `15c134d056`; keep this umbrella open.

- **P1, items 2/6 — reproduced only as an honestly stale twin, not a false
  live/server zero.** A real owner and durable file carrier cached complete
  zero at seq 0. After the same persona's write, the same
  persona/arguments/schema one-shot owner read was complete 1. Cold snapshots
  remained complete 0 with `source:"twin"`, `live:false`,
  `reason.code:"stale"` through reconnect, then moved to twin 1 and finally
  complete/server/seq 1 with `live:true`; next offline was complete 1. Wrapper
  PID 3234746. This can explain UI that renders `data` without freshness, but
  not an incorrect committed/live claim. Original Insights remains different:
  viewer profile read, `now`/day bucket, six maintained totals, and day0…day6
  count/like keys.
- **P1, item 7 — not reproduced for a single online first write; the reported
  offline flush remains open.** Real Chromium/IndexedDB `witness-web --signup`
  committed the first authenticated mutation 3/3 with ready custody and one
  persona-bound signup partition (wrapper PID 59360). That is not m7-a05's
  single-context offline-vote replay. Separately, `--sessions` passed the
  intentional shared-follower control: forwarding, reload, one writer's FIFO
  admission and Web Lock takeover (PID 3273399). The full witness stopped
  earlier at an unrelated composite-revocation UI timeout and never reached
  the stall segment. Next run must capture held generation, authenticated
  epoch, readiness, writer/follower state and persona-partition count.
- **P1, item 1 — open/unattempted here.** It needs the real durable image
  descriptor cold reopen.
- **P2, item 3 — open.** Reproduce the exact multi-bound M7 schema and retain
  the emitted binder/type carrier.
- **P3, items 4/5 — open product/diagnostic work.** Classify item 4 as app
  shape or platform; item 5 is explicit closure-budget/list-order friction.
- **P3, item 8 — narrowed to deleted/missing attribution and the original
  response.** The consumed case already has `E_ASSET_VIEWED` / HTTP 410 in
  `asset_http.rs`, documented by `guide/families.source.json`. Do not file
  a new consumed-state name as if none exists. Reconcile which ledger/deletion
  state made the frozen run return `E_ASSET_NOT_READY`; the current distinction
  does not prove every consumed-then-deleted path returns 410.
- **Item 9 — evidence-only as filed.** LLP 1019's native removed-event design
  owns it; no separate reproduction belongs here.

The aggregate control is repeatable by inserting this block before regroup in
the existing real-owner successor fixture (`dev:bob` begins at zero):

```ts
const args = { who: "dev:bob" };
const cachedZero = await client.query(api.ops.count, args);
await client.close();
const writer = createClient({ url: owner.url, persona: "bob" });
await writer.mutation(api.ops.send, { kind: "text", body: "after cache" });
const ownerNow = await writer.query(api.ops.count, args); // complete 1
writer.close();
client = createClient({ url: owner.url, persona: "bob",
  offline: { store: fileRangeStore(join(directory, "bob")) } });
await client.ready; await client.offline();
const cold = await client.query(api.ops.count, args); // record all public flags
const seen: unknown[] = [];
const live = subscribe(client, api.ops.count, args, value => seen.push(value));
await client.online();
await live.until(v => v.state === "complete" && v.data === 1 && v.live === true, 3000);
live.close();
```

Existing real-browser controls are exactly:

```sh
cd snapback2
SNAPBACK2_WITNESS_BROWSER=/path/to/chromium node scripts/witness-web.mjs --signup
SNAPBACK2_WITNESS_BROWSER=/path/to/chromium node scripts/witness-web.mjs --sessions
```

## Server/compiler resolution — 2026-09-11

**Status remains Open for client-owned items 1, 2/6, and 7.** This pass owned
the server, core, and compiler claims only.

- **Item 3 was reproduced and fixed in `2b3ea88b5`.** The direct Quarry
  frontend already knew that `old.id` was `Ref<conversations>`, but raw-IR
  certification reduced every table `id` to generic `Id` and admitted the
  nominal `Id`→`Ref<table>` bridge only for `Field("id")`, not the update
  images. `OldField("id")` and `NextField("id")` now retain the subject table
  identity in update rules. Separately, literal text-slice endpoints now
  constrain output certification: `text <=2000` returned directly certifies at
  8,016 bytes, while `slice(body, 0, 80)` certifies at 336 bytes. The compiler
  suite pins the original M7-shaped rule and compares the two certificates.
- **Item 4 is app-owned, not a platform route defect.** No Snapback template,
  guide fixture, server, or compiler source contains `ResolveConversation` or
  the claimed membership query. The run's own
  `day2-astra-diary.md` says the benchmark app searches only its first 20
  memberships and that fresh fixture accounts pass. Paging that app route is
  the remaining action, outside this repository's platform code.
- **Item 5 records accepted product friction, not incorrect authority.** LLP
  1020 A4/A6 requires the compiler to refuse over-ceiling work with the
  responsible terms and preserves capped-page semantics. Changing page 20 to
  19 after adding output width is therefore the expected proof result; an
  ascending drain and a descending mutable list remain different product
  shapes. `408af8ad4` adds the missing system-viewer control that an overlarge
  merge union remains `Capped` even when rule visibility is bypassed.
- **Item 8 does not reproduce on current main as a consumed-state naming bug.**
  `asset_http.rs` maps `E_ASSET_VIEWED` to HTTP 410, and
  `assets/once.rs` pins both the second-fetch code and status. The frozen
  grading evidence also records HTTP 404 after *unsend*, where the row/asset
  was deleted; LLP 1006 §2a.1 deliberately hides missing/deleted existence as
  `E_ASSET_NOT_READY`. The grader combined consumed and deleted observations,
  but that is not evidence for changing the current distinction.
- **Item 9 remains evidence-only** as filed.

The open client items still require the durable descriptor cold-reopen, the
maintained-value freshness/custody work, and the single-context offline replay
witness. They are intentionally not weakened or closed by these server fixes.

## Client resolution — 2026-09-11

**Closed by `a52703b7c`.** The remaining platform-owned items are fixed or
permanently qualified. Items 4 and 5 retain their app-owned / accepted-product
dispositions above, and item 9 remains evidence owned by LLP 1019 rather than
a second live defect.

- **Item 1 reproduced at the conditional-request seam and is fixed.** An
  unviewed `image once` descriptor is correctly scrubbed from an offline twin
  result, but the held answer kept its validator. On cold reconnect the owner
  could therefore answer `unchanged`, causing that scrubbed `null` to be
  published with a fresh server receipt. Held answers now omit the validator
  when their result suppressed an unviewed once descriptor, forcing a full
  authoritative frame. The real-owner regression proves the descriptor stays
  present after the initial durable refresh, a cold offline reopen publishes
  `null` from the twin while retaining schema custody, and reconnect restores
  the descriptor from a complete server frame. Viewed rows still retain their
  conditional path and remain `null`.
- **Items 2/6 are permanently qualified as truthful stale custody, not a
  current-zero defect.** The real-owner regression holds complete maintained
  zero at seq 1, advances the same owner group to one at seq 2, and records the
  mounted transition `twin 0 / stale / seq 1` → `twin 1 / stale / seq 2` →
  `server 1 / live / seq 2`. No snapshot claims zero with `live:true`; the next
  cold reopen retains complete one at seq 2.
- **Item 7 is permanently qualified by a focused real-Chromium mode.** Run
  `node scripts/witness-web.mjs --offline-replay`. The passing run used one
  page, one `snapback2:dev:alice` IndexedDB partition, principal `dev:alice`,
  auth epoch 0, `following:false`, held generation
  `440d4f2bda12e2f4121f716960c1e4390bbb588130345facc9fd3af18b49d17d`, and
  `outbox.status(messages.send) = ready/ready/none/0/inside`. The browser-offline
  mutation durably queued in 9 ms without a request; reconnect flushed its
  byte-identical replay envelope in 62 ms with one application mutation
  request, zero remaining rows, and exactly one owner row. The earlier
  dual-context stall remains the already-qualified follower/writer artifact,
  not this single-writer path.
