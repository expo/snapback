# 0.4.4 integration

Branch `sb4-intent/integration-044`, from `main` at `da21a2792` (calibration
#22's record), with `main` merged twice: at `a16574d7e` (the wasm diet and
the author's hold) and at `674998886` (the image-list fix and the hold's
release). The supervisor integrated by hand. Codex lanes (GPT-6 Astra)
wrote each lane on `expo-build-1000`, and every round was reviewed blind by
Astra and Grok. Lane R's lock and residency code tripped OpenAI's safety
filter on Astra's side for two rounds, so Grok and the supervisor's own
reading reviewed those.

## What it carries

| Lane | Rounds | What |
|---|---|---|
| SP | 0–4 | The scale certificate's precision: one walk with three-valued tests, facts judged under what is in force at each statement, flow-sensitive boolean bindings, whole-job sweeps only where reached. |
| O | 0–4 | P3 part 4: `pendingWrites` lists queued writes, predicted or not, on both clients and in React. |
| P2 | 0–3 | P2: `min` and `max` of an expression of the row. |
| P1 | 0–4 | P1: sync windows by several columns, and `N_SYNC_ORDER` when a query's order cannot be served from the window. |
| K | 0–8 | P3 parts 1–3: `keep: true` keeps the last answer during loading, and a kept watch lingers 30 s as the live watch it was (revision 5). |
| R | 0–4 | P8: `client.residency()`, and `E_STORE_BUSY` naming the live server instead of `database is locked`, for CLI commands and process devices. |
| EK | 0–1 | Calibration #22's typing flicker: the ephemeral card pairs its typing reads with `keep: true`; two timing tests measure what they claim. |
| P5 | 0–3 | [LLP 3000.020](../../../llp/3000.020-an-unread-count-the-device-can-certify.rfc.md): a device certifies a row-keyed unread count over an expiring source from its window, over existing indexes. |
| AD | 0–4 | P10: adding a view never stalls reads. Adoption over a Clique-scale store fell from 167 s to about 6 s; queries and sync read the last committed generation on detached WAL readers throughout. |
| LT | 0–3 | P11: the server records p50/p95/p99 per operation, with engine wait apart; `doctor --latency`. |

## Merges and resolutions

- **SP** (`0ac5a4493`), **O** (`4e28772b3`), **P2** (`94b5ef9cd`) and **P1**
  (`9a164923b`) merged with only `JOURNAL.md` conflicts. Two follow-ups:
  - P2's device test built the outbox entry lane O had extended, so it gained
    O's `dispatch` field (`99d23194e`).
  - The language card's first block now carries both P1's and P2's edits,
    so `tests/fixtures/guide-before.json` was re-pinned from the generator
    (`545a6ec18`).
- **K** (`cfa35e161`). The client files conflicted with O's pending writes.
  Each resolution kept both sides: imports, `close()` and sign-out ordering,
  and the React hooks.
- **The native fixture's lock** (`8865c4731`). It named `snapback4-native`
  0.4.2 after the 0.4.3 bump, so every suite run rewrote it. The 0.4.4 bump
  now updates it.
- **R** (`96be964b2`). K and R had each extracted `nativeInstaller` into
  `local-native.ts`, with different signatures and identical logic. The
  merge keeps O's signature and call site.
- **R's surviving mutation.** A busy store's refusal now names a live
  server's published address, and a test proves it (`e43bb793d`).
- **EK** (`8abfc0514`) and **P5** (`23fc23725`, round 3 `cf9666617`) merged
  with only `JOURNAL.md` conflicts.
- **P5's surviving mutation.** The row-view page receipt now includes its
  lookahead (`20befdc8a`).
- **`main`, first merge** (`a16574d7e`): the wasm diet and the author's hold.
  - P5 and the diet had made the same refactor, one predicate walker shared
    by ordinary and row-keyed contributions. The merge keeps `main`'s name,
    `matches_with_member`.
  - The diet gated `use crate::value::object` behind `sqlite`, but P5's device
    authority check builds a probe row on every host. It now names the
    function by path (`0cc3e0a15`).
- **LT** (`2ddaf6802`). LT had merged the integration branch itself,
  resolving its conflicts with R's store ownership there.
- **`doctor`** dials the loopback address a persisted server published, not
  always 127.0.0.1 (`6f49e337f`).
- **`main`, second merge** (`674998886`): the image-list fix and the hold's
  release.
  - The fix gave `release_asset` its recorded cell, so P5's counting test
    wrapper takes the new signature (`4cb6780d1`). Lane A5's suite found it,
    and AD's merge made the same correction.
- **AD** (`9ff7ad3cf`). AD merged the integration branch into its own first,
  resolving its conflicts with R, P5, LT and the diet there.
  - After a database file is replaced under a running server, R's test had
    expected reads to keep serving the original through the writer. AD's
    detached readers now answer with a retryable `E_STORE` "moved or was
    replaced" instead, and the test says so. A replaced store needs a
    restart either way.

## Measurements

- **Wasm.** The integrated tree measures 1,980,253 B raw and 571,841 B gzip
  (Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt). `main`'s base, with the
  diet and the image-list fix, is 569,966 B gzip, so the lanes add
  +1,875 B gzip of shared-interpreter and device code. The ratchet is
  measured + 1,000 = 572,841 B, with its reason in `metrics/wasm-budget.json`.
- **Adoption** (lane AD's fixture: M7 → M8 of the calibration program,
  1.45 M rows, 9.1 M index entries). Adoption took 167 s before and about
  6.4–6.9 s after. A query issued during adoption waited 167 s before and
  about 0.5 ms after, measured inside the SQLite transaction. Over HTTP
  during adoption, a query answers in about 5 ms and a sync in about 9 ms;
  `/changes` waits out the adoption. Rows, index entries, log images and
  commit records are exactly equal to the old rebuild's.
- **Latency recording** (lane LT): about 70–82 ns a request, and about
  7.7 KB per operation.
- **The unread certificate** (lane P5): it covers the real receipt in every
  case, for example 303 examined against 303 for a 100-row page with its
  lookahead.

## Review record

Verdicts per round (Astra / Grok). Lane R's lock code tripped Astra's
safety filter; Grok and the supervisor reviewed those rounds.

| Lane | Rounds reviewed | Final verdicts |
|---|---|---|
| SP | r0–r3 | r3: READY WITH CHANGES / READY WITH CHANGES; r4 applied them |
| O | r0–r3 | r3: READY WITH CHANGES / READY WITH CHANGES; r4 applied them |
| P2 | r0–r3 | r3: READY / READY |
| P1 | r0–r3 | r3: READY WITH CHANGES / READY WITH CHANGES; r4 applied them |
| K | r2–r7 | NOT READY through r7; r8 answered the last findings and merged under the convergence rule |
| R | r0–r4 | r4: — / READY |
| EK | r0–r1 | r0: READY WITH CHANGES; r1: — / READY |
| P5 | RFC r0–r1, code r1–r3 | r3: — / READY |
| AD | r0–r4 | r2: NOT READY / READY; r3: NOT READY / NOT READY; r4 in review at landing |
| LT | r0–r3 | r2: READY / NOT READY; r3: — / READY WITH CHANGES (one Low, fixed in `6f49e337f`) |

The reviews are kept on the lane host, `~/sb4-intent/reviews/`.

## Not in this release

- **Retaining list assets offline.** 0.4.4 carries the image-list placement
  fix from `main` (the M5 lane's, which the author held the release for).
  Its device half, retaining list elements offline as scalar media are, is
  lane A5, for the next patch. It ports the device work of lane A, which
  fixed the same bug on this host before the hold named its owner.
- **`/changes` during an adoption** waits for the writer, which a durable
  reconnect needs (`issues/20260926-snapback4-changes-waits-for-adoption.md`).
- **LLP 3000.021** (Accepted) plans 0.4.5 from the 0.4.3 comparative.
