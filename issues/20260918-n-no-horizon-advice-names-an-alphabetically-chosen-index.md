# N_NO_HORIZON recommends an alphabetically-chosen index, and ignores a `cap` the author wrote

**Filed** 2026-09-18 · **Area** snapback4 / diagnostics / residency · **Status** open

Two defects in the same note, found while measuring why the 0.2.28 Astra-medium
Clique calibration spent 54,982 ms on its first cold feed.

**The note's targeting is not the problem — it is excellent.** The cal12 builder
declared 17 `sync` lines, 12 of them without a horizon. `check` emitted exactly
**one** `N_NO_HORIZON`, and it named `follows` — the table my measurement then
showed to be ~1.7 MB of a 6.7 MB cold acquisition. One note, the right table, on
every check the builder ran from first to last. The suppression rules
(`maintain_for`, `needs_whole_partition`, `cap == prefix`, `prefix == ["id"]`)
are doing exactly their job.

The problem is what that one correct note *said*. The advice attached to it was
an index chosen by alphabetical order, and applying it would have made the app
worse. Perfect signal, zero actionability.

Site: `crates/snapback4-lang/src/bind/mod.rs`, `completeness_notes`.

## 1. HIGH — for `sync public` the recommended horizon index is chosen by name order

```rust
let ordered = table.indexes.iter()
    .find(|(index_name, index)| *index_name != "byId"
        && index.columns().starts_with(&prefix)
        && index.columns().len() > prefix.len())
    .map(|(index_name, _)| index_name.clone());
```

For `Audience::Public`, `prefix` is `Vec::new()`. `columns().starts_with(&[])` is
vacuously true for **every** index, and `columns().len() > 0` is true for every
index. So `find` over a `BTreeMap` returns whichever index name sorts first
alphabetically. Suitability as a horizon is never consulted.

### Reproduction (verified on the calibration lane's own pinned 0.2.28 binary)

The cal12 builder's real `follows` table (`snapback/social.q:1-13`):

```quarry
table follows:
  follower: principal
  target: principal
  at: time
  unique byPair: follower, target
  by byTarget: target, follower
  by byTargetTime: target, at, id
  cap 1000 by follower
  public 'Follow relationships are public.'
  ...
  sync public
```

emits, verbatim:

```
note: schema.q:1:1 — N_NO_HORIZON: table follows: `sync public` has no horizon, ...
  rewrite: sync public last 500 by byPair
```

`byPair` is `follower, target` — a unique pair index with no time order.
`sync public last 500 by byPair` delivers the 500 alphabetically-highest
(follower, target) pairs: an arbitrary slice of the follow graph, not recent
follows and not the viewer's follows. **A builder who applies the advice gets a
residency set with no meaning**, and reads past it go `complete: false`. The
builder who ignored it was behaving rationally.

That the choice is alphabetical and not semantic is directly falsifiable.
Rename `byTargetTime` to `aaTime` — changing nothing but its position in name
order — and the recommendation changes with it:

```
  rewrite: sync public last 500 by aaTime
```

The same weakness exists for a non-empty prefix, where `len() > prefix.len()`
admits any index with one more column whatever its type; it is merely less
visible there, because the grouping is at least correct.

### Smallest change

An index qualifies as a horizon only if the column immediately after the prefix
is a `time` column. If none qualifies, fall through to the branch that already
exists and is already right — the one that tells the author to add the index
first:

```
by byAt: at, id  -- then: sync public last 500 by byAt
```

Today that branch is unreachable for any table that has any index at all.

## 2. MEDIUM — a `cap` that does not bound the sync group is not mentioned

The builder wrote `cap 1000 by follower`. They bounded the table. The cap is
over `follower`; the sync group for `sync public` is the whole public
partition, so the cap bounds nothing a device acquires, and the note correctly
still fires. But the note never mentions the cap, so from the author's chair it
reads as advice that has not noticed what they already did:

> every row of every group a device holds reaches it and stays

— when their groups *are* capped, at 1000. The misreading is wrong and entirely
reasonable, and the binder has everything it needs to prevent it.

Verified: the capped and uncapped schemas produce **byte-identical** notes.

### Smallest change

When the table carries `Cap { by, .. }` with `by != prefix`, name it and say
what it does not bound:

> `cap 1000 by follower` bounds each follower's rows, not what a device
> acquires — `sync public` delivers every follower's rows to every device.

## Why this is worth engineering

`scale_and_limits` fell 20 points to 65 in the 0.2.28 run, on
`coldFirstFeedMs: 54982`. Measured on a settled host against that run's own
surviving full-corpus store: cold acquisition for one persona is 43,721 rows /
6,693,727 bytes, of which `follows` is ~1.7 MB. The note that would have
prevented it fired on every single `check` the builder ran (22 occurrences
across `evidence/`), and was correct, and was ignored.

Horizon adoption across the programme, by declared `sync` lines in each lane's
own `snapback/*.q` (indicative of the pattern, not a note count — most of these
are legitimately suppressed):

| run | synced | horizoned |
|---|---|---|
| cal10 | 15 | 0 |
| cal11 | 15 | 0 |
| cal12 | 17 | 5 |

Note this cuts against the lazy reading: cal12 is the one run whose builder
*did* reach for horizons, and it is the run whose `scale_and_limits` fell. Do
not treat horizon adoption as the score lever on this evidence. The claim here
is narrower and safer — the one note that fired was right, and its advice was
not usable.

The engine already ships the tool that turns this note into a ranked triage
list — `check --residency` prints `largest acquired tables by bytes`, per table
and per persona. The builder never ran it. That is a third, softer finding: the
note points at `check --residency` only from the code explanation, never from
the emitted note itself.

## Evidence

- `~/clique-sb4-20260917-astra-cal12/lanes/astra-snapback4/snapback/social.q:1-13`
- `~/clique-sb4-20260917-astra-cal12/lanes/astra-snapback4/evidence/final-check.txt:2`
  (and 21 further occurrences under `evidence/`)
- `crates/snapback4-lang/src/bind/mod.rs` — `completeness_notes`, the `ordered`
  binding and the `prefix == ["id"] || … Cap { by, .. } if *by == prefix`
  suppression
- `crates/snapback4/src/verbs/residency.rs:63-74` — the ranked report that exists
