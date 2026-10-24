muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
agent loop failed: model failed: API error 429 [request_id=31391d78-ad59-4a41-a96a-6c4f9a725aa6]: Subscription quota exhausted. Your usage window resets at 2026-10-26T00:00:00Z. (rate_limit_error)
Verdict: MATERIAL — do not implement as written.

This is a design review only. No files were edited. No tests were run.

## Security

**F1 — Uniqueness relaxation has no explicit registration trigger (§20.1).**
Registration requires widening without a down, or hiding/misrepresentation. A relaxed unique key with no domain change is neither, unless foresight happens to flag it.
Admission compares unique keys, but admission is not a trigger.
Fix: state that any enforcing-key weakening, including nonunique-to-unique reversal and unique-to-nonunique relaxation, registers a view even with identical domains, or prove foresight always flags cardinality-change misrepresentation.

**F2 — Frozen columns and new write audiences rely on an undefined gate (§21).**
A new write audience or frozen column alone does not register a view. Safety then rests on “independent current-authority activation gate” refusing unauthorized old writes.
Fix: define that gate to explicitly include column write audiences and frozen predicates for both default-view writes and `--exact` writes, or require a view. Currently only view transport is stated to compare them.

**F3 — Reference on-delete policy change is destructive under current-shape retention (§20, §21).**
Shared tables retain current reference-deletion shape. §21 then permits a rename to change deletion policy in the same release.
An old client deleting a parent expecting `restrict` would cascade under current policy through the view.
Fix: forbid policy strengthening toward cascade/set-null with live children, pause the old delete export with `E_OP`, or preserve old delete refusal in the view.

**F4 — Registry-custody field covers hot only (§20.4).**
Every hot activation carries the explicit registry-custody feature field. Cold, preview and restart also select immutable source, but are not stated to carry/require it.
Fix: require the field on all activation paths, or explain why cold/restart cannot execute adoption without the new laws. Also clarify cross-context borrowing: forbid borrowing any foreign manifest, not only “later deployment’s view.”

## Migration custody

**F5 — Child refill rule cannot distinguish reversal-move from user clear (§21).**
A receipt-owned anchored child with absent/null asset “because reversal moved its home” may be refilled from the parent. No provenance rule distinguishes this from optional clearing/replacement, which must never revive released bytes.
Fix: define the cause proof, e.g. ledger home-move receipt vs explicit clear/replace receipt, and refuse refill on ambiguous or cleared history.

**F6 — Repair naming order is advisory, not enforced (§21).**
“Definition names keep their immutable meaning; repairs name the order: select/deploy a bridge … add a new transformation name for new meaning.”
Fix: make admission reject reuse of a transformation/down name with changed meaning, and state how the checker detects it. Otherwise a second cycle can launder a projection into a new authored value, defeating the backfill/down receipt distinction stated in the same section.

## Completeness

**F7 — Optional-argument default precedence is ambiguous (§20 Integration 23).**
New optional arguments “take the current language null value or their explicit authored default.”
Fix: specify precedence, e.g. explicit authored default when present else null, and refuse when neither exists. Two implementations could otherwise choose different values.

**F8 — Nullability/cardinality join direction is unstated (§20.1).**
Domains join per LLP 3000.000.000.002 §8, with “nullability and list cardinality join separately.” The acknowledged-hiding example joins nullable new + required old to required widened. The default union must do the opposite, nullable wins, or it hides.
Fix: state the fail-closed default explicitly and fence the required-widened outcome to the acknowledged-hiding form only.

**F9 — Proof and qualification gaps (§21).**
Day-two proof “excludes writes intentionally performed through the v1 client.” That excludes exactly the writes most likely to diverge. “Mac is skipped” and “short differential runs” are unexplained. Saved-version private codegen covers the TypeScript unit but not native/worker bundles.
Fix: include v1 writes or separately validate them; justify Mac skip and define “short”; extend private codegen or fence native/worker paths.

If F1–F9 are closed, re-review.
