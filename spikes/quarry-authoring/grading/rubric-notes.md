# Rubric grading notes

Grader: Claude Fable 5 (orchestrator), against
`packet/references/rubric-and-references.md`. Machine verdicts from
`machine-results.json` (real lowering+checker). Cross-grade sample: see
`cross-grade/`. Cells: per task, `PRIOR / SEM / SYN / INC` items committed
(a = all avoided).

## codex gpt-5.6-sol (xhigh)

| Task | A (TS bare) | B (TS+policy) | C (Quarry) |
|---|---|---|---|
| T01 | a; SYN: block-bodied map cb (E_OPAQUE) | a | a |
| T02 | a (take 100) | a | a |
| T03 | a — declared maintained unprompted | a | a; over-broad `readable: public` noted |
| T04 | a (maintained max) | a | a (`readable: public`, correct here) |
| T05 | a (commitTime guard) | a (commitTime guard; stores intent `now` — ideal) | a |
| T06 | a; SYN: recurse call-shape refused (E_OPAQUE) | same SYN | a — `walk` letter-perfect |
| T07 | a; unprompted `hasMore` cap guard | a | a |
| T08 | a | a | a |
| T09 | a (take 99 + hasMore→"99+") | a (countCapped) | a (`first 99 \| count`) |
| T10 | a (maintained count capacity) | a | a; `#passengerCount[ride]` keyed by row binding (auto-deref reading) |

**codex PRIOR committed: A=0 B=0 C=0. SEM: 0. SYN: A=2, B=1, C=0.**

## Claude Haiku 4.5

| Task | A (TS bare) | B (TS+policy) | C (Quarry) |
|---|---|---|---|
| T01 | a; SYN: block-bodied map cb | a | a; SYN: bare-name shorthand + shape-on-ref (invented, mild) |
| T02 | **PRIOR: no take → E_UNBOUND_SCAN** | a | a |
| T03 | **PRIOR: unbounded loop tally → E_STRUCTURAL_COUNT** | a | a |
| T04 | a (reached for maintained even bare) | a | a |
| T05 | a (commitTime guard) | a | a |
| T06 | a; SYN: `{depth}` missing fanout (E_OPAQUE) | same SYN | a; SYN: `walk e up` on binding (auto-deref) |
| T07 | **PRIOR: unbounded member scan → E_UNBOUND_SCAN** | a | a |
| T08 | a | a | a; SYN: `journalId.owner` field-through-ref (auto-deref) |
| T09 | a; SYN: `String()` (E_OPAQUE) | a; SYN: `String()` + destructuring | a — capped count + display reasoning exemplary |
| T10 | a on R1/R2; INC: no ride null-check | a | a |

**haiku PRIOR committed: A=3 B=0 C=0. SEM: 0. SYN: A=4, B=3, C=3 (all three C
fumbles are the same invented construct: auto-dereference through a ref
binding — uniform, loud, and arguably the right design).**

## grok-4.6 (xhigh)

| Task | A (TS bare) | B (TS+policy) | C (Quarry) |
|---|---|---|---|
| T01 | a (`db.require` in a query — accepted) | a | a; SYN: bare-name shorthand; `bookings[.]` row-as-key (auto-deref) |
| T02 | a — added optional cursor arg, take 50 | a | a |
| T03 | a (maintained unprompted) | a | a |
| T04 | a | a | a (`readable: public`) |
| T05 | a (commitTime) | a (commitTime; stores intent now) | a — positional unique key `promos[code]` per spec |
| T06 | a; SYN: recurse call-shape (E_OPAQUE) | same SYN | a — `walk` letter-perfect |
| T07 | a; unprompted `hasMore` cap guard (same move as codex-A) | a | a |
| T08 | a | a | a; stray schema-echo fragment (copy artifact) |
| T09 | a; SYN: destructuring (E_OPAQUE) | same SYN | a (returns show row for title — INC minor) |
| T10 | a (maintained count capacity) | a | a — reference-shaped |

**grok PRIOR committed: A=0 B=0 C=0. SEM: 0. SYN: A=2, B=2, C=1 (mild).**

## Final tallies (90 submissions)

| | PRIOR committed | SEM committed | SYN fumbles | machine-refused |
|---|---|---|---|---|
| A (TS bare) | **3** (all haiku: unbound scan ×2, structural tally) | 0 | 8 | 8/30 |
| B (TS+policy) | 0 | 0 | 6 | 5/30 |
| C (Quarry) | 0 | 0 | ~4 (all mild, convergent shorthands) | n/a (no checker) |

Machine refusals in TS arms: 3 prior-collision (haiku-A), 12 E_OPAQUE
subset-strictness (all models, arms A **and** B), 15 total of 60.

Program-size economics (schema stripped): arm A mean 502 B / arm B mean 521 B
/ arm C mean **198 B**; per-(task,model) B/C ratio mean **2.92×**, median
2.83×, range 1.05–5.57× (n=30).

## Cross-grade result

codex gpt-5.6-sol independently graded a 12-submission sample (39 rubric
items) against the same rubric and spec: **37/39 agreement (94.9%)**
(`cross-grade/codex-verdicts.md`). Both disagreements are one judgment axis:
codex grades an invented Quarry spelling as strict-invalid → item committed
(haiku-C-T01 R3 shape-on-ref; haiku-C-T08 R1 guard via `journalId.owner`),
where this grader scored semantics-avoided + SYN. Ruling recorded: the
primary tallies keep the semantics-based grade — an unparseable guard never
admits an unguarded write, so it is not a PRIOR defect — but under the
strictest reading haiku-C gains 2 failures, both *loud* (parse-refused),
which reinforces rather than weakens the loud-vs-plausible asymmetry.
Codex also flagged that the packet's own T03/T08 Quarry read rules access
fields through `Row?` (`postings[a.posting].employer`) — a third spec gap,
and further evidence for adopting auto-deref.

## Cross-cutting observations

1. **The false-affordance effect is real and concentrated in the small
   model.** Haiku-A committed 3 prior-collision defects (unbounded scan,
   structural loop tally, unbounded fanout); the same model committed zero in
   B and zero in C. Codex committed zero everywhere.
2. **T10's admissible-but-wrong trap fired nowhere** (codex/haiku): the
   "hundreds may join at once" cue plus `maintained` in both surfaces routed
   everyone to the complete count.
3. **The intent-clock trap fired nowhere**: documenting both clocks with
   one-line roles in the API brief was sufficient, even bare-arm. (`Date`
   does not exist in either surface, so ambient time cannot be reached for
   accidentally — only invented; nobody invented it.)
4. **The TS subset's jagged edge is the dominant TS failure mode**, not
   policy: semantically-correct submissions refused for block-bodied `map`
   callbacks, `recurse` call shapes, `String()`, destructuring (E_OPAQUE).
   All four T06 TS submissions are semantically right and all four are
   refused on `recurse` spelling trivia. The subset boundary is invisible;
   models cannot tell which TypeScript they are allowed to write.
5. **Quarry syntax held up**: of all 30 C-arm submissions, no hallucinated
   operators, no unbounded constructs (unspellable), and two *consistent*
   invented ergonomics — auto-deref through refs / row-as-key, and bare-name
   shape fields — produced independently by all three families across seven
   sites. That is a language-design signal, not noise: adopt both.
6. Only the Quarry arm has a **spelling for disclosure** (`readable:`); TS
   arms had nowhere to say it (S1 surface), and codex once over-disclosed
   (`readable: public` on an employer-scoped count) — disclosure review is a
   real needed diagnostic.
