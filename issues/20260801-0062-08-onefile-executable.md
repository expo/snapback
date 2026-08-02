# 0062-08: the app-bound one-file Ibex executable

**Status:** OPEN — phase 2, BLOCKED on 0062-07's reviewed ibex
contracts. **Authority:** LLP 0062 §6.2 whole (the 2026-08-01 author
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

## Blocker check (2026-08-01)

Still blocked. Ibex standalone-executable compilation work is active, but the
ibex corpus does not yet admit an external TS/JS file as a separately
attributed restricted worker principal: LLP 0029 still excludes file-execution
ingress and the reviewed extension requested by 0062-07 has not landed. Do not
start packaging this executable until 0062-07 records all three ibex document
changes and their landing commits.
