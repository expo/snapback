# RX round 3 — generated receipt calls, mappings and probes

Date: 2026-09-30. Branch: `sb4-intent/rx-declarative-receipts`.
Round two: `eb465eec419cc43db6ed67b3132596733ea7cc65`.
Merged `origin/main` at `42ba3ffb904fa227d6dde5ef6a2c8e4c8b23f428` first in
`e7f07f2bc144efdbd1b20071e092ad4a212473ec`. Retained both sides of the
append-only journal and delivery fault-instrument comment conflicts; the other
changes merged automatically. Read all previous prompts/reports and review
pairs, including both complete round-two reviews. Nothing pushed or published.

## Changes and evidence

1. **Generated calls bypass application declarations.** The compiler rewrites
   template primitives to unspellable `$builtin:` references before planning;
   binding bypasses the function catalog for them. The fold uses the reserved
   `$receipt:<family>:fold` name. The viewer input is also compiler-owned so an
   authored table named `viewer` cannot capture it. The complete call audit is
   `first`, `max`, `count`, `range`, and the fold: the receipt projection and
   generated delivery/maintenance paths are in the same `receipts.q` template.
   `bind/delivery.rs` admits the handwritten delivery clause; it contains no
   second code-generating template. Both generated paths and manual clause
   compatibility have extra-key/cap tests. Authored ordinary calls retain their
   existing resolution.

   The exact starter reproduction sends 1–4, appends authored `max(a,b) = a+b`,
   and reports only `[2,2]` twice. The stored run remains `[2,2]`; 1, 3 and 4
   remain `sent`. A generated corpus declares a function and a table for every
   template primitive, the old helper spelling, each temporary template call
   spelling and `viewer`, then executes all six public surfaces. Existing
   authority, saturation, rollback, long-gap, adoption and replay checks remain.

2. **Mapping refusals belong to the author.** All generated declaration,
   argument, statement, expression, key, seek, range, rule and delivery-clause
   sites point to the receipts clause. Later binder/admission errors are
   `E_RECEIPTS_CLAUSE`, with author mappings and a reason, without advice to edit
   generated locals. Reserved table/projection spellings and hyphenated public
   operation names have explicit mapping refusals. Projections called `count`
   or `max` now compile and execute; `runs viewer` refuses at the clause.
   Collision diagnostics name the conflicting authored declaration/field.

   The expanded generator covers 21 positions × 65 spellings: ten fields,
   three table names, family, runs and all six public names. **1,190 cases
   compile and execute all six surfaces; 123 refuse at the receipts clause;
   52 are invalid in the author's own table/rule syntax and refuse there before
   expansion.** The original 510 executing field cases remain. The generator
   checks every mapping refusal's code, original file/line, author name and
   absence of generated-local advice. Separate zero/ten-line padding cases
   check delivery admission failures, and a compiler test visits every emitted
   expression and nested read coordinate to check its source location.

3. **All generated multi-column probes name columns.** Message gap probes use
   the mapped scope and position; member reads and generated runs rules use
   the mapped member scope and principal. Extra unique pairs and additional
   caps on messages, members, or both no longer create positional ambiguity.
   Each variant executes the projection, delivery, seen, member/progress reads,
   and compact. A handwritten delivery-clause fixture with extra unique keys
   and caps also compiles. No index admission rule was relaxed.

4. **The coverage-guard test now has a discriminating witness.** The original
   fresh-snapshot test remains, accurately scoped to acquisition queuing. New
   memory and SQLite cases first acquire membership and run images, then start
   an incomplete runs acquisition while proving the member read is complete.
   This narrow core-defense fixture gives runs delivered-history retention;
   ordinary generated runs remain until-revoked. Leave queues, and member/run
   images remain intact. It isolates `receipt_member_removed`'s range-coverage
   guard from the whole-snapshot guard, without changing product behavior.

The template digest changes, fencing earlier delivery debt by the existing v2
fingerprint. Manual/no-clause fingerprints and stored receipt rows retain their
contracts. No runtime ceiling, test count, timeout or wasm ratchet was reduced.
The starter stays 231 lines versus its original handwritten 294.

## Negative controls

`round2-controls.log.gz` runs the final nine round-three regression tests with
round-two compiler product files restored temporarily: **2 passed / 7 failed**.
Failures are the duplicate-report reproduction (actual through=4, expected 2),
authored-call corpus, all-position naming corpus, each of the three extra-key
variants, and generated delivery diagnostics. The two new guard witnesses pass
on round two because the guard was already correct. Commands, exact source
hashes and byte-for-byte restoration are in `round2-controls.json`.

`guard-control.log.gz` disables only the existing receipt-specific coverage
check: **0 passed / 2 failed**, one on each store at “missing run coverage must
queue leave”. `guard-control.json` records matching before/restored core hashes.
These are intentional negative controls, not unresolved product failures.
The retained control scripts reproduce these experiments within an idle lane.

## Verification

Final affected results (`affected-final.log.gz`, `guide-final.log.gz`,
`device-final.log.gz`): compiler unit tests **25/25**, receipts **46/46**,
delivery **16/16**, delivery clause **6/6**, delivery integration **3/3**,
replay conversion **2 passed / 1 existing ignore**, whole guide **106/106**,
device delivery **30/30**, readauth **81/81**. The combined affected log retains
the defining-fact guide failure; the separate final whole-guide rerun is green.
Documentation budget and `git diff --check` pass. `ref-check --verbose` reports
525 LLP documents, 10,006 refs, zero errors and zero unchecked refs.

Ran `bash scripts/test.sh` from `snapback4/` **exactly once**, exit 0. Exact
summary:

```text
== 0 failure(s) in 1290 s
```

All 13 stages passed: Rust **4,415 passed / 0 failed / 33 existing ignored**
(including doctests; the docs-budget stage separately repeats one guide case),
clients **5,342 passed / 0 failed / 10 existing skipped**, fixtures **9/9** and
serial models **79/79**, including both full 5,000-sequence walks. No
cancellations. Full-run failures: **ours 0, baseline 0, environmental 0**.
The inherited nominal 60-second suite bar is exceeded; no counts, timeouts or
ceilings were reduced. Product and test source stayed unchanged throughout the
run, verified by `suite-source.json`. `suite.log.gz` retains the complete output;
`suite-summary.json` records the exact stage timings and counts. Logs also retain
all failed development attempts, classified below.

## Wasm

The full suite's canonical build, Rust 1.97.0 / wasm-bindgen 0.2.127 / locked
Binaryen 132, measures **1,988,204 B raw / 596,444 B gzip**, identical to round
two and **803 B below the unchanged 597,247 B ratchet**. No budget increase.
`source-artifact-sha256.json` records final source and artifact hashes.
The primary receipt guide is **322/350 lines**.

## Development failure ledger

All failures below are **ours**, corrected before the full-suite run:

- An initial file-writing command used repository-root paths while its working
  directory was `snapback4/`, so the new module was not created. Reissued with
  absolute patch paths. The resulting failed build is retained.
- The first source-site visitor omitted two `ShapeField` variants; Rust refused
  the pattern. Added the spread variants.
- The extra-member-index fixture initially left its authored rule probes
  positional. Converted those fixture rules to named columns, so the test
  isolates the generated probes instead of asking the author parser to choose
  between two keys.
- The first broad name run found missing `commit`/`new` scope handling,
  non-specific syntax refusals and reserved table names. Fixed generation and
  mapping diagnostics. Cases invalid in authored syntax are recorded separately
  from valid mappings entering generation; they are not counted as successes.
- New test harness compilation caught a private compiler source-map field,
  usize/u32 comparisons and a mutable-borrow conflict. Moved exhaustive AST site
  verification inside the compiler test and fixed the types/borrow.
- A first integration assertion confused IR read identifiers
  (`programs.inboxProgress.2`) with author source coordinates. The final tests
  check the AST source map directly and actual clause-local admission errors.

- The whole-guide defining-fact check caught changed wording around
  `E_RECEIPTS_CLAUSE`. Restored its defining sentence and kept the new mapping
  explanation beside it; the unchanged defining-fact assertion passes.

Every red development invocation is listed here; each log has the `.log.gz`
suffix. All are ours and resolved:

| Log | Exact failing outcome |
| --- | --- |
| `build-first` | Build refused: one `E0583`, missing `generated` module. |
| `affected-first` | Build refused: one `E0005`, incomplete shape-field match. |
| `regressions-first` | 2 passed / 2 failed: extra message/member keys and all-position mapping corpus. |
| `regressions-third` | Test build refused: six errors (`E0308` twice, `E0277` twice, `E0616`, `E0502`). |
| `regressions-fourth` | 5 passed / 1 failed: generated-expression/delivery diagnostic source assertion. |
| `affected-final` | Guide 105 passed / 1 failed: `definitions::w11_every_registered_code_quotes_its_definition`; other affected targets passed. |

The separate `guide-final` invocation passes 106/106 after the wording repair;
the full suite also passes on that final source. Baseline failures: **0**.
Environmental failures: **0**. The deliberately failing negative controls are
classified separately above.

## Governing context and next round

Scoped `llp-orient` used the existing skill at
`/home/ccheever/lanes/q03r4/vendor/llp/skills/llp-orient/SKILL.md`; this checkout's
link is uninitialized. Governing constraints: LLP 3000 §4 (the independent fence),
LLP 3000.022 §§2–6 (coverage, binding identity and replay) and §14 (receipt
mapping/authority/bounds), LLP 3000.015 §2 (authority/meter constraints), and
LLP 3000.025 §2 (expiry is still metered work). LLPs 3000.015, 3000.022 and
3000.025 remain linked in `llp/current/`; §14 remains a bounded prototype.
Current authoring facts came from
the receipts and sequences cards. §14 and the primary guide are updated in place.
No new LLP or gate was added. The affected corpus audit checks those decisions
against final code and the prior reports, leaving the historical reports intact.

This is the last round of the actionable findings in the supplied reviews:
Astra's P1/P2 and coverage-witness P3 and Grok's P2 are addressed. No additional
product finding is known from this qualification. The previously recorded
conservative conjunction proof and positional operation-list syntax remain
intentional limitations. **Next round, not this one: automatic ordinal
allocation, recipient counts and join floors.** Raw-IR admission, arbitrary
migration tooling and large-backlog latency qualification remain scoped as in §14.

The local commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing pushed or published.
