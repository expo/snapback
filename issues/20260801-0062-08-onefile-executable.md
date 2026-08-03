# 0062-08: the app-bound one-file Ibex executable

**Status:** OPEN — phase 2, UNBLOCKED on 2026-08-03 by the reviewed Ibex
contract landing recorded in closed ticket 0062-07. **Authority:** LLP 0062 §6.2 whole (the 2026-08-01 author
direction: embeds Ibex/Hermes + the generic trusted engine + the fixed
app binding; fetches the dynamic envelope; ordinary deploys never
rebuild it; one executable per app × platform; the one-file claim is
literal — no Node, npm tree, framework, sidecar).

Packaging + release provenance + the embedded-parent code-mode
boundary per §6.2; offline cached-envelope surfaces; unsupported
platforms refuse rather than approximate.

Done when: `./example introspect|call|run` works from a single
downloaded file against a live target, with §7's host-portable suite
green and rebuild-only-on-binding-change proven.

## Blocker resolution (2026-08-03)

Ibex LLPs 0028 and 0029 plus new LLP 0048 landed with dual-family review in
Ibex commit `36442ab9fa399b315ca562da1bdb72190a4aa4f6`. The closed 0062-07
ticket records the document identifiers, review result, and exact handoff.
This issue may now begin implementation; none of its one-file product,
two-tuple evidence, or host-portable acceptance conditions is pre-satisfied by
the documentation landing.

## Historical blocker check (2026-08-01)

Still blocked. Ibex standalone-executable compilation work is active, but the
ibex corpus does not yet admit an external TS/JS file as a separately
attributed restricted worker principal: LLP 0029 still excludes file-execution
ingress and the reviewed extension requested by 0062-07 has not landed. Do not
start packaging this executable until 0062-07 records all three ibex document
changes and their landing commits.
