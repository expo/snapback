# Integration 17 security overlap review

Read-only inspection on merged 50e424577c. No source edits.

## Findings

One definite duplicated deadline advisory found (below). No unsafe whole-invariant proof or staging/dev-door integration miss found in the inspected paths. `security::blockers` unconditionally keeps every table with `through` (including `Through.live`) unproved. Inherited derived-target observer reductions also refuse. Source-maintenance observer components may prove their narrower rule implication, but cannot clear the whole-invariant live-parent blocker. A whole rule proof is not inferred from passing finite campaigns.

## Executed witnesses

1. Copied `tests/fixtures/live-parent.q` to `/tmp/integ17-security-live/snapback/schema.q`, appended `invariant tasks.read only .project.owner = viewer`, then ran merged debug binary `audit --json`. Exit 0; verdict and direct rule both unproved; policy remains unsupported (E_QUARRY_RULE_HOP); explicit live-parent/capture reduction reason retained; no counterexample fabricated. JSON at `/tmp/integ17-security-live.json`.
2. Minimal password-only source with owner-read table and `query who(): return viewer`, no invariants: merged binary `test --fixture-only`. Exit 0. Actual isolated deploy/production serve campaign refused 5 signed-out/forged-persona/development-door attempts. Rotation+logout-all refused 12 stale-token attempts. No engine campaign violations; query sweep passes. Log `/tmp/integ17-security-password-test.log`.
3. Same source `check --json`: exit 0, ok true, precisely one N_SECURITY_INTENT aggregate note in security.notes; compiler notes contain only N_NO_PRODUCTION_WRITER. No duplicated aggregate note or failure on upgrade-like no-invariant source. Raw output `/tmp/integ17-security-noinv-check.log`.

## Suggested coverage

Add an explicit security/live-parent regression using the witness above (and an invariant with global viewer-only policy) to lock in the conservative whole-verdict blocker. Existing live-parent runtime suite and security observer suite separately cover semantics but do not combine them. This is a coverage suggestion, not an observed correctness red.

## Scope checks

HTTP security campaign snapshots its actual running image, uses isolated ordinary `deploy` + `serve`, and never relies on a development persona or staging-only account seeding. Production /seed, /dev/reset and /dev/clock/advance must return refusal statuses. The KIT clock response shape cannot affect these refusal-only assertions. Test-time seat discovery is over schema, compiled operations and invariant literals, separate from public dev-door admission. LANG4 static notes and SEC advice remain separate channels; the aggregate note is emitted once.

## Confirmed deadline duplicate

FRONT `tests/front_semantics.rs` SWEEP fixture, replacing `closed` with `status`, produces BOTH static compiler N_SWEEP_DEADLINE and SEC source N_SWEEP_ONLY_DEADLINE at the same mutation site schema.q:14:1. They report the same tickets.status/deadline cleanup lag. `check --json` succeeds. Reproducer `/tmp/integ17-security-sweep/snapback/schema.q`; raw JSON `/tmp/integ17-security-sweep.json`. Root notified.

Suggested minimal repair: suppress the SEC source note for this exact site/table/status when the bound static notes already contain FRONT N_SWEEP_DEADLINE for it; preserve unmatched SEC fallback shapes. Site-only suppression can conceal a different table in a multi-table mutation, so include table/status identity. New combined regression belongs in security_observers.rs or front_semantics.rs, invokes add_source_notes and checks total count across both channels is one.

Live component clarification: the direct/point observer kernel treats expanded captured atoms independently and proves only implication of effective table read admission; it never asserts captured atom equals current parent. Thus a Proved component can coexist with a required Unproved whole verdict safely. Suggested combined test should assert that distinction, using `invariant tasks.read only allow`; parent-hop intent remains unsupported and unproved.
