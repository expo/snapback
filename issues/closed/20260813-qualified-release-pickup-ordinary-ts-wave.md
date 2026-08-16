# Qualified release pickup: ordinary-TS wave npm surface (post-0.1.20)

**Opened:** 2026-08-13 (run llp0245-0249-ordinary-ts-20260812)

Landing `5f76536e4` adds meaningful npm-facing surface on top of the 0.1.20
cut: `client.run`, `SnapbackDiagnosticError`/`isSnapbackDiagnosticError`, the
`./argument-normalization` and `./diagnostic-error` client subpaths,
`ctx.db.getMany`/`uniqueMany` (experimental `bounded_batch_reads_v1`),
`bounded-handler-typescript-v1` (.ts handler custody + profile artifact),
`snapback author suggest`/`suggestion apply`, the client-lifecycle manifest,
and the fenced presence-withdrawal server surface. Per the LLP 0041 rapid-
publication posture, landed-but-unpublished surface is a liability: the next
qualified release ceremony (0.1.21) should pick this up. The 0.1.20 ceremony
recipe (epoch 25, 2026-08-12) is the working template.

Also record: landing `5f76536e4` used the documented loud drift-gate bypass
(SNAPBACK_DRIFT_GATES_BYPASS=1, author-authorized in-session 2026-08-13)
after all 16 selected gates had just been run green on content identical up
to a docs-only rebase and the introduction-record re-pin; the 2-hour backstop
should find no residual drift, but treat any backstop ticket filed against
5f76536e4 as this landing's follow-up.

## Resolution — 2026-08-15

The pickup obligation is discharged: the qualified 0.1.21 promotion
(2026-08-14; twelve-package closure including the first `@expo/snapback`
publication, per `issues/closed/20260814-umbrella-first-publish-gate.md`)
carried the `5f76536e4` surface, and 0.1.22 followed
(`guide/published-closure.json`: newestPublished/newestQualified 0.1.22).
No open backstop ticket names `5f76536e4` in `issues/` at closure time;
any late backstop finding against that landing remains fix-forward work
under LLP 0189 as originally noted. Post-0.1.22 surface pickup is tracked
separately in
`issues/20260815-qualified-release-pickup-securestore-custody.md`.
