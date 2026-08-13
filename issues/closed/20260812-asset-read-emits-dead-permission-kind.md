# `asset_read_authorized` still emits `CapturedReadKind::Permission`

**Opened:** 2026-08-12 · **Severity:** P2 (correctness; silent future auth-invalidation hole) · **Area:** assets / live matcher / memberships

## What

`src/membership_rules.rs` states the trap explicitly: `Permission` is ignored by **both** the live matcher (`src/live_matcher.rs:314`) and `validate_captured_read_set`. A role revoke then races commit and never wakes live.

`asset_read_authorized` still emits that kind for membership sharing (`src/storage.rs:12723-12743`). The `MissingRow` arm has **no id**, so if it ever hits the matcher it is ConservativeFallback. The `Permission` arm is a no-op.

Reserved `_snapback.assetRecord` currently **always re-runs** on every non-empty frame (`src/local.rs:24223-24259`), so today’s asset live path papers over this. `asset_read_dependencies_moved` is still `#[allow(dead_code)]` (“live channel consumes it next”).

## Why it matters

Any future “exact match” for reserved projections, or any mutation witness that reuses this capture, silently ignores membership revoke — the exact failure `membership_rules.rs` says “would have shipped silently.”

## Fix

Emit the same ordinary membership `Query` probe `membership_capture_dependency` already builds (principal + resource + roles, including empty-result). Never `Permission`. Give MissingRow an id or use Query.

## Confidence

High on the capture kind. Today’s always-rerun reserved path masks the live symptom.

## Resolution (2026-08-12)

Replaced the asset membership branch's bespoke role lookup and dead
`Permission`/id-less `MissingRow` captures with the ordinary membership probe
and `membership_capture_dependency`. Both admitted and empty-result decisions
now capture a predicate-bearing `Query` that binds principal, resource, and
effective roles; this path no longer emits `CapturedReadKind::Permission`.

Regression coverage exercises an empty membership result and asserts the
captured kinds contain the `workspace_members` Query probe, contain no
Permission dependency, report zero results, and serialize all three filter
axes.

Evidence: `cargo test --lib
asset_membership_read_captures_ordinary_query_and_never_permission` (1 passed);
`cargo test --lib asset_read_` (2 passed); `cargo test --lib` (2,635 passed, 0
failed, 2 ignored).
