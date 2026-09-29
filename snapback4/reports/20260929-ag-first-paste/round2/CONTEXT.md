# Round 2 context and documentation audit

Scope: first-paste advice, count-view intent planning, the compiled guide,
README output guidance and execution regressions. No runtime or client code.

Governing LLPs (all three Snapback 4 documents are in current, not foundation):
- LLP 3000 §1 and §7: fence, one interpreter, compiled guide and unchanged budgets.
- LLP 3000.007 §23: first-paste meaning, manual advice, stable values, alias precedence,
  terse behavior summaries and detailed verbose output.
- LLP 3000.013 §2.1–2.2: predicate index planning and declared unique positional keys.
- LLP 2000.000 §6: static authorization and runtime metering; unchanged by this patch.

Read the lane prompts, both prior reports/journal entries, Astra round 1 in full
and Grok's complete READY review once it arrived. Applied llp-orient read-only using the available copy
at ../lane-pf/vendor/llp/skills/llp-orient/SKILL.md; this lane's symlink is missing
its initialized submodule. Followed @refs on the advice and intent planner.
Grok also noted unobserved continuation; the held witness now consumes a cursor,
and deleting after c fails both stores. No unresolved design decision or new LLP is needed. Updated LLP 3000.007 §23
and its revision metadata; hand-off: none.

Audited check-output wording throughout guide.rs, all guide cards (including why
fragments), the Snapback 4 README and all non-vendored application/package README
files. Build/cache/report directories are excluded from current documentation.

Corrections:
- bounds: default note summaries; verbose rewrites/why/explanations; scale summary
  requires --verbose or --cost.
- maintains: key/fanout/recount details require --verbose.
- search_all and why/SEARCH: default search warning summaries; verbose repairs
  and explanations; --cost execution costs.
- search_all and why/E_QUERY_HELD: held-run and horizon-free coverage details
  require --verbose.
- prediction and why/E_NOT_PREDICTABLE: per-upsert 'updates only' label is verbose.
- feeds: per-transition classification is verbose; default never-predicting
  reasons and adoption notes remain visible.
- rules: server-read explanations require --verbose.
- sync: aggregate acquisition facts require --residency.
- guide.rs residency: default horizon summaries do not promise every site;
  --verbose provides them.
- package README: default summaries, verbose repairs/explanations, cost certificate;
  removes the promise of a default scale line. Physical line count stays 300.

Already accurate: default behavior-note and prediction summaries, adoption/refusal
messages (errors still print rewrites), explicit --cost and --residency reports,
check --fix, generated artifacts, code refusal/validation behavior and CLI lists.
The language card, indexes, reads, programs, jobs, native, refusals, discovery,
sequences and remaining README references need no output-presentation change.
Two fact-home strings and the existing held-coverage prose assertion now name
--verbose. No fact is removed. All new wording remains under the existing budget.
