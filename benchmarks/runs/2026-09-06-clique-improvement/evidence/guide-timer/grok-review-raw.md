# READY

Independent review of Snapback2 `f7c7b10611bc936162475f1fa8ddb1ca3345b184` against `0063509e13a9a80f50d16e157edf9640be0a98a1`. No material findings.

The revision recertifies the cached `project.json`, takes the operation set from `Generation::programs()` (the same map `stage_build_cache` writes to `certificates.json`), requires every such certificate to be present and JSON-equal to the recertified `Certificate`, and emits that map. Schedule bindings stay in `project.json` programs and in `timer_bindings`; they are not operations. User-authored names that merely look like `_timerBinding_*` remain operations. Seed and unreadable-cache refusals are unchanged. Extra keys in `certificates.json` are ignored; every active operation must match.

## Scope read

Diff plus callees/tests only: `snapback2/crates/snapback2/src/guide.rs`, `snapback2/crates/snapback2/tests/guide.rs`, `llp/1002-dev-loop.spec.md`, `Generation::certify` / `programs()` / `timer_binding*` in `snapback2-core/src/registry.rs`, `timers::certify` and binding-name emission, `project::stage_build_cache` / `compile_once` / `Ceilings::default()`, chat `expireMessage` / `purgeMessage`, compiler `prepareSchedules`. No other reviews. No live benchmark app. Snapshot source was not modified.

## Executed checks

Isolated copy under `/tmp/snapback2-f7-review` (frozen tree untouched). `bun install --frozen-lo# READY

Independent review of Snapback2 `f7c7b10611bc936162475f1fa8ddb1ca3345b184` against `0063509e13a9a80f50d16e157edf9640be0a98a1`. No material findings.

The revision recertifies the cached `project.json`, takes the operation set from `Generation::programs()` (the same map `stage_build_cache` writes to `certificates.json`), requires every such certificate to be present and JSON-equal to the recertified `Certificate`, and emits that map. Schedule bindings stay in `project.json` programs and in `timer_bindings`; they are not operations. User-authored names that merely look like `_timerBinding_*` remain operations. Seed and unreadable-cache refusals are unchanged. Extra keys in `certificates.json` are ignored; every active operation must match.

## Scope read

Diff plus callees/tests only: `snapback2/crates/snapback2/src/guide.rs`, `snapback2/crates/snapback2/tests/guide.rs`, `llp/1002-dev-loop.spec.md`, `Generation::certify` / `programs()` / `timer_binding*` in `snapback2-core/src/registry.rs`, `timers::certify` and binding-name emission, `project::stage_build_cache` / `compile_once` / `Ceilings::default()`, chat `expireMessage` / `purgeMessage`, compiler `prepareSchedules`. No other reviews. No live benchmark app. Snapshot source was not modified.

## Executed checks

Isolated copy under `/tmp/snapback2-f7-review` (frozen tree untouched). `bun install --frozen-lockfile` and `node packages/snapback2/build.mjs` were used only there; missing `node_modules`/`dist`/`target` in the archive is not a product failure.

1. `CARGO_TARGET_DIR=/tmp/snapback2-f7-target cargo test -p snapback2 --test guide`
   - 13 passed, 0 failed, including the two new tests and the extended stale-cert loop.
   - `app_guide_uses_chat_expo_operations_without_internal_timer_bindings` green: after chat Expo `init` and again after `check`, `project.json` contains `deliveries._timerBinding_expireMessage`, `certificates.json` does not, `guide app` succeeds without that name and with `deliveries.purgeMessage` / `deliveries.post`, operation keys equal certificate keys, bounds/sites/kind/args match the files, generation hash equals `schema_hash`, build snapshot unchanged.
   - `app_guide_requires_exposed_operations_even_with_timer_binding_names` green: `adversarial._timerBinding_exposed` is in operations; removing that key, `deliveries.post`, or `deliveries.purgeMessage` yields `E_GUIDE_STALE` / `run snapback2 check` naming the missing operation.
   - `app_guide_refuses_missing_certificates_and_failed_seed_facts_as_stale` green, including `todos.list` set to `null`, `{}`, or a cert with `max_steps: 0`.

2. Fail-before (same tests, `app_page` restored to the pre-f7 body in the isolated copy only):
   - `app_guide_uses_chat_expo_operations_without_internal_timer_bindings` FAILED at `after check=false` with `E_GUIDE_STALE` `certificates.json is missing operation(s): deliveries._timerBinding_expireMessage`. That is the real Expo init inventory, not a stub map.
   - `app_guide_requires_exposed_operations_even_with_timer_binding_names` FAILED on the first `guide app` with the same expireMessage binding missing-cert, before the exposed-name assertions.
   - `app_guide_refuses_missing_certificates_and_failed_seed_facts_as_stale` FAILED at the new loop: `todos.list = null` made `guide app` exit 0 and emit `readSites`/`writeSites`/`maxExamined`/`maxSteps` as JSON `null` (invented bounds). Expected exit 1.

Not executed here (author claims, not this review’s proof): other `project` tests, manual owner/why/cache assertions, full `scripts/test.sh`, publication.

## Static reasoning

**Custody.** `Generation::certify` inserts every declared program, then `programs.remove(&binding.name)` for each schedule (`registry.rs` after `timers::certify`). `stage_build_cache` serializes only `generation.programs()`. Old `app_page` walked `project.programs`, so a valid chat cache was permanently `E_GUIDE_STALE` and `check` could not add the binding cert. New `app_page` uses the same map as the writer for both completeness and output (`guide.rs` missing-cert filter, exact-match loop, and operations collect).

**No naming suppression.** Classification is schedule-binding identity from certification, not a `_timerBinding_` string. A query `adversarial._timerBinding_exposed` is not `schema.schedules[].binding`, stays in `programs()`, and is required. `deliveries.purgeMessage` (public schedule target) stays in `programs()`; only the binding is removed.

**Fake / missing / null / stale certs.** Missing key → `E_GUIDE_STALE` listing names. Present but not `Some(&json!(certificate))` (null, `{}`, wrong `max_steps`, or any other field) → `E_GUIDE_STALE` for that name. Unreadable/unparseable `certificates.json` still stale before certify. `Ceilings::default()` matches `compile`/`compile_once`, and the green Expo/todos paths show `to_vec_pretty` then parse equals `json!(Certificate)` for real certs. Extra top-level cert keys are never iterated, same as before.

**Diagnostics.** Certify now precedes the operation-cert checks because the operation set is the certified map. Certify failure remains `E_OWNER_BUILD_CACHE` / `rerun snapback2 check` (unchanged family). Seed still runs after cert checks and still `E_GUIDE_STALE`. Mismatch reports the first BTreeMap name rather than all names; missing still joins all missing names. One refusal per verb invocation; not a correctness miss. Rewrite for stale paths remains `run snapback2 check`. Cache is not written.

**Output.** Envelope still `{ generation, tables, operations, channels, personas }` with `kind`/`args`/`readSites`/`writeSites`/`bounds`. Todos (no schedules) is the same set as `project.programs`. Chat Expo succeeds and omits the internal binding; that is the intended successful shape, not a silent shrink of a previously successful page (the old page never succeeded on this inventory).

**Tests vs inventory masking.** Test 1 reads the real init/check files, asserts the binding is in `programs` and absent from `certificates.json`, then asserts `guide app` follows the certificate map and still includes the public target. Key equality against certificates cannot pass if output were `project.programs` (binding would appear). Test 3’s new branch is a real file mutation, and fail-before showed success-with-null-bounds rather than a skipped assertion. Test 2’s pre-fix failure is the expireMessage binding, not the exposed name; the exposed-name and public-target removal checks are post-fix. Together with test 1 they still pin classification to custody, not a name filter.

**LLP 1002** (revised 2026-09-06): app guide uses the certified operation map; schedule bindings are internal (LLP 1016 D5); names do not decide operation-hood; missing/mismatched certs and bad seed are `E_GUIDE_STALE` without repair or invented bounds. Matches the code.

**Out of scope as claimed:** no runtime/authoring/schema/client edits in this diff; no performance claim reviewed.
