# SD-6: the @expo/snapback-* scope migration, then slice 5-rebuild

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 4
**Severity:** P0
**Systems:** Packaging, Client integration, Code generation, Runtime,
Documentation, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-31
**Related:** LLP 0130, LLP 0115, LLP 0122, LLP 0041, LLP 0111, LLP 0074,
issues/closed/20260730-move5-runtime-qual-and-types-sweep.md
**Marker:** parity-moves, move-5, sd-6

LLP 0130 SD-6 (Charlie's standing decision, 2026-07-31) sequences the
npm scope migration after slices 5-qual and 5-types land and before
the starter/GA front-door moment. Both gates cleared 2026-07-31
(5-qual: `814acd77`/`63dacde2`/`5ac77b8d`; 5-types: `1f475864`), so
this ticket is ARMED. Decision 9 fixed the terminal scope as
`@expo/snapback-*` — the repository moved to the expo/snapback GitHub
org — with the `@snapback` org release request filed in parallel by
Charlie, gating nothing; if granted it becomes deprecation-stub
aliases pointing at @expo names, never a second migration.

Work items. (1) The scope migration itself, as its own serialized
landing: rename the publishing `@snapback/*` packages to
`@expo/snapback-*`, migrating everything LLP 0115's decision-9 note
calls a proof-system migration — the protocol name table, schema
consts, the cold-install preset, and ledger lineage — plus workspace
references, generated-artifact specifiers, guide/docs snippets, and
the export-types gate's inventory. Existing on-disk generated
fixtures regenerate rather than hand-edit. (2) Slice 5-rebuild after
or with it (LLP 0115 CV-1's exit clause: the external workout-arm
rebuild from published artifacts only), so the external-rebuild proof
binds the terminal name, not a throwaway alias. 5-rebuild's custody
inputs are already decided (decision 4: CLI-fold + published helpers;
decision 1: LLP 0074's parallel channel gate).

Sequencing constraint. The migration is a repo-wide rename: run it as
its own landing with no concurrent code lanes touching `packages/`,
after in-flight wave-1 lanes (C2 jobs, C6 move1) land. The
`check:export-types` gate and the package-test inventory gate are the
regression rails; both must be green on the renamed tree.

Exit. Every publishing package carries its terminal `@expo/snapback-*`
name with the proof green end-to-end; the external rebuild consumes
only published artifacts under the terminal names, satisfying LLP
0115 CV-1's exit; the `@snapback` alias question stays external
(Charlie's dispute) and gates nothing here.
