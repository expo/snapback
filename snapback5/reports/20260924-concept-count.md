# Concept count at commission — 2026-09-24

Lane A, LLP 4000 §9.6 step 2. Baseline commit:
`5d6047841235ed1714b43999bf68575fc1e60cbd` on `sb5/a-concept-count`.
No Snapback 5 runtime is implemented by this measurement.

| Arm | Surface | Runtime | Check concepts | Total |
| --- | ---: | ---: | ---: | ---: |
| Snapback 4 guide | 161 | 13 | 14 | **188** |
| Snapback 5 §3.1 | 48 | 13 | 7 | **68** |

Invocation (Node 24.18.0):

```sh
node snapback5/tools/concept-count.mjs --arm snapback4
node snapback5/tools/concept-count.mjs --arm snapback5
```

Each invocation executes `npx --no-install snapback4 check`, using the
locally built `snapback4` 0.4.0 package shim and debug binary, on a
byte-identical scratch copy of the committed `intent-clique.q`. Generated
files stay under ignored `snapback5/.work/concept-count/`. The two generated
APIs have the same SHA-256, recorded below. Entries have representative
source locations; a parenthesized count records additional matches.
The [tool guide](../tools/README.md) gives build prerequisites and the
extraction method; [LLP 4000 §7.1](../../llp/4000-snapback5.rfc.md#71-the-count-at-commission)
records this result in the design of record.

## Ambiguities, choices and deviations

1. The brief says five bullets, but §3.1 has six. All six count, including
   Work. This is the larger population. The explicit backtick-span rule
   determines entry boundaries: `(old, next)` remains one tuple form;
   `first` and `last N by` are separate entries. Whitespace wraps collapse;
   repeated entries such as `insert`, `update`, `delete` and `written by`
   count once within the surface bucket.
2. Derived concepts use the larger reading: depth step and trigger are
   separate, and eviction and retention are separate. The two eligibility
   words `server` and `device` are separate in Snapback 4. Device admission
   is one concept, not one charge per table. The three buckets are added:
   an authored form charged again as a check concept is not deduplicated
   across buckets. The prescribed five residency notes count even when
   this particular fixture does not emit them; no other diagnostic-code
   catalogue enters the count.
3. Snapback 4's surface is extracted from the language/keyword cards,
   including inline reference spans and the three cards embedded in
   `guide.rs`. Its optional server forms and documented older spellings
   are included; the smaller Clique-only population is not substituted.
   Grammar recognizers normalize names and numeric bounds, retain distinct
   modifiers and operators, and exclude payload identifiers, string
   contents, comments and JS fences. `codes.rs`, `discovery.rs` and starter
   templates are not keyword cards. The list below is computed, not
   hand-counted. This recognizes the documented forms; adding a new form
   requires adding its recognizer and example.
4. **Demonstrable source-layout deviation:** generated `api.ts` does not
   inline `Read`, `Write`, or auth states. It imports
   `snapback4/contract`. The tool reads the actual union alternatives in
   `contract.ts` and `AuthState` in `app.ts`; counting only inline
   definitions would incorrectly charge zero. Both fresh and replayed
   `Write.sent` count (four Write variants, not three state labels).
   Runtime is three Read variants + four Write variants + three auth
   states + `E_GENERATION` + two distinct generated refusal codes = 13.
   `E_GENERATION` is explicitly required by §7 even though this API does
   not print it. No source was changed to make the generator fit the brief.
5. **Comparability limit:** §3.1 mentions column types, control flow and
   builtins in prose without enumerating their backtick entries. The
   explicit commissioned rule does not expand that prose. Snapback 4's
   guide enumerates these forms. Consequently the 120-point difference
   is a difference between the requested documentary populations, not
   evidence that 120 equivalent concepts disappear. The shared-baseline
   additions are absent from this Snapback 4 snapshot but present in the
   proposed list. Both arms must be recounted after those additions and
   at calibration. The seven derived check concepts are proposed, not
   implemented output. This report introduces no ratchet or capability
   claim.
6. The prescribed Volta Node path was absent. Node 24.18.0 was installed
   under this worktree's ignored `.work/toolchain/` and placed first on
   PATH. No other worktree was used. The root `llp-orient` skill symlinks
   had missing targets and no installed copy was found; orientation used
   the named LLPs and guide cards directly. The specific read-only
   Snapback 4 constraint puts the dated entry in Snapback 5's JOURNAL;
   Snapback 4's tracked files, guide and journal are unchanged. Build
   commands produce their ordinary ignored dependencies and artifacts.

## What compiles

This lane adds no Quarry form, parser, engine or device behavior. Its two
new executable forms are the `--arm snapback4` and `--arm snapback5`
commands above. The existing committed Clique target compiles through
`npx snapback4 check`; representative existing forms are:

```quarry
view following: activity where .actor = viewer or exists follows[viewer, .actor]
```

The exact target is the hashed fixture below; §3.1's `written by`,
`sequence by` and row-keyed view remain proposals for the shared-baseline
lanes, and this report does not claim they compile.

## snapback4

Surface: **161**; runtime: **13**; check: **14**; total: **188**.

### surface (161)

- `! else CODE` — snapback4/crates/snapback4-lang/src/guide/app.rs:69 (+15 other source locations)
- `!=` — snapback4/crates/snapback4-lang/src/guide.rs:217 (+22 other source locations)
- `%` — snapback4/crates/snapback4-lang/src/guide/language.rs:235
- `(a, b) = expr` — snapback4/crates/snapback4-lang/src/guide/language.rs:220 (+4 other source locations)
- `(old, next)` — snapback4/crates/snapback4-lang/src/guide/language.rs:36 (+3 other source locations)
- `*` — snapback4/crates/snapback4-lang/src/guide/language.rs:354 (+4 other source locations)
- `* (shape spread)` — snapback4/crates/snapback4-lang/src/guide/feeds.md:18 (+8 other source locations)
- `+` — snapback4/crates/snapback4-lang/src/guide.rs:217 (+27 other source locations)
- `-` — snapback4/crates/snapback4-lang/src/guide/bounds.rs:109 (+14 other source locations)
- `...shape` — snapback4/crates/snapback4-lang/src/guide/language.rs:429 (+5 other source locations)
- `.col` — snapback4/crates/snapback4-lang/src/guide.rs:137 (+594 other source locations)
- `/` — snapback4/crates/snapback4-lang/src/guide/language.rs:233 (+2 other source locations)
- `<` — snapback4/crates/snapback4-lang/src/guide/jobs.rs:205 (+7 other source locations)
- `<=` — snapback4/crates/snapback4-lang/src/guide.rs:308 (+7 other source locations)
- `<=N` — snapback4/crates/snapback4-lang/src/guide.rs:133 (+91 other source locations)
- `<table> reference` — snapback4/crates/snapback4-lang/src/guide/actions.rs:111 (+104 other source locations)
- `=` — snapback4/crates/snapback4-lang/src/guide.rs:137 (+338 other source locations)
- `>` — snapback4/crates/snapback4-lang/src/guide/bounds.rs:109 (+9 other source locations)
- `>=` — snapback4/crates/snapback4-lang/src/guide/jobs.rs:205 (+10 other source locations)
- `?` — snapback4/crates/snapback4-lang/src/guide.rs:208 (+98 other source locations)
- `??` — snapback4/crates/snapback4-lang/src/guide/language.rs:298 (+4 other source locations)
- `M..N` — snapback4/crates/snapback4-lang/src/guide/language.rs:110 (+7 other source locations)
- `[column = value]` — snapback4/crates/snapback4-lang/src/guide/app.rs:22 (+47 other source locations)
- `[key]` — snapback4/crates/snapback4-lang/src/guide.rs:147 (+247 other source locations)
- `[type] <=N` — snapback4/crates/snapback4-lang/src/guide/language.rs:283 (+5 other source locations)
- `action` — snapback4/crates/snapback4-lang/src/guide/actions.rs:11 (+4 other source locations)
- `after c` — snapback4/crates/snapback4-lang/src/guide.rs:193 (+70 other source locations)
- `after insert` — snapback4/crates/snapback4-lang/src/guide/app.rs:22 (+5 other source locations)
- `allow` — snapback4/crates/snapback4-lang/src/guide.rs:140 (+14 other source locations)
- `and` — snapback4/crates/snapback4-lang/src/guide.rs:154 (+68 other source locations)
- `as service` — snapback4/crates/snapback4-lang/src/guide/actions.rs:14 (+4 other source locations)
- `at HH:MM` — snapback4/crates/snapback4-lang/src/guide/jobs.rs:221 (+3 other source locations)
- `at(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:241 (+1 other source locations)
- `backoff` — snapback4/crates/snapback4-lang/src/guide/actions.rs:11 (+5 other source locations)
- `bool` — snapback4/crates/snapback4-lang/src/guide/feeds.md:234 (+16 other source locations)
- `break` — snapback4/crates/snapback4-lang/src/guide/jobs.rs:77 (+4 other source locations)
- `bucket(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:13 (+9 other source locations)
- `by .col` — snapback4/crates/snapback4-lang/src/guide.rs:138 (+129 other source locations)
- `by <index>` — snapback4/crates/snapback4-lang/src/guide/feeds.md:317 (+5 other source locations)
- `by <index>: <columns>` — snapback4/crates/snapback4-lang/src/guide/feeds.md:236 (+6 other source locations)
- `bytes` — snapback4/crates/snapback4-lang/src/guide/types.rs:27
- `cancellation` — snapback4/crates/snapback4-lang/src/guide/actions.rs:11 (+6 other source locations)
- `cap N` — snapback4/crates/snapback4-lang/src/guide/bounds.rs:195 (+8 other source locations)
- `cap N by` — snapback4/crates/snapback4-lang/src/guide/app.rs:31 (+21 other source locations)
- `chunk` — snapback4/crates/snapback4-lang/src/guide/language.rs:649
- `connected` — snapback4/crates/snapback4-lang/src/guide/effects.rs:218 (+16 other source locations)
- `continue` — snapback4/crates/snapback4-lang/src/guide/language.rs:228 (+2 other source locations)
- `count … by` — snapback4/crates/snapback4-lang/src/guide.rs:139 (+43 other source locations)
- `count(…)` — snapback4/crates/snapback4-lang/src/guide/bounds.rs:47 (+22 other source locations)
- `created` — snapback4/crates/snapback4-lang/src/guide/jobs.rs:183 (+6 other source locations)
- `cursor` — snapback4/crates/snapback4-lang/src/guide.rs:219 (+55 other source locations)
- `day(…)` — snapback4/crates/snapback4-lang/src/guide/indexes.rs:59 (+15 other source locations)
- `deadline` — snapback4/crates/snapback4-lang/src/guide/actions.rs:11 (+5 other source locations)
- `decimal` — snapback4/crates/snapback4-lang/src/guide/language.rs:124 (+1 other source locations)
- `default` — snapback4/crates/snapback4-lang/src/guide/feeds.md:234 (+17 other source locations)
- `delete` — snapback4/crates/snapback4-lang/src/guide.rs:212 (+55 other source locations)
- `deny` — snapback4/crates/snapback4-lang/src/guide.rs:211 (+20 other source locations)
- `divmod(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:220 (+2 other source locations)
- `effect` — snapback4/crates/snapback4-lang/src/guide/effects.rs:194 (+12 other source locations)
- `else` — snapback4/crates/snapback4-lang/src/guide/programs.rs:59
- `else if` — snapback4/crates/snapback4-lang/src/guide/feeds.md:353 (+3 other source locations)
- `emit` — snapback4/crates/snapback4-lang/src/guide/effects.rs:10 (+14 other source locations)
- `emit … once` — snapback4/crates/snapback4-lang/src/guide/effects.rs:10 (+3 other source locations)
- `enum` — snapback4/crates/snapback4-lang/src/guide/app.rs:28 (+7 other source locations)
- `every` — snapback4/crates/snapback4-lang/src/guide/actions.rs:14 (+10 other source locations)
- `exists` — snapback4/crates/snapback4-lang/src/guide.rs:260 (+129 other source locations)
- `expire at` — snapback4/crates/snapback4-lang/src/guide.rs:213 (+4 other source locations)
- `false` — snapback4/crates/snapback4-lang/src/guide/bounds.rs:14 (+51 other source locations)
- `first` — snapback4/crates/snapback4-lang/src/guide/app.rs:60 (+27 other source locations)
- `first(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:236 (+2 other source locations)
- `fn` — snapback4/crates/snapback4-lang/src/guide/jobs.rs:204 (+9 other source locations)
- `for` — snapback4/crates/snapback4-lang/src/guide.rs:193 (+28 other source locations)
- `format` — snapback4/crates/snapback4-lang/src/guide/language.rs:110 (+7 other source locations)
- `format handle` — snapback4/crates/snapback4-lang/src/guide/language.rs:110 (+5 other source locations)
- `format url` — snapback4/crates/snapback4-lang/src/guide/language.rs:111 (+1 other source locations)
- `group(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:240 (+2 other source locations)
- `guests` — snapback4/crates/snapback4-lang/src/guide/personas.rs:57
- `held` — snapback4/crates/snapback4-lang/src/guide/language.rs:196 (+3 other source locations)
- `hour(…)` — snapback4/crates/snapback4-lang/src/guide/feeds.md:236 (+10 other source locations)
- `id` — snapback4/crates/snapback4-lang/src/guide/actions.rs:11 (+28 other source locations)
- `if` — snapback4/crates/snapback4-lang/src/guide/effects.rs:218 (+31 other source locations)
- `if absent` — snapback4/crates/snapback4-lang/src/guide/feeds.md:327 (+25 other source locations)
- `if … else` — snapback4/crates/snapback4-lang/src/guide.rs:217 (+3 other source locations)
- `image` — snapback4/crates/snapback4-lang/src/guide.rs:296 (+2 other source locations)
- `immutable` — snapback4/crates/snapback4-lang/src/guide/app.rs:32 (+41 other source locations)
- `in` — snapback4/crates/snapback4-lang/src/guide.rs:193 (+41 other source locations)
- `insert` — snapback4/crates/snapback4-lang/src/guide.rs:137 (+138 other source locations)
- `int` — snapback4/crates/snapback4-lang/src/guide.rs:216 (+24 other source locations)
- `job` — snapback4/crates/snapback4-lang/src/guide/effects.rs:7 (+9 other source locations)
- `join(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:232 (+2 other source locations)
- `json` — snapback4/crates/snapback4-lang/src/guide/language.rs:125 (+1 other source locations)
- `last N by` — snapback4/crates/snapback4-lang/src/guide.rs:138 (+64 other source locations)
- `last(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:241 (+1 other source locations)
- `lower(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:232 (+1 other source locations)
- `maintain` — snapback4/crates/snapback4-lang/src/guide/feeds.md:217 (+4 other source locations)
- `matching` — snapback4/crates/snapback4-lang/src/guide/indexes.rs:51 (+18 other source locations)
- `max(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:241 (+1 other source locations)
- `merge` — snapback4/crates/snapback4-lang/src/guide/feeds.md:320 (+1 other source locations)
- `min(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:241 (+1 other source locations)
- `money` — snapback4/crates/snapback4-lang/src/guide/language.rs:123 (+1 other source locations)
- `mutation` — snapback4/crates/snapback4-lang/src/guide.rs:150 (+76 other source locations)
- `native` — snapback4/crates/snapback4-lang/src/guide/language.rs:337 (+5 other source locations)
- `new` — snapback4/crates/snapback4-lang/src/guide.rs:180 (+11 other source locations)
- `not` — snapback4/crates/snapback4-lang/src/guide.rs:190 (+37 other source locations)
- `now` — snapback4/crates/snapback4-lang/src/guide.rs:151 (+79 other source locations)
- `null` — snapback4/crates/snapback4-lang/src/guide.rs:217 (+58 other source locations)
- `once` — snapback4/crates/snapback4-lang/src/guide.rs:296 (+1 other source locations)
- `online only` — snapback4/crates/snapback4-lang/src/guide.rs:141 (+53 other source locations)
- `or` — snapback4/crates/snapback4-lang/src/guide.rs:154 (+33 other source locations)
- `password` — snapback4/crates/snapback4-lang/src/guide/personas.rs:56
- `post` — snapback4/crates/snapback4-lang/src/guide/language.rs:479 (+4 other source locations)
- `predicts` — snapback4/crates/snapback4-lang/src/guide/language.rs:301 (+7 other source locations)
- `principal` — snapback4/crates/snapback4-lang/src/guide.rs:134 (+113 other source locations)
- `public` — snapback4/crates/snapback4-lang/src/guide.rs:136 (+59 other source locations)
- `query` — snapback4/crates/snapback4-lang/src/guide.rs:146 (+95 other source locations)
- `range(…)` — snapback4/crates/snapback4-lang/src/guide/bounds.rs:147 (+6 other source locations)
- `read` — snapback4/crates/snapback4-lang/src/guide.rs:140 (+56 other source locations)
- `require … else` — snapback4/crates/snapback4-lang/src/guide.rs:307 (+35 other source locations)
- `retain delivered-history` — snapback4/crates/snapback4-lang/src/guide/app.rs:49 (+4 other source locations)
- `retain until-revoked` — snapback4/crates/snapback4-lang/src/guide/sync.rs:293 (+1 other source locations)
- `retry` — snapback4/crates/snapback4-lang/src/guide/actions.rs:11 (+5 other source locations)
- `return` — snapback4/crates/snapback4-lang/src/guide.rs:147 (+138 other source locations)
- `returns` — snapback4/crates/snapback4-lang/src/guide/actions.rs:11 (+3 other source locations)
- `route` — snapback4/crates/snapback4-lang/src/guide/language.rs:479 (+4 other source locations)
- `schedule` — snapback4/crates/snapback4-lang/src/guide/actions.rs:14 (+10 other source locations)
- `search` — snapback4/crates/snapback4-lang/src/guide/indexes.rs:51 (+11 other source locations)
- `secrets` — snapback4/crates/snapback4-lang/src/guide/actions.rs:11 (+6 other source locations)
- `server` — snapback4/crates/snapback4-lang/src/guide/language.rs:274 (+1 other source locations)
- `sha256(…)` — snapback4/crates/snapback4-lang/src/guide/bounds.rs:32 (+2 other source locations)
- `shape` — snapback4/crates/snapback4-lang/src/guide/language.rs:182 (+3 other source locations)
- `slice(…)` — snapback4/crates/snapback4-lang/src/guide/effects.rs:219 (+4 other source locations)
- `sort(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:241 (+2 other source locations)
- `sorted(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:221 (+1 other source locations)
- `sum … of … by` — snapback4/crates/snapback4-lang/src/guide/language.rs:145 (+3 other source locations)
- `sum(…)` — snapback4/crates/snapback4-lang/src/guide/bounds.rs:47 (+6 other source locations)
- `sync` — snapback4/crates/snapback4-lang/src/guide.rs:138 (+70 other source locations)
- `sync by .col` — snapback4/crates/snapback4-lang/src/guide/sync.rs:32 (+1 other source locations)
- `sync last N by` — snapback4/crates/snapback4-lang/src/guide.rs:138 (+14 other source locations)
- `sync public` — snapback4/crates/snapback4-lang/src/guide/feeds.md:155 (+23 other source locations)
- `sync to` — snapback4/crates/snapback4-lang/src/guide.rs:214 (+25 other source locations)
- `table` — snapback4/crates/snapback4-lang/src/guide.rs:132 (+102 other source locations)
- `text` — snapback4/crates/snapback4-lang/src/guide.rs:133 (+92 other source locations)
- `time` — snapback4/crates/snapback4-lang/src/guide.rs:135 (+71 other source locations)
- `tokens(…)` — snapback4/crates/snapback4-lang/src/guide/bounds.rs:147 (+4 other source locations)
- `trim(…)` — snapback4/crates/snapback4-lang/src/guide/language.rs:232 (+1 other source locations)
- `true` — snapback4/crates/snapback4-lang/src/guide/actions.rs:111 (+26 other source locations)
- `unique` — snapback4/crates/snapback4-lang/src/guide/app.rs:30 (+54 other source locations)
- `unique … else CODE 'message'` — snapback4/crates/snapback4-lang/src/guide/indexes.rs:14 (+6 other source locations)
- `update` — snapback4/crates/snapback4-lang/src/guide.rs:211 (+46 other source locations)
- `update … if` — snapback4/crates/snapback4-lang/src/guide/language.rs:304 (+1 other source locations)
- `upsert` — snapback4/crates/snapback4-lang/src/guide/language.rs:286 (+8 other source locations)
- `use identity …` — snapback4/crates/snapback4-lang/src/guide/app.rs:12 (+4 other source locations)
- `use personas` — snapback4/crates/snapback4-lang/src/guide/app.rs:13 (+3 other source locations)
- `use server` — snapback4/crates/snapback4-lang/src/guide/actions.rs:10 (+12 other source locations)
- `video` — snapback4/crates/snapback4-lang/src/guide.rs:297 (+3 other source locations)
- `view` — snapback4/crates/snapback4-lang/src/guide.rs:139 (+45 other source locations)
- `viewer` — snapback4/crates/snapback4-lang/src/guide.rs:137 (+327 other source locations)
- `wait` — snapback4/crates/snapback4-lang/src/guide/language.rs:479 (+3 other source locations)
- `walk … up … depth` — snapback4/crates/snapback4-lang/src/guide/bounds.rs:145 (+2 other source locations)
- `where` — snapback4/crates/snapback4-lang/src/guide.rs:220 (+89 other source locations)
- `x = expr` — snapback4/crates/snapback4-lang/src/guide.rs:306 (+71 other source locations)

### runtime (13)

- `AuthState.restoring` — snapback4/packages/snapback4/src/app.ts
- `AuthState.signed-in` — snapback4/packages/snapback4/src/app.ts
- `AuthState.signed-out` — snapback4/packages/snapback4/src/app.ts
- `CANNOT_FOLLOW_SELF` — generated api.ts
- `E_GENERATION` — llp/4000-snapback5.rfc.md §7 (explicit runtime state)
- `NOT_FOUND` — generated api.ts
- `Read.data` — snapback4/packages/snapback4/src/contract.ts
- `Read.denied` — snapback4/packages/snapback4/src/contract.ts
- `Read.loading` — snapback4/packages/snapback4/src/contract.ts
- `Write.failed` — snapback4/packages/snapback4/src/contract.ts
- `Write.pending` — snapback4/packages/snapback4/src/contract.ts
- `Write.sent (replayed=false)` — snapback4/packages/snapback4/src/contract.ts
- `Write.sent (replayed=true)` — snapback4/packages/snapback4/src/contract.ts

### check (14)

- `sync` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `sync to` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `sync public` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `sync last N by` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `authored horizons` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `retain delivered-history` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `cap N by` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `server` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `device` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `N_HORIZON_GUARD` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `N_MAINTAIN_SYNCED` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `N_NOT_PREDICTABLE` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `N_NOW_SERVER` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule
- `N_NO_HORIZON` — llp/4000-snapback5.rfc.md §3.2; Lane A authored-equivalent rule

### Input SHA-256

- `snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q`: `f1a79fd70f7201777deb674c0709a14e2cdd6d7a13bea663aff5dfbf0ef4a842`
- `generated api.ts`: `448d303434425278b8bd70ca6b930dc6a30354c43be392b1e53af6fa643ddc9d`
- `snapback4/packages/snapback4/src/contract.ts`: `94533f256b561055bc96bf8c86ddb2a4e886a2783ceddb3a3b29012d7b0b76ce`
- `snapback4/packages/snapback4/src/app.ts`: `b11440c768b410e79dcdaa925bd23e4718112db402b91e499cb4e7396f1efcdc`
- `llp/4000-snapback5.rfc.md §3.1`: `2537d96073e6a5d4c3a2d6fa39835444c69678085b94a4701200fb955a0b7f21`
- `llp/4000-snapback5.rfc.md §7`: `d33e24ed23d2b5838fee753e99926eff77c1331d0ade3b5b1392b006099d1bfa`
- `snapback4/crates/snapback4-lang/src/guide/actions.rs`: `77822aeb87324729069001d0733013434006ea3b6b8571940ffaf582c4cfcdc2`
- `snapback4/crates/snapback4-lang/src/guide/app.rs`: `84612308c650039b9d2c34deb3d4406b1aaa0a2220c5000e766a5f7a76679d88`
- `snapback4/crates/snapback4-lang/src/guide/bounds.rs`: `5e584173c64018d6a08ca694f48ce122c1c309326b747f6fb71fa3d4b4c45c28`
- `snapback4/crates/snapback4-lang/src/guide/effects.rs`: `655c3bf2d351daa21547cc101a1dbf745cbc11ef4fd8d30028e576c38aefd2a7`
- `snapback4/crates/snapback4-lang/src/guide/feeds.md`: `c89fe6a6fd8b59c89577bcf7215f478b49997ae68daf19254d72a8e55366c755`
- `snapback4/crates/snapback4-lang/src/guide/indexes.rs`: `2a1617e6b4f1d3814b5c828968e2bdf58fa05247a485f571fc8eb2c63506296c`
- `snapback4/crates/snapback4-lang/src/guide/jobs.rs`: `6d137deeeb9ce038372aa1e040376e7e82063a986ce05cd0ded8f96981c1315d`
- `snapback4/crates/snapback4-lang/src/guide/language.rs`: `9044a377866d0dd84d1afdfd1e71df0f1eb2fb830d4b8543a1b7b4f7371e39af`
- `snapback4/crates/snapback4-lang/src/guide/maintains.md`: `636ababeb93d4f9d747ee2289ed217b0b24fce6438dc0e5d0766aac3969049a6`
- `snapback4/crates/snapback4-lang/src/guide/native.rs`: `6f2d1f9d6f91900e54c1d4ed146635be6b8372f033801709975ef820ef69b3d1`
- `snapback4/crates/snapback4-lang/src/guide/personas.rs`: `714eb1eec6427135530026b8eb7683a6abd633d904ae3f24a84738736185af12`
- `snapback4/crates/snapback4-lang/src/guide/prediction.rs`: `84fe513c7294ec18463d2d4f2e61ae318c615d170dcd7e24632f7e38fbce50b3`
- `snapback4/crates/snapback4-lang/src/guide/presence.rs`: `9cd4c68de25d34abea0c03378abe1255f9578cc7ff8c7a9150dbdb94b0ffd4e5`
- `snapback4/crates/snapback4-lang/src/guide/programs.rs`: `62539e5091d4e60e082958257320c5757291ea6d09d98a60821795c7038225af`
- `snapback4/crates/snapback4-lang/src/guide/reads.rs`: `48b2ce9fd834b9e53572cc00b0c3e0bdc26099c33adf0432846dafc9fa710577`
- `snapback4/crates/snapback4-lang/src/guide/refusals.rs`: `8dd4da2ded3e107fa690cd4f9e4c1beea04fa2098ff558a9e5074f9f29628fb0`
- `snapback4/crates/snapback4-lang/src/guide/routes.rs`: `f162bc3e4fd103a19c6f226c2edc24c11d0f21b0edc92f3b09aae1809f4374af`
- `snapback4/crates/snapback4-lang/src/guide/rules.md`: `2cf2e2b5a7289938849a8f6735861c7a1307ce78f22eb9a385cdeb2c40e17090`
- `snapback4/crates/snapback4-lang/src/guide/search.rs`: `0b29dcf49ecc395c63628e982bf751d36d2ac48558c57ade6bdec4a112477496`
- `snapback4/crates/snapback4-lang/src/guide/search_all.md`: `6fb6b87957ce72fbfcacbb4b4cd9edd9e5d0fb2a7a398687ff1f11d89abbaac4`
- `snapback4/crates/snapback4-lang/src/guide/services.rs`: `a2c0fdbc22f96cd53b5562bbca178abdbd4f3f5ee660b6827038bb808520c12b`
- `snapback4/crates/snapback4-lang/src/guide/shapes.rs`: `40bafda90e578d4e626c54f21cd3e9790ba323d787bc682c3d78b65fb04f9497`
- `snapback4/crates/snapback4-lang/src/guide/sync.rs`: `35b68d22c795e73eee68dcbd105baa0f70de36bbcb027e77179f01be21a8820c`
- `snapback4/crates/snapback4-lang/src/guide/types.rs`: `51347d4358536ce130bb1a242536bf88f36d43f52a836e0f487e0790dd550123`
- `snapback4/crates/snapback4-lang/src/guide/witness.md`: `fa796fda6c6bb1d34f70f9ef120107dee94864f59d0ce987e0934986c9a7ecc2`
- `snapback4/crates/snapback4-lang/src/guide/writes.rs`: `5af62e0596ae1571aab8892d495f708cfdaa922b42d318f05b7117cf8503f88d`
- `snapback4/crates/snapback4-lang/src/guide.rs`: `24e78c3ffb7f8e64fd96603b2d46884cd374bc108ff4d69cc1d17a4f253cb7db`

## snapback5

Surface: **48**; runtime: **13**; check: **7**; total: **68**.

### surface (48)

- `(old, next)` — llp/4000-snapback5.rfc.md §3.1 Rules:
- `after c` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `at most N by` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `connected` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `count … by` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `count … by <table> <row> where …` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `created` — llp/4000-snapback5.rfc.md §3.1 Rules:
- `default` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `delete` — llp/4000-snapback5.rfc.md §3.1 Rules: (+1 other source locations)
- `effect` — llp/4000-snapback5.rfc.md §3.1 Program:
- `emit … once` — llp/4000-snapback5.rfc.md §3.1 Work:
- `enum` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `exists` — llp/4000-snapback5.rfc.md §3.1 Rules:
- `expire at` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `first` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `fn` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `format` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `group` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `if absent` — llp/4000-snapback5.rfc.md §3.1 Writes:
- `immutable` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `insert` — llp/4000-snapback5.rfc.md §3.1 Rules: (+1 other source locations)
- `job` — llp/4000-snapback5.rfc.md §3.1 Work:
- `keep history` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `last N by` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `matching` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `max … by` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `merge` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `mutation` — llp/4000-snapback5.rfc.md §3.1 Writes:
- `once` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `online only` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `public` — llp/4000-snapback5.rfc.md §3.1 Rules:
- `query` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `read` — llp/4000-snapback5.rfc.md §3.1 Rules:
- `readable by audience` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `require … else` — llp/4000-snapback5.rfc.md §3.1 Writes:
- `schedule` — llp/4000-snapback5.rfc.md §3.1 Work:
- `search` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `sequence by` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `shape` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `through .ref` — llp/4000-snapback5.rfc.md §3.1 Rules:
- `unique … else CODE 'message'` — llp/4000-snapback5.rfc.md §3.1 Tables:
- `update` — llp/4000-snapback5.rfc.md §3.1 Rules: (+1 other source locations)
- `upsert` — llp/4000-snapback5.rfc.md §3.1 Writes:
- `use identity …` — llp/4000-snapback5.rfc.md §3.1 Program:
- `view` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `viewer` — llp/4000-snapback5.rfc.md §3.1 Rules:
- `where` — llp/4000-snapback5.rfc.md §3.1 Reads:
- `written by` — llp/4000-snapback5.rfc.md §3.1 Tables:

### runtime (13)

- `AuthState.restoring` — snapback4/packages/snapback4/src/app.ts
- `AuthState.signed-in` — snapback4/packages/snapback4/src/app.ts
- `AuthState.signed-out` — snapback4/packages/snapback4/src/app.ts
- `CANNOT_FOLLOW_SELF` — generated api.ts
- `E_GENERATION` — llp/4000-snapback5.rfc.md §7 (explicit runtime state)
- `NOT_FOUND` — generated api.ts
- `Read.data` — snapback4/packages/snapback4/src/contract.ts
- `Read.denied` — snapback4/packages/snapback4/src/contract.ts
- `Read.loading` — snapback4/packages/snapback4/src/contract.ts
- `Write.failed` — snapback4/packages/snapback4/src/contract.ts
- `Write.pending` — snapback4/packages/snapback4/src/contract.ts
- `Write.sent (replayed=false)` — snapback4/packages/snapback4/src/contract.ts
- `Write.sent (replayed=true)` — snapback4/packages/snapback4/src/contract.ts

### check (7)

- `warm set` — llp/4000-snapback5.rfc.md §7
- `depth step` — llp/4000-snapback5.rfc.md §7
- `depth-step trigger` — llp/4000-snapback5.rfc.md §7
- `eviction` — llp/4000-snapback5.rfc.md §7
- `retention` — llp/4000-snapback5.rfc.md §7
- `per-table device admission` — llp/4000-snapback5.rfc.md §7
- `outbox` — llp/4000-snapback5.rfc.md §7

### Input SHA-256

- `snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q`: `f1a79fd70f7201777deb674c0709a14e2cdd6d7a13bea663aff5dfbf0ef4a842`
- `generated api.ts`: `448d303434425278b8bd70ca6b930dc6a30354c43be392b1e53af6fa643ddc9d`
- `snapback4/packages/snapback4/src/contract.ts`: `94533f256b561055bc96bf8c86ddb2a4e886a2783ceddb3a3b29012d7b0b76ce`
- `snapback4/packages/snapback4/src/app.ts`: `b11440c768b410e79dcdaa925bd23e4718112db402b91e499cb4e7396f1efcdc`
- `llp/4000-snapback5.rfc.md §3.1`: `2537d96073e6a5d4c3a2d6fa39835444c69678085b94a4701200fb955a0b7f21`
- `llp/4000-snapback5.rfc.md §7`: `d33e24ed23d2b5838fee753e99926eff77c1331d0ade3b5b1392b006099d1bfa`

## Verification and infrastructure record

- Four focused extractor tests pass. They exercise wrapped/duplicate RFC
  entries and a sixth Work bullet, imported union states and replay,
  changing refusal codes, source-name/bound invariance, exclusion of JS,
  comments and strings, inline default forms, and refusal on registry drift.
- Repeated invocations of each arm are byte-identical (`cmp`), including
  the generated API and input hashes. Both arms' API hashes match.
- The committed Clique target reports `check: ok — 21 tables (21 synced),
  13 operations, no problems, 5 notes` (timing excluded as non-deterministic).
- `snapback4/scripts/build-wasm.sh` reports
  `wasm 1744842 B raw, 484967 B gzip (budget 486000: ok)`.
  Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt. Budget unchanged;
  headroom 1,033 B. A preliminary package typecheck/build attempted before
  wasm generation completed reported missing wasm imports; the prescribed
  suite builds wasm before typechecking and building the package.
- Initial full-suite attempt: broad `strace -f -e trace=process` was too
  intrusive for timing-sensitive tests. Interrupted recorded launcher
  634650; stopped its two recorded surviving servers 644273 and 758168.
  This attempt has no completed passing result.
- Second attempt: seccomp-filtered launch tracing, serial client test
  files. The shared filesystem filled: SQLite and Rust emitted explicit
  disk-full errors, Node filesystem tests failed, and trace/output logs
  hit ENOSPC. Preserved available worker logs under
  `.work/disk-full-attempt/`; interrupted recorded launcher 768686 and
  stopped its recorded surviving server 898095. Reclaimed 16 GB by removing
  only this lane's regenerable debug incremental cache. No source or other
  lane was changed. This interrupted attempt is not qualification.
- Third attempt: ordinary suite concurrency, Node 24.18.0 first on PATH,
  worktree-local TMPDIR, `strace --seccomp-bpf -f -e trace=execve` to retain
  launch PIDs. This tracer still consumed about 86% of one CPU. There
  were two client failures: the worker-crash replay test observed attempts
  `[1, 2, 3]` rather than `[1, 2]` (`server-e2e.test.mjs:549`), and the web
  receipt-history case exceeded 60 seconds. Completed Rust targets had
  no failures. Preserved available logs under `.work/traced-attempt/`,
  interrupted recorded launcher 905048, and waited for all tracees to exit.
  This attempt did not complete qualification.
- Fourth attempt: no ptrace. A worktree-local preload constructor records
  PID, parent PID, process start ticks and executable once at launch to
  `.work/final-pids.tsv`; it intercepts no functions and changes no engine
  source. Its source and binary remain ignored under `.work/`.
  `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` and
  `SNAPBACK4_RUST_TEST_PROCESSES=12` are the suite's supported concurrency
  controls. Node 24.18.0 is first on PATH; TMPDIR stays inside this
  worktree. Rust and doctests passed in 114 s. The client run exposed
  the suite's requirement that temporary scratch be outside Git: the
  managed-policy test fails with a worktree-local TMPDIR and passes with
  the ordinary system temporary directory. Three other cases failed in
  this attempt (session restoration, Expo starter, default processDevice);
  session restoration passed when isolated. Preserved worker logs under
  `.work/worktree-tmp-attempt/`, stopped recorded launcher 1144114 and
  verified from PID/start-time records that no recorded process remained.
  This attempt was interrupted rather than counted as qualification.
- Final attempt restores the suite's standard system temporary directory,
  keeps Node 24.18.0, uses ordinary client-file concurrency and 12 Rust
  processes, and retains the launch-only recorder. Temporary fixtures are
  owned and cleaned up by the suite; no other worktree is used. Logs are
  `.work/verified-suite.log` and `.work/verified-pids.tsv`. Result below.

## Changed files

| File | Change |
| --- | --- |
| `AGENTS.md` | Snapback 5 routing immediately after Snapback 4; `CLAUDE.md` remains the existing symlink. |
| `llp/4000-snapback5.rfc.md` | §7.1 with the counts, commands, larger readings, imported-state deviation and comparability limit. |
| `snapback5/.gitignore` | Ignores `.work/` so generated API, dependencies, test logs and local instrumentation are never committed. |
| `snapback5/README.md` | Three-paragraph hypothesis, shared-crate relationship and unimplemented-runtime status. |
| `snapback5/AGENTS.md` | Fence, reading order, 4000+ numbering, ownership and gate boundaries. |
| `snapback5/NOT-DOING.md` | §3.2 removals, retained policy and RFC non-claims. |
| `snapback5/JOURNAL.md` | One dated entry recording the scaffold, count, ambiguities, wasm and qualification history. |
| `snapback5/tools/README.md` | Tool guide, fresh-tree preparation, exact rule, extraction boundaries and interpretation limits. |
| `snapback5/tools/concept-count.mjs` | Deterministic two-arm CLI; fresh local check, RFC/state/refusal extraction, entry lists and input hashes. |
| `snapback5/tools/extract-guide.mjs` | Source-backed recognizers for documented language and keyword-card forms. |
| `snapback5/tools/concept-count.test.mjs` | Four tests for source extraction and failure cases that could silently miscount. |
| `snapback5/reports/20260924-concept-count.md` | This measurement, both complete entry lists, evidence, limitations and file map. |

No tracked Snapback 4 file changed. No push, publication or deployment.
No new Quarry form or engine/device behavior was commissioned in this lane;
shared additions and derived residency remain the other implementation work.

## Final qualification

Exact blocking-suite result: **`== 0 failure(s) in 135 s`**, exit 0.
Client totals: **1088 passed, 0 failed, 10 skipped**.
No test was removed or skipped by this lane; these are the suite's existing
skip conditions. The final suite includes Rust language, engine and device
coverage, doctests, package/app typechecks, package build, release guard,
docs budget, fixture wrappers and client tests. The earlier failures did
not require a product-source change.

Exact wasm line: **`wasm 1744842 B raw, 484967 B gzip (budget 486000: ok)`**.
The 486,000-byte budget is unchanged. Four extractor tests passed, and both
counter invocations reproduced byte-identically. PID/start-time verification
found no live process from the qualifying run. Complete launch records and
suite output remain in ignored `.work/verified-pids.tsv` and
`.work/verified-suite.log`.

Root reference validation: `ref-check: ok — 507 LLP docs, 9237 refs in 25725 files, 0 errors, 0 unchecked`.
All local scaffold documentation links resolve; `git diff --check` is clean.
No lane deliverable remains undone. The documented comparability limit is
a measurement interpretation issue, not a claim of a complete Snapback 5
language inventory or an implementation of its proposed forms.
