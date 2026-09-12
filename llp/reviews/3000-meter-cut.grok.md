**Reviewer family:** Grok (Grok CLI 1.0.30, grok-4.6)
**Date:** 2026-09-12
**Scope:** LLP 3000 decision 4, mechanism two — the runtime meter's cut on non-uniform scans (`meter.rs`, `engine/read.rs`, `engine/rules.rs`, `engine/mod.rs`, `replica/interpreter.ts`) at `ce597c58a06d`.
**Method:** Blind, read-only, one model family. Dispositions are recorded in `snapback4/JOURNAL.md` under the same date; no author acceptance is inferred from the verdict.

# LLP 3000 blind review — the meter's cut (grok)

# Blind review: Snapback 4 runtime meter cut on non-uniform scans

**Mechanism:** LLP 3000 decision 4 / LLP 2000.000 §6 — a runtime meter is claimed to apply Snapback 2’s static-ceiling policy at the same points, so the hidden-population oracle is identical: none where the rule hoists, an opaque cap where it does not.

**Baseline (LLP 1001 §3, Snapback 2):** `take` counts visible rows only; a denied candidate consumes examined and rule-probe budgets, never `take`; a hoisted-false range “halts after the single determination without fetching or charging the hidden population row by row” and is viewer-observably identical to a physically empty range; a non-uniform site is **capped-only regardless of runtime candidates**; `Capped` is “one opaque label with no site, stop reason, or take echo”; a nonempty capped page’s `next` is derived only from the last returned (visible) row; an empty capped page is the terminal drain state whether the range was exhausted or a hidden run consumed the budget.

**Verdict: NOT READY**

The server does hoist a uniform-false prefix after one row, counts `take` in visible rows only, and never puts a hidden key into a cursor token. Those are the right *internal* moves. They do not preserve the *observer* surface. `complete` is a runtime-cut bit rather than Snapback 2’s static opaque `Capped` for every non-uniform site; the HTTP wire publishes `metered` actuals and `capped: { meter, site }`; a point `get` charges a different kind on miss vs hidden hit; a mutation’s `E_BOUND` names the actual count. An observer who cannot read a set of rows therefore learns existence, a count (exact, or at granularity of the examined ceiling), and — with a cursor — position. Snapback 2’s policy is not reproduced. LLP 2000.000 §13’s falsifier (“an observable difference between a static ceiling cut and a metered cut on any non-uniform scan”) already holds of `complete` alone.

What is *not* broken on the data channel: hidden and absent point reads both return `null`; a hoisted-false scan and an empty scan both return `[]` with `next: null` **if** the observer cannot see `metered`. The leaks are the meter’s cut label, its numbers, and the `next`/`complete` pairing.

---

## Findings

### High

#### H1. `complete` is “the meter did not cut,” not Snapback 2’s opaque `Capped`

**Where:** `snapback4/crates/snapback4-core/src/engine/mod.rs:199-202`

```rust
let outcome = QueryOutcome {
    complete: runner.meter.capped_at.is_none(),
    capped_at: runner.meter.capped_at.clone(),
    next: if runner.meter.capped_at.is_some() { None } else { next },
```

**Where:** `snapback4/crates/snapback4-core/src/engine/read.rs:181-210` — a non-uniform scan keeps charging `Examined` on every candidate, including denied ones, until `take` visible rows, physical exhaustion, or the ceiling:

```rust
if !self.meter.charge(MeterKind::Examined, 1)? {
    capped = true;
    break 'outer;
}
// ...
if allowed {
    if visible.len() == take {
        has_more = true;
        break 'outer;
    }
    visible.push(row);
    keys.push(key.clone());
} else if visibility.uniform {
    // One hidden row hides the prefix: stop without reading it.
    break 'outer;
}
```

Snapback 2 (`snapback2/crates/snapback2-core/src/engine/execution_record.rs:8-17`) marks `Capped` if the certificate’s completeness is capped-only **or** any executed site is not hoisted, even when the range stopped `Exhausted`. Snapback 4 marks `complete: true` whenever the runtime meter never overflowed.

**Scenario.** Schema:

```q
table notes:
  owner: principal
  at: time
  body: text
  by byTime: at, id
  read <- .owner = viewer
```

Query: `return notes[] last 50 by byTime` (prefix empty ⇒ `scan_visibility` is not uniform; `owner` is not pinned). Viewer: `alice`. Ceiling: `examined = 8192`.

| Store | Alice observes | Reveals |
|---|---|---|
| 0 rows | `data: []`, `complete: true`, `next: null` | — |
| 100 notes, all `owner=bob` | `data: []`, `complete: true`, `next: null` | fewer than 8193 candidates (the 100 hidden rows did not cut) |
| 10_000 notes, all `owner=bob` | `data: []`, `complete: false`, `next: null` | at least 8193 candidates exist that Alice cannot read |
| 50 of Alice’s notes, then 0 more | 50 rows, `complete: true`, `next: null` | range exhausted of *candidates* |
| 50 of Alice’s, then 10_000 of Bob’s | 50 rows, `complete: false`, `next: null` | a hidden run after the last visible row long enough to exhaust examined |

The last two rows are the cardinality oracle LLP 1001 §3 closed by making every non-uniform site `Capped` regardless of what the runtime found. The simulator host still ships `complete` (`snapback4-sim/src/host.rs:55`), so this is visible even where `metered` is stripped.

The online TypeScript client copies `complete` onto the card (`packages/snapback4/src/client.ts` uses `json.complete !== false`). A screen that treats `complete: false` as “there is more” is reading a hidden-population bit.

**Fix.** Derive the public completeness class statically, as Snapback 2 does: if any executed read site is not `visibility.uniform` (equivalently, not hoistable), the result is `capped` / `complete: false` even when the meter did not cut and the range was exhausted. Keep the meter as a backstop that can also cap a uniform site. Do not let a non-uniform exhaustion and a non-uniform budget-cut differ on `complete`.

---

#### H2. Actual `metered` numbers are on the viewer wire

**Where:** `engine/mod.rs:205` (`metered: runner.meter.used` on every `QueryOutcome`); `engine/mod.rs:246,279` (the same `Metered` on sent **and** failed mutations); `snapback4/crates/snapback4/src/serve.rs:262,282-283`:

```rust
Ok(outcome) => respond(request, 200, json!({ "data": wire::to_json(&outcome.data), "complete": outcome.complete, "seq": outcome.seq, "next": outcome.next, "capped": outcome.capped_at.map(|(kind, site)| json!({ "meter": kind, "site": site })), "metered": outcome.metered })),
```

and for writes:

```rust
WriteState::Failed { why, current } => json!({ "state": "failed", "id": id, "why": refusal_json(&why), "current": current.map(|c| wire::to_json(&c)), "metered": outcome.metered }),
```

`Meter::charge` (`meter.rs:114-128`) saturating-adds **before** comparing to the ceiling, so a cut reports `actual = ceiling + 1`, not a clamped bound. LLP 2000.000 §6’s padded-execution escape (“the meter reporting the bound instead of the actual”) is not implemented; there is no padded mode.

**Scenario (exact hidden count).** Same `notes` / `byTime` query as H1. Alice is not an owner of any row.

- 0 rows → `metered.examined = 0`
- 7 hidden rows → `metered.examined = 7`
- 8192 hidden rows → `metered.examined = 8192`, `complete: true` (charge still `<=` ceiling)
- 8193 hidden rows → `metered.examined = 8193`, `complete: false`

That is the size of the hidden population, not an opaque cap. Snapback 2 never put `trace.examined` on the receipt or the client wire.

**Scenario (rule-probe short-circuit).** `read <- .owner = viewer or exists staff[.id, viewer]`. `evaluate` (`rules.rs:94-108`) stops `Or` on the first true arm and `And` on the first false arm; each `Exists` arm charges `RuleProbes` (`read.rs:18-23`). Over a non-uniform `byTime` scan, `metered.rule_probes` equals the number of hidden rows for which `.owner = viewer` was false (every Bob row probes `staff`; an Alice row does not). The ratio `rule_probes / examined` is a structural fact about hidden rows.

**Fix.** `metered` is a builder/test diagnostic (`check --cost`, `test`, `why`), not a viewer-wire field. Strip it from `/q`, `/m`, `snapback4 run`’s default JSON, and `QueryOutcome`’s serde to clients. If a secrecy-sensitive program must not leak even to `test`, implement the declared pad: report each ceiling, not `used`.

---

#### H3. The cut is not opaque: `capped` names which meter and which site

**Where:** `meter.rs:125-126` records `(MeterKind, site)`; `engine/mod.rs:201` copies it onto the outcome; `serve.rs:262` serializes `capped: { "meter": kind, "site": site }` (`MeterKind` is kebab-case: `examined`, `rule-probes`, …). LLP 1001 §3: “one opaque label with no site, stop reason, or take echo.”

**Scenario.** Query with two scans: a public `profiles[] last 10` at site `q.feed:1` and a non-uniform `notes[] last 50 by byTime` at `q.feed:2`.

- No hidden notes, few profiles → no `capped`
- 10_000 hidden notes → `capped: { meter: "examined", site: "q.feed:2" }`

The observer learns *which* range contained enough candidates to hit a budget, and *which* budget. `rule-probes` vs `examined` further distinguishes “the rule ran `exists` on candidates” from “candidates were merely walked.” A query that also builds a large visible object can cut on `output-bytes` instead; seeing `examined` rather than `output-bytes` means the cut was candidate-walk work, not visible output.

**Fix.** Public label is the boolean `complete` (or a single `capped` with no payload). Keep `(kind, site)` inside the engine for `test`/`why`. Same opacity Snapback 2 already specified.

---

#### H4. Point `get`: miss charges `IndexEntries`, hidden hit charges `Examined` (then rule probes)

**Where:** `snapback4/crates/snapback4-core/src/engine/read.rs:61-82`

```rust
/// Hidden and absent are the same word on purpose.
let found = self.tx.lookup(&read.table, &read.index, index, &key)?;
let Some(mut row) = found else {
    self.meter.charge(MeterKind::IndexEntries, 1)?;
    return Ok(Value::Null);
};
materialize_optional_fields(&mut row, table);
if !self.meter.charge(MeterKind::Examined, 1)? {
    return Ok(Value::Null);
}
if self.check_rule(&read.table, Effect::Read, None, &row)? { Ok(row) } else { Ok(Value::Null) }
```

The **data** channel is honest (`null` either way). The **meter** channel is not. Snapback 2 (`get_tracked`) charges `trace.examined` on a hit, then `rollback_candidate` so the hidden hit does not appear on the receipt; a miss is `examined: false` in the *authoritative trace only*.

**Scenario.** `notes` as in H1, unique `byId`. Query: `return notes[id]` with `id` supplied by the caller (or `exists notes[id]`, which is `get != Null` at `runner.rs` `Expr::Exists`). Viewer `alice`. Chat’s `unsend` / `edit` shape `msg = messages[messageId] ! else NOT_FOUND` is the same engine path.

| `id` | Data | `metered` | If examined is already 8192 |
|---|---|---|---|
| no such row | `null` / `NOT_FOUND` | `index_entries += 1`, `examined` unchanged | still `complete: true` |
| Bob’s note | `null` / `NOT_FOUND` | `examined += 1`, plus `rule_probes` if the rule uses `exists` | `examined = 8193` → `complete: false` (query) or `E_BOUND` (mutation) |

Alice confirms a guessed id with one bit (`complete` / which meter grew) even when the program returns `NOT_FOUND`. Padding a public scan to 8192 examined and then probing one id makes this work from `complete` alone (H1), without reading `metered`.

The device interpreter is slightly different and also wrong in this direction: a miss charges nothing (`interpreter.ts:342-345`); a hit charges `examined`. `LocalRead` does not expose `metered`, but a replica that still holds an unreadable row (see M4) can flip `complete` on a guessed id once local examined is at the ceiling.

**Fix.** Charge the same kind, same amount, for miss and hidden hit (both `Examined`, or both `IndexEntries`), and do not let a hidden hit be the observation that crosses a ceiling when a miss would not. Snapback 2’s `rollback_candidate` is the receipt-era form of the same idea: the viewer-visible meter must not retain the hidden candidate’s work.

---

### Medium

#### M1. Hoisted-false vs empty is not viewer-identical once `metered` is visible

**Where:** `read.rs:162-209` with `rules.rs:21-35`. `uniform && !decided_true` still fetches a batch and charges the first candidate; only then does it halt:

```rust
} else if visibility.uniform {
    // One hidden row hides the prefix: stop without reading it.
    break 'outer;
}
```

Empty fetch path (`fetched.is_empty()` at line 176) charges nothing.

LLP 1001 §3: “Empty, two-hidden-row, and at-least-examined-ceiling ranges are therefore viewer-observably identical in that case.” Snapback 2 probes one row, then `rollback_candidate` so the viewer receipt matches physical emptiness.

**Scenario.** Chat-like messages without a `require`:

```q
table messages:
  conversationId: conversations
  at: time
  read <- exists memberships[.conversationId, viewer]
  by byConvTime: conversationId, at, id

query peek(conversationId: conversations):
  return messages[conversationId] last 50 by byConvTime
```

`conversationId` is pinned ⇒ `Visibility { uniform: true, decided_true: false }`. Viewer `mallory` is not a member of `c1`.

- `c1` has no messages → `data: []`, `complete: true`, `metered.examined = 0`, `rule_probes = 0`
- `c1` has 1 or 10_000 messages → `data: []`, `complete: true`, `metered.examined = 1`, `rule_probes = 1` (the first row’s `exists memberships[c1, mallory]`)

Mallory learns whether a guessed conversation is empty. The hoist correctly avoids walking 10_000 rows (good vs non-uniform), but the single determination is still billed to the observer. With H2 unfixed, this is an existence bit per prefix. Chat’s real `thread` query `require exists memberships[...]` fails closed before the scan; the engine still offers the oracle to any program that scans a uniform-false prefix without a prior require.

**Fix.** On a hoisted false verdict, roll the meter back to the pre-probe checkpoint (Snapback 2) **or** always charge a constant reserved unit for a uniform site whether the prefix is empty or false, and never report that unit on the viewer wire. Do not charge `rule_probes` for the determining hidden row onto the observer’s `Metered`.

---

#### M2. Merge sums hidden work across lanes and drops `next` when any lane cuts

**Where:** `read.rs:265-308`. Each lane calls `scan`, which charges denied candidates (H1) or one determining row (M1). `has_more` is computed only from **visible** union size; `query` then nulls `next` if `capped_at` is set (`mod.rs:202`). Merge itself does not consult `capped_at` when minting `page.next` (lines 304-308).

The device copy (`interpreter.ts:409-440`) is the same shape: every lane `scan`s independently; `next` follows visible `hasMore` only.

**Scenario.** `notes` as in H1, plus a public `announcements` table. Query: merge `announcements[] last 50 by byTime` with `notes[] last 50 by byTime` (shared time suffix). Viewer `alice` can read all announcements and none of the notes.

- Announcements: 10 rows. Notes: 0. → `complete: true`, `metered.examined = 10`
- Announcements: 10. Notes: 200 hidden. → `complete: true`, `metered.examined = 210`
- Announcements: 10. Notes: 10_000 hidden. → first or second lane walks notes until examined cuts; `complete: false`, `next: null` even if the announcements lane had `take + 1` visible heads

Alice learns (a) how many hidden notes exist (H2) or at least that some lane had ≥8193 candidates (H1), and (b) which merge is “hungry” if `capped.site` is published (H3). Lane order becomes a starvation channel: a hidden-heavy lane earlier in `merge.lanes` can cut the meter before a later visible lane is read.

**Fix.** After H1–H3: a merge that includes any non-uniform lane is statically `capped`; do not accumulate hidden-lane examined onto a viewer-visible meter; cap (or skip) a non-uniform lane without charging its denied population into the shared budget in an observer-visible way. Do not let a hidden lane erase `next` for visible extra rows unless the public completeness class is already `capped` for the whole merge (Snapback 2: nonempty capped pages still carry `next` from the last *returned* row).

---

#### M3. Mutation `E_BOUND` names actual work; failed writes still carry `metered`

**Where:** `error.rs:107,172-174`:

```rust
#[error("E_BOUND: {kind:?} reached {actual} against the ceiling {ceiling} at {site}")]
Bound { kind: MeterKind, actual: u64, ceiling: u64, site: String },
// ...
refusal.message = format!("{} reached {actual} against the ceiling {ceiling}", kind.word());
refusal.site = Some(site.clone());
```

`mutate` uses `Cut::Abort` (`engine/mod.rs:240`). The failed outcome includes `metered` (`mod.rs:279`; `serve.rs:283`). Device mutations (`interpreter.ts:139`) name the kind and site; `step` also names the actual step count (line 146).

LLP 2000.000 §6 asks the builder-facing rewrite to name actual work. The disclosure claim under review is that a *viewer* does not learn hidden population from that message.

**Scenario.** Mutation:

```q
mutation sweep():
  n = 0
  for row in notes[] last 100 by byTime:
    n = n + 1
  return n
```

`notes` non-uniform as in H1. Viewer `alice`.

- 0 notes → sent, `metered.examined = 0`
- 100 Bob notes → the `for` domain is `scan` of visible rows only, so `n = 0`, but the scan still examined 100 hidden candidates (`read.rs:181`). Sent, `metered.examined = 100`
- 10_000 Bob notes → scan hits examined; `Cut::Abort` → `E_BOUND` “examined rows reached 8193 against the ceiling 8192” at the scan site; `metered.examined = 8193`

Alice learns a lower bound on hidden notes from the refusal text alone, and the exact count from `metered` on the failed body. A point-get mutation (`edit` / `unsend` on a guessed id) plus H4 distinguishes hidden from absent on the failed `metered` even when `why.code` is `NOT_FOUND`.

**Fix.** Viewer-visible `E_BOUND` may name the *kind* and a rewrite, not `actual`, and not a site that is a hidden scan. Do not attach `metered` to `/m` responses. Charge denied candidates internally for DoS, but abort messages must be constant across hidden-empty / hidden-many for the same program (or the mutation must refuse non-uniform scans at `check`, which is Snapback 2’s structural-fact family).

---

#### M4. Device interpreter does not hoist; `complete` becomes an oracle if unreadable rows are local

**Where:** `packages/snapback4/src/replica/interpreter.ts:380-394` — every fetched replica row is charged and `readable()`’d; there is no `scan_visibility`, no `uniform_verdict`, no “one hidden row hides the prefix”:

```ts
const batch = take + 1;
outer: for (;;) {
  const fetched = await this.tx.scan(table, index, prefix, cursor, dir, batch);
  if (fetched.length === 0) break;
  for (const { row, key } of fetched) {
    if (!this.charge("examined")) break outer;
    if (await this.readable(table, row)) {
      if (visible.length === take) { hasMore = true; break outer; }
      visible.push(row);
      lastKey = key;
    }
    cursor = { ...cursor, after: suffixOf(...) };
  }
```

`run` sets `complete: !this.capped && !this.beyondHorizon` and `next: this.capped ? null : ...` (line 156).

Under flip 2 a replica is supposed to hold only the viewer’s partition, so there are no hidden rows to walk. That is a different mechanism (the other decision-4 review). It fails here when the replica *does* still hold unreadable rows: `retain delivered-history` after expulsion (chat `messages` in `apps/chat/snapback/schema.q`), or a buggy inversion.

**Scenario.** Alice was a member of `c1`, held 9_000 messages locally, then was expelled with `delivered-history`. Local `thread(c1)`: membership probe is false for every held row; the interpreter does not halt after one determination; it examines until `examined > 8192`, returns `data: []`, `complete: false`. A conversation in which she held 10 messages returns `[]`, `complete: true`. She learns a lower bound on how much history the device still has that the rule now denies. The server path would have hoisted false after one row (`read.rs:207-209`) and returned `complete: true`.

**Fix.** Port `scan_visibility` / `uniform_verdict` / hoisted-false halt into the TypeScript interpreter (same code, same points). Treat delivered-history rows as a declared exception with a constant completeness class, not a walk of unreadable ids.

---

### Low

#### L1. `Probe::exists` ignores `Ok(false)` from a cap and still looks up

**Where:** `read.rs:18-23`

```rust
fn exists(&mut self, table: &str, index: &str, key: &[Value]) -> Result<bool, RuntimeError> {
    self.meter.charge(MeterKind::RuleProbes, 1)?;
    // ...
    Ok(self.tx.lookup(table, index, index_def, key)?.is_some())
}
```

Under `Cut::Cap`, overflow is `Ok(false)` (`meter.rs:124-128`). `?` only propagates `Err`, so the probe still runs and its boolean is used. The scan then notices `capped_at` and drops the current row even if `allowed` (`read.rs:196-198`) — so a *visible* row whose last probe crossed the ceiling is omitted (correctness), and extra probes after the cut still execute (DoS / a further `rule_probes` tick in `metered`).

The device does the opposite on overflow (`interpreter.ts:469`: `if (!this.charge("probes")) return false`) — exists becomes false without a lookup, which can hide a visible row by a false probe.

**Scenario.** Non-uniform scan, rule `exists memberships[.conversationId, viewer]`, `rule_probes` ceiling 1. First candidate’s probe sets `capped_at` and still returns the real membership boolean; the row is then discarded because `capped_at.is_some()`. Observer with H2/H3 sees `capped.meter = rule-probes` and `metered.rule_probes = 2` if a second `exists` conjunct in the same `And` also runs (`rules.rs:94-99` continues until a false arm).

**Fix.** If `charge` returns `false`, `exists` must not look up and must not return a real boolean (return a cap sentinel the scan already treats as stop). Honor `Ok(false)` at every charge site, not only `scan_with_keys`’s examined loop. Align the device with that stop, rather than mapping overflow to `exists = false`.

---

## What holds (not findings)

- `take` is visible-only; denied candidates do not fill the page (`read.rs:200-209`). That matches LLP 1001’s “never `take`.”
- A uniform-false prefix **stops** after one determining row on the server; it does not walk the hidden population. The remaining oracle on that path is the 0-vs-1 charge (M1) plus wire publication (H2).
- `decided_true` / `Public`/`Allow` skip per-row rule evaluation (`read.rs:163,168,186-187`).
- Cursor tokens are built from the last **visible** key (`read.rs:219-223`; `interpreter.ts:402-404`). A hidden id does not appear inside `next`. The leak is whether `next` is present together with `complete` (H1), not the token’s contents.
- Heap is charged on the visible result array (`runner.rs` `Expr::Scan` / `Expr::Merge`), not on denied candidates.
- The card type (`contract.ts`) does not include `metered` or `capped_at`; the React/online client drops them. The HTTP body and `QueryOutcome` serde still have them. An observer is not limited to the card.

---

## What I could not determine

- **Timing.** Uniform-false still `tx.scan`s a `take+1` batch (`read.rs:173`) before halting; non-uniform uses `max(take+1, 32)`. I did not measure whether wall time or SQLite pages distinguish empty from hoisted-false from a long hidden run. The review is timing-free as specified; a lab measurement could still falsify.
- **Partition inversion.** Whether the replica ever contains a row the viewer cannot read (except the declared `delivered-history` case) is the other decision-4 mechanism. M4 is conditional on that. I did not audit `partition.rs`.
- **Compiler refusals.** I did not fully audit whether `snapback4-lang` still refuses a `count` / page-length / `hasMore` over a non-uniform scan (Snapback 2’s structural-fact family). If those programs compile, H1’s `complete` bit is also a count of visible rows against a hidden walk.
- **Forged cursors.** `decode_cursor_for` accepts any canonical token for the scan’s descriptor (`read.rs:125-128`). I did not construct a client-forged `after` to test whether `metered.examined` of the remainder is a position oracle for a guessed `(at, id)`. Combined with H2 it almost certainly is; I did not run it.
- **`snapback4 test` / hub fixture.** Whether builders treating fixture meters as private is policy; the `/q` wire is not private. I did not run the engine.
- **Steps/heap on rule evaluation.** Rule `evaluate` does not call `meter.step` / `heap`. I did not find a hidden-row step channel. `meter.step` **always aborts**, even in `Cut::Cap` queries (`meter.rs:147-154`); a query that somehow stepped per hidden row would surface as `denied: E_BOUND` rather than `capped`. I did not find that path in `scan_with_keys`.
- **Concurrency / cross-request caching.** Not present in this slice.

---

## Mapping to the claimed channels

| Claim | Result |
|---|---|
| (a) `complete` vs `capped` | **Fails.** Runtime cut vs exhaustion vs “few hidden” are distinct for non-uniform scans (H1). |
| (b) which meter cut, which site | **Fails.** `{ meter, site }` is on `/q` (H3). |
| (c) `next` | Token contents are visible-only (holds). Presence of `next` together with `complete` distinguishes “more visible” from “hidden tail consumed the budget” (H1, M2). Snapback 2 gave nonempty capped pages a `next` from the last returned row and made empty capped the terminal drain for *both* exhaustion and hidden-budget. |
| (d) `metered.*` on the wire | **Fails.** Exact examined / rule-probe / index-entry counts (H2, H4, M1, M3). |
| (e) uniform-false vs empty, timing-free | **Fails** via `metered.examined` 0 vs 1 (M1+H2). Holds on `data` / `complete` / `next` if those numbers are stripped. |
| (f) merges, mixed visibility | **Fails.** Shared meter sums hidden lanes; a hungry hidden lane caps the merge and can drop `next` (M2). |
| (g) mutation `E_BOUND` naming actual work | **Fails.** Message includes `actual` and `site`; failed `/m` includes `metered` (M3). |

The identical-oracle claim in LLP 2000.000 §6 is false of this implementation. Ready would require: static opaque completeness for non-uniform sites; no viewer-visible actuals (`metered`, `capped_at` payload, `E_BOUND.actual`); hoisted-false indistinguishable from empty on every remaining observer channel; the same hoist on the device.
