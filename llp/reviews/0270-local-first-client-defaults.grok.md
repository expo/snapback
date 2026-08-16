# Review artifact: LLP 0270 — grok family

Target: `llp/0270-local-first-client-defaults.rfc.md` plus the audit
deliverables it rides with (the audit matrix and the seven gap tickets).

## Round 1 — 2026-08-16

- **Reviewer:** Grok 4.6 (`~/.grok/bin/grok`, --reasoning-effort xhigh,
  --disable-web-search), fresh non-interactive session, blind to the other
  family's review. Grok verified every load-bearing matrix cell against the
  client code and guide pages (its cell-by-cell evidence table is preserved
  below).
- **Revision under review:** the uncommitted authoring-worktree deliverable
  set (RFC v0.1).
- **Verdict:** READY (3 MINOR findings, all fixed in the v0.2 fix round; the
  number-skip finding was adjudicated out — 0267–0269 were reserved by
  sibling lanes landing in the same wave).


1. SEVERITY: MINOR — `issues/20260815-local-first-defaults-audit.md:160` (wrong public signature for the cited headless opt-in)

The Headless optimistic cell tells an app to call `client.createOptimisticMutationView(outboxStore, { authoritativeRows, ... })` and points at `guide/clients/headless.md` plus `packages/snapback-client/store-runtime.mjs`. I opened the public client API: `packages/snapback-client/index.mjs:5905` and `packages/snapback-client/index.d.mts:1755` export `createOptimisticMutationView({ authoritativeRows, connected })`. The client resolves the outbox store internally via `#offlineQueueStore(true)`. The two-argument form exists only on the store-runtime method. The method name is real and the **partial** verdict is still right (`mutate()` returns `presentation: 'withheld'` at `index.mjs:8352` / `9886`; the follow-up ticket uses the public `client.createOptimisticMutationView(...)` form). A reader who copies the audit call site will pass the store as the options object.

2. SEVERITY: MINOR — `llp/0270-local-first-client-defaults.rfc.md:1` (number skip)

This worktree and `origin/main` both top out at LLP 0266. `llp-create` requires `max(existing)+1`, so the next free number is 0267. The new file is `0270`. No collision, and the header (`Type`, `Status: Draft`, `Systems`, `Author`, `Date`, `Revised`, `Related`) is otherwise complete.

3. SEVERITY: MINOR — `llp/0270-local-first-client-defaults.rfc.md:12` (`Related` omits owners the body defers to)

The body repeatedly assigns mechanism ownership to LLP 0155/0129, LLP 0166, and LLP 0218 (and cites LLP 0053 for protected custody). The header `Related` lists only LLP 0190, LLP 0209, LLP 0198, and the audit issue. That does not fork ownership — D1–D6 still decide posture and explicitly leave those specs in charge — but the header is incomplete relative to the deferrals.

I spot-checked every load-bearing and surprising matrix cell against code and guide pages. I did not find a wrong **missing** or wrong **exists+default** verdict.

| Cell | Verdict checked | What I opened |
| --- | --- | --- |
| React persist | exists, opt-in | `index.mjs:2440` default IndexedDB/`rqsStore: undefined`; `persistResume = true` at `11463`; write still requires an rqsEligible token (`11854–11859`); guide “ZERO offline retention” at `guide/sync/offline-and-retention.md:582`; `authorityIndependent` defaults false (`familiar-dispositions.mjs:60`); plain relational queries are not retainable (`relational-authoring.test.mjs:90`) |
| React optimistic | partial | `useSnapbackOptimisticCreate(ref, { query, args, select })` in `packages/snapback-react/index.d.mts:756` and README; one generated `Insert` only (`implementation.mjs` + `guide/clients/react.md:541`); ordinary `useSnapbackMutation` needs `optimistic: { query, args, update, isAuthoritative }` (`react.md:418`); `projectRecordFields` exists |
| React outbox | exists+default on a qualified durable writer | `offlineQueue = 'auto'` (`index.mjs:2446`); per-call `queue ?? 'auto'` (`8080`); `SnapbackProvider` / `createSnapbackReactProvider` default `outboxDrain = 'auto'` (extracted from `implementation.mjs`; types at `index.d.mts:342`); `#offlineQueueStore` refuses unless `durability().durable === true` (`7339–7343`); escape is `outboxDrain="manual"` (`react.md:726`) |
| React local eval | partial | `evaluateLocalResultTransform` (`index.mjs:5868`, `store-runtime.mjs:1252`); requires `result-transform-snapshot-v1` and a claiming carrier (`1260–1263`); filter/order/limit only (`result-transform.mjs:5–7`); no React hook path |
| Expo persist | exists, opt-in; ordinary relaunch only | `registerExpoFileSystemRqsFiles` (`rqs-store-expo.mjs:210`); `powerLossDurable: false` (`84`); resolver reason `native-files-no-power-loss-cut` (`rqs-store-default.mjs:138`); `SnapbackExpoProvider` does not register the adapter; same query opt-ins as React |
| Expo optimistic | partial | Expo provider wraps React (`snapback-expo/provider.mjs:756`); same hook ceiling |
| Expo outbox | partial | Provider defaults `outboxDrain = 'auto'` (`provider.mjs:705`) but first-party store reports `durable: false`, so `#offlineQueueStore` raises `SNAPBACK_OFFLINE_QUEUE_DURABILITY_REQUIRED`. Guide `react-expo.md:804` (“The offline queue works on this carrier”) is stronger than the gate; the qualify-Expo ticket records that |
| Expo local eval | partial | `resultTransformCarrierContextV1` returns null unless `durable === true` (`result-transform.mjs:55`); guide lists the Expo carrier under `SNAPBACK_LOCAL_EVALUATION_UNADMITTED` (`offline-and-retention.md:566`) |
| Swift × 4 | missing | `query`/`mutate` are HTTP POSTs (`SnapbackClient.swift:611–641`); `drainOnce()` is `GET /outbox/{connection_id}` (`657–666`); `seedRetainedRead` / `seedReplayQueue` are in-memory fixture methods (`StateMachine.swift:1386–1434`); `guide/clients/swift.md:24` claims `poll/local` and `live/local`, not offline `Parity` |
| Headless persist | exists, opt-in | Same `SnapbackClient` ladder and per-query flags |
| Headless optimistic | partial | Generated IR builds `optimisticOperation` (`generated-mutation-ir.mjs:119`); queued `mutate()` withholds presentation (`index.mjs:8352`); view is explicit |
| Headless outbox | exists, opt-in | Queueing defaults on; `startOutboxDrain()` is required (`guide/clients/headless.md:327`; `index.mjs:8366`); `{ automatic: false }` exists (`8380`) |
| Headless local eval | partial | Same owner-gated `evaluateLocalResultTransform` |

Ticket “what exists today” claims matched the same surfaces. Safe-vs-semantic classification is defensible: every proposed default changes visible stale/predicted state, durable custody, or background replay, so none is a wiring-only flip. There are no near-duplicates. Every non-default matrix cell has a ticket (or shares one for a shared mechanism): JS retention, generated optimistic, headless drain, Expo carrier, D3 local eval, Swift read, Swift write. React outbox is already default, so it correctly has no ticket.

The RFC decides posture per arm/capability (D1–D6), keeps retained/local/optimistic/queued states explicit, and leaves mechanism with LLP 0190 §3.1 and D3.2–D3.8, LLP 0209 §8 (byte-identical results or `unknown`; live deltas not replica-applicable), LLP 0155/0129, LLP 0166, and LLP 0218. Open questions are leftover implementation details, not a failure to choose the default. The original commission text at the top of the audit file is unchanged. Tickets follow the scored `issues/` shape used by other 2026-08-16 files (`Status`, `Impact`, `Urgency`, `Ease`, `Confidence`, `Systems`, `Date`, `Governing`, `Related`).
