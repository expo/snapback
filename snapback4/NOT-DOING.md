# What Snapback 4 Does Not Do

Longer than the doing-list on purpose. Moving something off it means writing one
line naming what it unblocks and taking something off the doing-list in the same
change. Nothing comes off during slice one (LLP 3000 §3: the clock is four weeks).

## The bars

The bakeoff gates in [LLP 3000 §3](../llp/3000-snapback4.explainer.md) are the
bars: the loop bar, hub acquisition within 2× the measured floor, client bytes
under the competitor-anchored budgets, the six scenarios green in the simulator
on the hub fixture. Everything not required to pass them does not exist yet.

## Not building

- **A second authoring language.** Quarry, one spelling, copied from Snapback 2 (LLP 1004, LLP 1007 §4b). TypeScript is for seeds, journeys, effect bodies and the client.
- **Byte- and step-priced certification.** No closure, heap, output or step ceilings at `check`; the certificate certifies shape, uniformity, completeness class and prediction eligibility. Resources are metered at runtime (LLP 2000.000 §6).
- **A per-query result cache.** No range receipts, validators, halos, absence evidence, coverage spans, extent facts, held directories, fact integrity or swap journals. The client replicates declared partitions with one watermark each (LLP 2000.000 §7).
- **Engine-minted ids for client inserts, grants, ID slices.** Ids are client-minted, time-ordered, 128-bit; the engine mints for its own writes.
- **The `drain` protocol, follower-tab inbox rows, `defineItems`, `withHistory`, `mutationTarget`, `receipt.source`, `local.caughtUp`, `partial` reason codes.** The card (`packages/snapback4/src/contract.ts`) is the whole client vocabulary; `why` carries the rest.
- **`retain` as a receipt rule.** `until-revoked` and `delivered-history` survive as the client's leave policy on a scope tombstone.
- **JavaScript in the data plane.** Queries and mutations run in the Rust interpreter inside the SQLite transaction, and in the same interpreter on the client (host decided at week 3 by measurement, LLP 2000.000 §9). A *job* may be the app's own Rust, hosted as wasm through the interpreter's operations under the job's meter (LLP 3000.005, the Moves line below); a query or mutation may not.
- **An embedded JS engine for effects.** The data plane never calls out. `emit` writes the effect durably in the mutation's commit and an external worker holding a service token claims, performs and settles it over the wire (`snapback4/worker`); the four reference effects run on the builder's Node (LLP 2000.000 §10, decided 2026-09-13).
- **Committed generated code; an auth mode; a supervised bundler.** As Snapback 2 (`rules/NOT-DOING.md`): types by inference, personas not modes, `SNAPBACK_URL` is the client contract.
- **A TypeScript twin of the interpreter.** Retired by the author's ruling of 2026-09-13 (LLP 3000 §7): one implementation, in Rust, on every host — the core's SQLite under the native module, memory under wasm on the web with the host persisting each commit's changes. The web pays 312,924 B gzip before the diet where the twin's tier paid 16,842; the conformance obligation between two interpreters ends. Expo Go runs the online tier.
- **More than one hosted target, an admin console, media transcoding or thumbnails, push delivery itself (a worker's), cron syntax beyond `every N at HH:MM`, vector or relevance-ranked search (word-prefix search is in: `words(..)` and `matching`), federation, multi-region, device-to-device sync, at-rest encryption claims.** After the clock, on evidence.
- **Observability beyond `why`, `trace`, `logs`, `data`, `sql`, and server operation latency.** The `sql` verb is read-only inspection of the developer's own store (LLP 3000.007 §8.8), never an application surface. Separately declared application SQL reads are admitted for increment D (LLP 3000.009 §6.2, §14.4; the 2026-09-16 Moves line below), not implemented by this inspection verb.
- **A guide corpus.** The compiler's facts, one language card and keyword cards, as Snapback 2; no freshness dates. Every card's Quarry is compiled by the suite and the language card is run, so a card cannot promise a form the parser refuses.

- **Union audiences.** One `sync` line per table. A read rule with a second non-service disjunct is refused with the rewrite, never partially delivered; service grants add no device audience (LLP 3000.007 §20.6). `retain delivered-history` covers the author who keeps their own rows. Several `sync` lines per table wait for an app that needs them.
- **Exact horizon maintenance.** The horizon bounds acquisition (a snapshot, a bootstrap); the log never evicts or back-fills to hold a device's group at exactly N rows. A local read past the acquired horizon by key says `complete: false`.

- **Time in rules.** A read rule compares with `=` and `!=` only; `.expiresAt > now` is not a rule, because a rule that varies with time is not an audience a partition can hold. A row's life ends by the table line `expire at .col` instead: absent to every reader on every host from that time, swept by the server, the deletion streamed (see Moves).
- **A jobs framework.** No priorities, worker pools or dead letters: one FIFO of runs, one chunk at a time, a refused chunk parked with its refusal. Actions, effects and scheduled actions carry per-operation retries, deadlines and cancellation, and a record per external step (LLP 3000.009 §5.2; the Moves line below). Missed period boundaries while a server is down fire once on return, not once per missed period.
- **Asset processing.** No transcoding, thumbnails, rungs or HEIC: the bytes are served as uploaded; JPEG, PNG, WebP and MP4 only; image dimensions and optional MP4 duration read from the header; MP4 dimensions are not extracted.
- **Search beyond word prefixes.** One tokenizer (NFC, lowercase, alphanumeric words), one index shape (`scope, words(cols), order.., id`), one read (`matching`): every term a prefix of some word, the first term's words merged as lanes, bounded by the meter in a uniform scope, at most 32 words in an admitted non-uniform scope. No stemming, no ranking by relevance, no phrase or mid-word matching, no per-language folding, no intersection index for the second term (it filters the page).
- **An identity provider.** Guests, password accounts, service seats, and sessions a service mints for accounts the application authenticated itself. No phone, OAuth, magic links or MFA in the engine: an application's worker verifies those and mints the session.
- **No multi-server presence, no presence history or last-seen storage, no broadcast event stream, no connection-bound rows.** `connected[p]` stays server-wide, counting held polls and their 35 s grace; a live query that may read it re-runs in the background about every 5 seconds to stay current (LLP 3000.018). Typing and viewing use short-lived, authorized ephemeral tables in one server process (LLP 3000.017); they never sync or decide durable invariants. A device does not know presence and says so.

## Process not doing

- **2026-09-28 — ordinary mixed search** (LLP 3000.028 §3.3, lane OS round 1).
  Admit the SDK's bounded merge of current server rows and certified Left images
  for the proved single time-ordered word page. This removes application-owned
  online/held selection for that shape. One server call per requested page;
  recomputation pays again from consumed positions. The coordinator shares the
  existing device read allowance. No durable search session, extra synced rows,
  new authority or additional allowance is admitted.

- **2026-09-28 — inferred current-scope word search** (LLP 3000.028 §3.3,
  lane OS). A single bare ordinary word page may derive the exact non-expiring
  membership audience for the existing compact server plan. This removes the
  requirement to repeat that audience predicate in this narrow server query.
  The compiler supplies a scoped words index when absent; it is an ordinary
  schema index, maintained on writes and on devices, with no extra synced rows
  or new authority. The device keeps its original bare scan. Round 0 left ordered composition
  and combined accounting outside its independent subset; round 1 above admits
  that bounded SDK composition. Durable search sessions remain excluded.
- **2026-09-28 — explicit owner-key coverage** (LLP 3000.028 §3.4, Lane OK commission). A public window may opt into a compiler-owned, horizon-free principal key partition to answer ordinary own-key existence offline. Taken off: the exclusion of narrower platform key distribution beside one public window. General union audiences, full own-row replication and per-query absence caches remain excluded. The projection uses existing metered maintains, adoption and whole-partition publication; existing windows do not expand.
- **2026-09-26 — a live query keeps presence current** (LLP 3000.018). A 0.4.2 probe found an observed `connected[p]` reporting `fresh: true` while stale for over a minute, and a comparative builder polled around it. What it unblocks: online marks and presence-aware lists that stay current. Taken off: "a presence stream" as an exclusion for live queries; a presence API, last-seen storage and multi-server presence stay out. Under the author's standing authorization for reworks that make queries excellent (2026-09-25).

- **No drift registries, inventories, line-pinned diagnostics registries, claim digests or frozen-record gates.** Generated projections are built, not committed.
- **No gate bound to an exact commit; no push gated on a battery.** Five blocking checks in sixty seconds, run before push; everything slower on a schedule with bounded tickets.
- **No ceiling raised in slice one.** Budgets are anchored to a competitor's measured number and recorded once in the journal.
- **No standing panel** except the two blind reviews LLP 3000 decision 4 names (partition inversion; the meter's cut on non-uniform scans). The author explicitly commissioned the one-off LLP 3000.008 panel and disjoint Astra implementation lanes on 2026-09-14; its bounded disposition is recorded in that umbrella and LLP 3000 §7.
- **No new LLP number** without first extending LLP 3000 or LLP 2000.000; no spec without running code (`rules/RULES.md`: only implemented specs bind).
- **No second session on the core** during slice one; lanes take the periphery.
- **No test matrix as the primary harness.** The simulator is; real-browser and device witnesses cover only what it cannot reach.
- **No files over 1,500 lines**, including ones copied from Snapback 2. Split on
  the way in. The one exception is the package's published documents
  (`packages/snapback4/README.md` and its linked references): the rule exists to
  keep a *source* file reviewable, and the 0.2.25 calibration measured the cost of
  applying it to a document — splitting the README was that run's single largest
  scoring loss, because the builder then had four places to look instead of one
  (LLP 3000.007 §20.19). A published document is bounded by whether a builder can
  find one way in, not by a line count; the census that enforces this rule covers
  source, and says so.

## Deliberately worse

- No compatibility with Snapback 1 or Snapback 2 apps, packages or on-disk formats.
- No API stability before the clock; every publish is `0.0.x`.
- Sparse prose documentation; the diagnostics and the recipes carry the load.
- One hosted target, SQLite in the production CLI, one platform binary at a time. A separately enabled Postgres evaluation adapter is not a hosted/deployable target (Moves below).

## Moves

- **2026-09-26 — server operation latency (LLP 3000.019 §3.7).** Calibration #22
  measured each read once and could not claim repeated p95/degradation testing.
  Unblocks percentile measurements of the application's own load without a
  custom timing harness. Taken off: a latency harness written by the builder;
  general metrics, tracing infrastructure and an admin console remain excluded.

- **2026-09-23 — Quarry states intent moves onto the doing-list** (Charlie:
  "if you need to try making *significant* architectural reworks in order to
  make the data modeling, queries, and scalability be excellent and elegant,
  you can experiment with that"; LLP 3000.013). Unblocks reads that state
  predicates and order, one `view` declaration for derived data, Following
  without caps, jobs and aggregates without author-chosen bounds, an app
  object and an offline web shell. Taken off: index names and author-chosen
  engine numbers on the paved path; the timeline's promotion, pull routes and
  caps; the "Time in rules" refusal is unchanged. Stands: one interpreter, no
  JavaScript in the data plane, no lowering Quarry to SQL, no relevance-ranked
  search.

- **2026-09-16 — the remaining general-purpose program moves onto the doing-list**
  (Charlie: "complete everything ... we'll remove services when we are done
  with the workroom test rather than wait to add them in ... use the fleet";
  LLP 3000.009 §14.7). Unblocks the §7 integrated-service baseline, C3 production
  Postgres, D's authorized database capabilities and measurement-led C2/E
  work while Workroom continues. Taken off: waiting for Workroom before
  starting services, and keeping production Postgres integration outside the
  current implementation program. The completed Workroom record drives a
  retain/remove pass. Stands: one interpreter and managed writer, no managed
  SQL writes, no JavaScript transactions, no SQL in the first Workroom cell,
  no invented performance/real-provider evidence, no expo-build-1000 load,
  and no new publication or managed-service deployment authority.

- **2026-09-16 — application SQL reads move onto the doing-list** (Charlie: "admit application SQL reads"; LLP 3000.009 §6.2, §14.4, increment D). Unblocks reporting and search over authorized projection inputs and declared database-owned tables, with authorization before selection, ordering and limits. Taken off in the same change: the inspection-only exclusion for application SQL and D's pending-author gate. Implementation and qualification remain pending; SQLite and Postgres halves ship together, channels follow candidates, and A1–A3 plus the fixture pack stay first. Stands: no SQL writes into managed data, no lowering Quarry to SQL, no SQL in the first Snapback brief cell, and no publication authorization.

- **2026-09-15 — a Postgres evaluation backend moves onto the doing-list** (author: "Build the evaluation prototype"). Unblocks concrete evaluation of storage agnosticism, interpreter/database round trips and transactional sync ordering. This bounded prototype replaces full CLI/deployment integration as the next backend task; those product surfaces remain off this increment's doing-list. It shares Quarry, rules, maintains and partition logic, but uses an experimental Postgres store. Native SQL exists only as an explicitly separate comparison workload, not an application escape hatch. SQLite remains the production and local-device store. See [the experiment](./experiments/postgres/README.md).

- **2026-09-15 — the server half of LLP 3000.009 moves onto the doing-list** (author: "begin implementation using astra xhigh to code"; LLP 3000.009 §10.2, increments A1–A3). Unblocks the online-only brief's invitation, webhook and scheduled journeys without a second application server: work records whose authority is bound at admission, ids bound to their operation and arguments, declared action results, a generated handler context with a durable record per external step, declared routes and webhooks, scheduled actions under service seats, and `serve` supervising the runtime. Taken off in the same change: "A jobs framework" narrows — actions, effects and scheduled actions get per-operation retries, deadlines and cancellation; priorities, worker pools and dead letters stay out — and the actions card's "supervise the worker as an ordinary Node process" leaves. Stands: no JavaScript in the data plane, no identity provider in the engine, and no `ctx.sql`, projections or SQL reads in this increment.

- **2026-09-15 — the Postgres access boundary moves onto the doing-list** (LLP 3000.009 §10.2, increment C1). Unblocks measuring Postgres behind a batched access boundary instead of row-at-a-time calls: transaction-scoped prefetch, a pipelined commit tail, one portable index-key bound checked on both stores, and the corpus, conformance and device suites on both stores. Taken off in the same change: the evaluation prototype's single-adapter framing, in which the only next step was an unbatched store. Stands: Postgres is not a hosted or deployable target; its refusals of assets, jobs, actions and schedules, and `serve`, `deploy` and backup on Postgres, wait for increment C3.

- **2026-09-13 — word search, effects, service seats and presence move onto the doing-list** (author: "add all the things we need for Clique and Interview"; the full-brief Clique record's remaining capability lines and Interview's adapter responsibilities). What it unblocks: Clique M5's three search scopes online and offline on one index, M6's push seam without connection leases hand-built in tables, M8's digest emitted rather than logged into a table, Interview's phone sign-in and model workers as a service that mints sessions instead of proxying every request, and the ranked feed of LLP 3000.004 on the `feeds` card. Taken off in the same change: "an embedded JS engine for effects, until measured" (the engine never calls out; a worker does), "word search" from the package's exclusions. Stands: no JavaScript in the data plane, no relevance ranking, no identity provider in the engine.
- **2026-09-12 — expiry, assets and jobs move onto the doing-list** (author: "complete snapback4 to the point where the entire clique benchmark can be run"). What it unblocks: the struck half of the Clique brief (M4 media, M5 view-once and expiry with no client open, M8's scheduled digest). Taken off in the same change: the "one photo path" and "cron syntax" exclusions above narrow to transcoding and to cron beyond `every N [at HH:MM]`; the "time in rules" exclusion stands, answered by `expire at .col` rather than a rule.
- **2026-09-13 — native jobs on (author: "write up an LLP about this and then implement").** Unblocks the scoring half of a feed — floats, vectors, real loops, a typed schema — without putting any of it into Quarry, and gives the model half of LLP 3000.004 a seat inside the bounds: one chunk per commit, the job ceilings, fuel, no I/O. Off the doing-list in the same change: the "external ranker with a service seat" of LLP 3000.004 §6.5 is no longer the only shape for compute over the store; it remains the shape for the network. Ranked and vector search, effects execution and an embedded JS engine stay above.
- **2026-09-13 — `sql`, a fifth named observability verb, moves onto the doing-list** (author ruling on LLP 3000.007 §14.10). Read-only SQL over generated per-table views of the developer's own store, under `dev` or against a `--release` directory; never rule-filtered, never an application surface. What it unblocks: the ground truth two Clique essays said Snapback lacked beside Postgres ("there is no underlying Postgres to query"), and the inspection the 0.2.6 Astra lane did by copying its SQLite file. Taken off in the same change: SQL reads as an application query surface (LLP 3000.007 §9.1) leave the doing-list until the reporting gap is measured after the language relaxations; reporting is Quarry's, inspection is `sql`'s. Stands: no JavaScript in the data plane, one authoring language.

- **2026-09-14 — the simulator witness is published for app builders (LLP 3000.007 §20.10, S30).** Unblocks native offline proof artifacts; replaces the repository-only Metro witness on the doing-list. Real-browser and device witnesses still cover only what the deterministic simulator cannot reach.

- **2026-09-14 — development clock control (S27, calibration F5)** moves onto the doing-list to unblock expiry and scheduled-digest tests without real-minute waits or backdated seeds; waiting on real time leaves the development test path, while production clock controls stay off the doing-list.

- **2026-09-25 — ephemeral tables enact the standing realtime line of LLP 3000.009 §12 (LLP 3000.017).** Unblocks typing and viewing without durable outbox traffic. Nothing leaves the doing-list: this enacts an already admitted scope. Last-seen storage, multi-server presence, a separate presence stream and ephemeral authority over durable invariants remain excluded.
