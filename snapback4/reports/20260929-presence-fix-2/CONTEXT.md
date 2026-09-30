# Existence correction: context and scope

Scope: the Read contract, client publication/prediction predicate, hooks/pages,
read fixtures, starter applications and the two authoring cards. The blind
code review was read in full before editing. No core interpreter implementation
changed in this correction.

Governing constraints: LLP 3000 §4 fences Snapback 4; LLP 3000.031 §§1.1, 3–4
owns the disclosed-value classifier, pending exclusion, reader compatibility
and acceptance; LLP 3000.023 §10 owns retention, change bounds and withdrawal;
LLP 3000.016 §2.2 owns prediction fencing and complete-local dependency narrowing.
The current client and offline-interactions cards were read before changes.

No new protocol, owner-key authority, retention policy or diagnostic cause was
introduced. The renamed discriminator is computed locally; engine/wire answers
remain unchanged. Connection-state presence keeps its existing runtime and card.

B2's explicit fallback is used: structural point types cannot simultaneously
promise exact null for every absent arm and accept every array subtype.
The public types preserve covariance through named interfaces with fixed
intersections. LLP 3000.031 §3 gives the exact remaining narrowing.

Doc updates stay in LLP 3000.031 (same filename and number); its title/body use
existence, and its revision note records the former spelling and reason.
No new LLP or additional review delegation was needed. Hand-off: none.

Qualification extended the scope to dev_refusal_console.rs after the real
shutdown test caught lifecycle diagnostics splitting a counted refusal line.
LLP 3000.015 §2.1 and the current refusals guide card govern its one-line,
counted-window output and acknowledged shutdown. lifecycle.rs deliberately
bypasses Rust's stderr mutex for signal/panic safety; that policy stays intact.
The console writer prepares the whole line before writing it. LLP 3000.031
§1.2 records the repair without changing DX's quiet-empty policy or bounds.
