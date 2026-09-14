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
- **Observability beyond `why`, `trace`, `logs`, `data`, `sql`.** `sql` is read-only inspection of the developer's own store (LLP 3000.007 §8.8, the Moves line below), never an application surface.
- **A guide corpus.** The compiler's facts, one language card and keyword cards, as Snapback 2; no freshness dates. Every card's Quarry is compiled by the suite and the language card is run, so a card cannot promise a form the parser refuses.

- **Union audiences.** One `sync` line per table. A read rule with a second non-service disjunct is refused with the rewrite, never partially delivered; service grants add no device audience (LLP 3000.007 §20.6). `retain delivered-history` covers the author who keeps their own rows. Several `sync` lines per table wait for an app that needs them.
- **Exact horizon maintenance.** The horizon bounds acquisition (a snapshot, a bootstrap); the log never evicts or back-fills to hold a device's group at exactly N rows. A local read past the horizon says `complete: false`.

- **Time in rules.** A read rule compares with `=` and `!=` only; `.expiresAt > now` is not a rule, because a rule that varies with time is not an audience a partition can hold. A row's life ends by the table line `expire at .col` instead: absent to every reader on every host from that time, swept by the server, the deletion streamed (see Moves).
- **A jobs framework.** No priorities, worker pools, retry policies or dead letters: one FIFO of runs, one chunk at a time, a refused chunk parked with its refusal. Missed period boundaries while a server is down fire once on return, not once per missed period.
- **Asset processing.** No transcoding, thumbnails, rungs or HEIC: the bytes are served as uploaded; JPEG, PNG, WebP and MP4 only; image dimensions and optional MP4 duration read from the header; MP4 dimensions are not extracted.
- **Search beyond word prefixes.** One tokenizer (NFC, lowercase, alphanumeric words), one index shape (`scope, words(cols), order.., id`), one read (`matching`): every term a prefix of some word, the first term's words merged as lanes, at most 32 words a page. No stemming, no ranking by relevance, no phrase or mid-word matching, no per-language folding, no intersection index for the second term (it filters the page).
- **An identity provider.** Guests, password accounts, service seats, and sessions a service mints for accounts the application authenticated itself. No phone, OAuth, magic links or MFA in the engine: an application's worker verifies those and mints the session.
- **Presence beyond the server's own polls.** `connected[p]` counts the long polls a server holds open (and 35 s after one answered); no typing indicators, last-seen storage, multi-server presence or a presence stream. A device does not know and says so.

## Process not doing

- **No drift registries, inventories, line-pinned diagnostics registries, claim digests or frozen-record gates.** Generated projections are built, not committed.
- **No gate bound to an exact commit; no push gated on a battery.** Five blocking checks in sixty seconds, run before push; everything slower on a schedule with bounded tickets.
- **No ceiling raised in slice one.** Budgets are anchored to a competitor's measured number and recorded once in the journal.
- **No standing panel** except the two blind reviews LLP 3000 decision 4 names (partition inversion; the meter's cut on non-uniform scans). The author explicitly commissioned the one-off LLP 3000.008 panel and disjoint Astra implementation lanes on 2026-09-14; its bounded disposition is recorded in that umbrella and LLP 3000 §7.
- **No new LLP number** without first extending LLP 3000 or LLP 2000.000; no spec without running code (`rules/RULES.md`: only implemented specs bind).
- **No second session on the core** during slice one; lanes take the periphery.
- **No test matrix as the primary harness.** The simulator is; real-browser and device witnesses cover only what it cannot reach.
- **No files over 1,500 lines**, including ones copied from Snapback 2. Split on the way in.

## Deliberately worse

- No compatibility with Snapback 1 or Snapback 2 apps, packages or on-disk formats.
- No API stability before the clock; every publish is `0.0.x`.
- Sparse prose documentation; the diagnostics and the recipes carry the load.
- One hosted target, one storage engine (SQLite), one platform binary at a time.

## Moves

- **2026-09-13 — word search, effects, service seats and presence move onto the doing-list** (author: "add all the things we need for Clique and Interview"; the full-brief Clique record's remaining capability lines and Interview's adapter responsibilities). What it unblocks: Clique M5's three search scopes online and offline on one index, M6's push seam without connection leases hand-built in tables, M8's digest emitted rather than logged into a table, Interview's phone sign-in and model workers as a service that mints sessions instead of proxying every request, and the ranked feed of LLP 3000.004 on the `feeds` card. Taken off in the same change: "an embedded JS engine for effects, until measured" (the engine never calls out; a worker does), "word search" from the package's exclusions. Stands: no JavaScript in the data plane, no relevance ranking, no identity provider in the engine.
- **2026-09-12 — expiry, assets and jobs move onto the doing-list** (author: "complete snapback4 to the point where the entire clique benchmark can be run"). What it unblocks: the struck half of the Clique brief (M4 media, M5 view-once and expiry with no client open, M8's scheduled digest). Taken off in the same change: the "one photo path" and "cron syntax" exclusions above narrow to transcoding and to cron beyond `every N [at HH:MM]`; the "time in rules" exclusion stands, answered by `expire at .col` rather than a rule.
- **2026-09-13 — native jobs on (author: "write up an LLP about this and then implement").** Unblocks the scoring half of a feed — floats, vectors, real loops, a typed schema — without putting any of it into Quarry, and gives the model half of LLP 3000.004 a seat inside the bounds: one chunk per commit, the job ceilings, fuel, no I/O. Off the doing-list in the same change: the "external ranker with a service seat" of LLP 3000.004 §6.5 is no longer the only shape for compute over the store; it remains the shape for the network. Ranked and vector search, effects execution and an embedded JS engine stay above.
- **2026-09-13 — `sql`, a fifth named observability verb, moves onto the doing-list** (author ruling on LLP 3000.007 §14.10). Read-only SQL over generated per-table views of the developer's own store, under `dev` or against a `--release` directory; never rule-filtered, never an application surface. What it unblocks: the ground truth two Clique essays said Snapback lacked beside Postgres ("there is no underlying Postgres to query"), and the inspection the 0.2.6 Astra lane did by copying its SQLite file. Taken off in the same change: SQL reads as an application query surface (LLP 3000.007 §9.1) leave the doing-list until the reporting gap is measured after the language relaxations; reporting is Quarry's, inspection is `sql`'s. Stands: no JavaScript in the data plane, one authoring language.
