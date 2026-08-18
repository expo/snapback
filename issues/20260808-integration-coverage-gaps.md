# Integration coverage gaps: JS wire-fixture conformance, fork/branch promotion black-box, push delivery

**Opened:** 2026-08-08 · **Severity:** P2 (risk-weighted coverage holes on data-integrity paths) · **Area:** tests / cross-arm conformance

Three areas whose product risk is high relative to their current black-box test
presence.

## A) No JS consumer of the shared wire-fixture corpus

`schemas/live.wire-fixtures.v1.json` is replayed by Rust and Swift
(`clients/swift/.../FixtureConformanceTests.swift:160`) but **not** by any JS
package — `rg "live.wire-fixtures" packages/ cloudflare/` is empty. The JS
client's wire correctness rests on its own unit suite, not the cross-arm corpus
LLP 0095 designed; a coordinator/kit frame that diverges from the schema (see
the pong `serverTimeMs` ticket) isn't caught cross-arm. *Ask:* add a JS replay
harness of the same corpus — a test-only change with outsized drift-protection
value.

## B) In-app fork/branch promotion has zero black-box coverage

`crates/snapback/src/fork_promotion.rs` (9,322 lines) has 37 in-file unit tests but **zero**
references from `tests/` (`rg "fork_promotion|promote_branch|promotable|
OverlayWrite" tests/*.rs` is empty). Promotion-by-re-execution inside a hidden
canonical transaction is precisely the data-integrity path that needs black-box
coverage through the server/CLI surface. *Ask:* one integration binary that
drives a promotion end-to-end and asserts the boundary digest / effect
settlement.

## C) Push delivery state machine has no integration exercise

`crates/snapback/src/push.rs` (5,649 lines) + `crates/snapback/src/push/fake_expo.rs` have 19 unit tests; the
fake provider is referenced only from `crates/snapback/src/push.rs` itself. No integration/
acceptance test exercises queueing, retry, or provider-error paths. Thin-layer
by design (LLP 0000), but the delivery state machine is nontrivial. *Ask:* an
acceptance script driving enqueue → fake-provider error → retry → settle.

## Also noted (lower priority)

Error tracking (`error_tracking.rs` + `errors_query.rs`, ~3.4k lines) has 13
unit tests and no `tests/` presence; the query surface is user-facing.

## Confidence

High — these are measured absences (grep-verified), not judgment calls. Severity
is risk-weighted, not defect-driven.

## Disposition (2026-08-08 review-fixes sweep)

Actionable core is Part A — a JS replay harness for
`schemas/live.wire-fixtures.v1.json` (test-only, high drift-protection value);
recommend a small dedicated test lane. Parts B (fork_promotion black-box through
the server/CLI surface) and C (push delivery state-machine integration) are
larger test programs, appropriately tracked here as follow-ups rather than folded
into the bug-fix sweep. No code landed for this ticket in the sweep; it stays
open.

## Progress (2026-08-10)

Part A now has a dedicated JavaScript lane that replays all `poll/local` and
`live/local` judgments in the shared format-v3 corpus against the production
client's extracted version/delta reducer and a test model of the surrounding
request and lifecycle edges. The gate is registered in the canonical local
proof and classified for client changes. Parts B and C remain open.

## Dated note — 2026-08-10 (item A landed)

Item A landed: a dedicated JS lane replays `schemas/live.wire-fixtures.v1.json`
against the JS client (50 fixtures, 78 local judgments; suite 23/23),
registered and classified in the local proof. Items B (black-box
`crates/snapback/src/fork_promotion.rs` coverage) and C (push delivery state-machine
integration) remain open — this ticket stays open for them.
