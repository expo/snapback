muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
agent loop failed: model failed: API error 429 [request_id=e3486f78-2c25-4c6f-9ccf-9b18d3e27f79]: Subscription quota exhausted. Your usage window resets at 2026-10-26T00:00:00Z. (rate_limit_error)
[muse-exec] plan quota exhausted; retrying with the Meta API key
muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
READY.

No MATERIAL safety, custody, or design defects in the §21 amendment text or the `exact_write_authority` implementation ([release_bridge.rs](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4-lang/src/release_bridge.rs:429)). The revised admission (closed Boolean containment plus stable dominating viewer/literal positive-existence requires) is sound, and the wave-27 false-refusal shape (branched dispatcher/planner op with a dominating require) is genuinely admitted. Verified by code inspection only, per the no-build constraint.

Soundness evidence, all corroborated in code:

- `implies()` implements exactly the four spec rules (old-OR all-branches, old-conjunct any-branch, new-OR any-branch, new-AND every-branch) over an equality base with Deny/Allow extremes. Each rule is a classically sound introduction/elimination step; recursion is on strict subterms, so it terminates. No negation, distribution, or sampled implication. Different atoms are never equated.
- `stable()` admits only Viewer/Literal Eq/Ne, positive `Exists` with Viewer/Literal keys and equalities, And/Or, and Allow/Deny. It rejects `Created`, `Not`, `Compare`, row-image terms (`Field`/`OldField`/`NextField`), references, and `Public`, matching the spec's exclusion list.
- Requirements come from the unconditional statement prefix only, so every collected require dominates all later writes including branch/loop bodies. `write_tables` recurses into If/For bodies and domains, `Block` expressions, merge lanes, emit payloads, and write-target conditions, so the dependency-disjointness check sees the full expanded set. IR has no `Call` node (helpers are expanded pre-IR, a premise shared with the unchanged security-owned `prove()`), and the only viewer-changing construct (`as`) is job-only, read-only, lowers to the `JobAs` builtin, and is refused by `opaque()`, which also refuses `JobQuery` and `Emit` in both serialization forms.
- Patch-omission logic is faithful to the binder: IR `Object` always has static keys (dynamic spreads lower to `Shape`, never `Object`), non-object patches stay conservative, insert defaults count, updates don't apply defaults, and I confirmed upsert's update arm is merge ("omitted columns keep their values"), so omission is not supply on either arm.
- Transition-bound updates block table-rule implication; frozen columns have no require path, per spec. `quarry()` reparse drift can only refuse, never admit, via the `comparison.rule` guard. The caller ([releases.rs](/home/ccheever/projects/sb4-b27-rel/snapback4/crates/snapback4/src/verbs/releases.rs:195)) checks both active and latest-ordinary sources, and `latest()` excludes views.

Remaining false refusals (spec-compliant conservatism, not MATERIAL):

- The implicit-write veto (maintained/sequences/cascade) is schema-global: one unrelated cascade table anywhere disables require-reduction for every operation. The existing cascade test passes only vacuously (its old insert rule defaults to `Deny`, so `leading_guard` never runs), leaving this combination untested. Concrete repair if desired: scope the veto to tables intersecting the require's dependency set, mirroring how the write set is already scoped.
- Order-sensitive conjunctions/disjunctions and missing distribution refuse semantically identical policies; multi-module short-name collisions make `resolve()` return `None` and deaden the require path for that operation; only a single require (not the conjunction, unlike `prove()`) may supply containment, exactly per the spec's singular wording.

Note: the `exact_source_guard_keeps_named_probe_meaning` test name overclaims — with its `Deny` old rule it exercises vacuous admission, not probe-meaning alignment. Strengthening it with an explicit old `insert <- allow` would cover the cascade-plus-require interaction above.
