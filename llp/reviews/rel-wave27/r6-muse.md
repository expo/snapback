muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
agent loop failed: model failed: API error 429 [request_id=1b625fff-05e7-45d3-bdb1-f723dd991076]: Subscription quota exhausted. Your usage window resets at 2026-10-26T00:00:00Z. (rate_limit_error)
[muse-exec] plan quota exhausted; retrying with the Meta API key
muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
muse: retrying model turn in 1000ms (attempt 2/10): server_error: The model failed to generate a response.
READY — no MATERIAL safety, custody, or design defects in normative §21 or `exact_write_authority`.

Verified against [release_bridge.rs](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4-lang/src/release_bridge.rs) (esp. `exact_write_authority`, `leading_guard`, `implies`, `stable`, `writes_column`, `opaque`), its callers in [releases.rs](/home/ccheever/projects/sb4-b27-rel/snapback4/src/verbs/releases.rs), and supporting modules (`release_bridge_policy.rs`, `release_bridge_indexes.rs`, `release_bridge_current.rs`, `release_bridge_guards.rs`, `ir/writes.rs`, `bind/security/operation.rs`, `bind/security/kernel.rs`):

- Dual gate holds: historical/exact selection checks target-vs-active AND target-vs-latest-ordinary (`latest()` filters views), under command lock with activation CAS. Equal-source forward deploy routes through the same check.
- Boolean containment is exactly as specified (old-OR all-branches, old-AND any-branch, new-OR any-branch, new-AND all-branches), pure structural, plus sound `Deny`/`Allow` shortcuts.
- Synthetic `invariant T.op only allow` proof uses no print/reparse; requirements are top-level leading `Require`s only (conditional requires unreachable), bound independently in the historical schema.
- `stable()` admits only viewer/literal equalities and positive `Exists` with viewer/literal keys/equalities (+AND/OR); row images, `Not`, references, `Created`/`Compare`/`Public` all refuse. Locals/args fail rule binding and are dropped (conservative).
- Footprint is complete: `write_tables` covers every IR `Stmt` variant including `If`/`For`/* bodies, `WriteTarget` condition setup, merge lanes, and `Block` expressions; job `as` lowers to read-only `JobAs`, which `opaque()` refuses along with `JobQuery`/`Emit` (also covering nested `JobQuery` programs that footprinting cannot see).
- Implicit-effect refusal is footprint-limited (maintained/sequences/maintains on written tables; cascade only for delete effects on written tables), so unrelated edges no longer block. Direct lifetime/expiry/recorded probe populations refuse (`through.is_none()`, `is_expiring()` covering ephemeral/`expire`/inherited, `recorded.is_empty()`).
- Patch analysis is sound at the IR-type level (`Object` is fixed-key-only by construction; `Shape`/`Block`/`Variable` stay conservative), null-insert carve-out matches engine semantics, defaults count for insert/upsert, upserts require both arms, freezes get no leading-guard rescue, and refusals name site, operation, column, and rule.

Only non-material nits: prose says "equality" where code also admits sound `Ne`; prose says "full dependency closure" where code checks direct probe tables (transitively harmless inside one atomic transaction). Both err toward refusal, never toward unsound admission.
