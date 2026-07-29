## 2026-07-29 — final installed-package confirmation (draft)

The frozen Partiful result stayed **12 PASS, 3 GAP, 0 FAIL** in a second clean
external project using the immutable `0.1.1-llp0102.1` Darwin closure.
Schema/functions already used package imports, installed codegen succeeded,
the packaged runtime reproduced sessions, capacity contention, native push,
cron, effect retry/ambiguity, revocation blanking, and exact cleanup.

Package authoring felt better here than in Linear because no import rewrite was
needed for schema/functions. Lifecycle remained lower-level than ideal: the
acceptance harness needed custom orchestration around installed
`snapback start/stop`. The copied build sampler also assumed its evidence
directory existed; after retaining that failed attempt, the complete 2+7
window reran.

Assets, a complete hosted profile, and the asset-dependent full performance
scenario remain GAPs. The application-owned notification/effect and role glue
also remains real friction; package success does not erase it or change the
original score.
