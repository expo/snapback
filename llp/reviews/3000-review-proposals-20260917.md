# Five remaining Snapback 4 review proposals — document review, 2026-09-17

Reviewer: fresh Codex / GPT-6 read-only session, same model family as the author.
Scope: five new Draft proposal sections and their root/ticket/journal integration.
This is a bounded document review, not author acceptance, runtime qualification
or the independent disclosure/security review required before implementation.

## First received review

**MATERIAL FINDINGS REMAIN** for candidate `4b2de9d69e7934b48c53effa69cc289ec809d1c8`, reviewed against baseline `70a663c22285dc3a5278ca9ac13db01bbe05446b`.

One material concern:

1. **The delegated-token restriction does not cover all caller endpoints.** LLP 3000.009:1160, particularly lines 1178–1183, specifies query/mutation allowlists and checks direct HTTP calls to those operations. It leaves the authority of the same delegated credential on other caller endpoints unspecified.

   This matters because current action sessions authenticate as ordinary caller sessions: `authority::live_session` accepts a live action claim, and `serve::principal_of` discards the session kind when returning its principal. `/sync` then acquires that principal's partition without selecting a declared query operation (`serve.rs:1062`). Public action admission likewise accepts the delegated session and can create child work (`actions.rs:63`). A narrow worker could therefore obtain data outside its query allowlist through sync, or exercise additional caller authority through other endpoints, unless the proposal expressly removes those ambient permissions.

   **Requested correction:** Define delegated tokens as default-deny outside their enumerated invocation-bound capabilities. Explicitly cover sync/snapshots, change feeds, child-action admission, assets, and caller identity/session endpoints. Deny them initially or introduce separately specified scopes with inherited grant and invocation fences. Add negative direct-HTTP validation cases. Also clarify that worker credentials do not implicitly receive direct service-data authority; independently provisioned service-data credentials may retain ordinary row-rule semantics.

No other material finding emerged in this bounded review. The staged-sync draft preserves invisible staging, atomic publication and current-authority reconciliation; the physical-work draft preserves logical disclosure constraints and marks unsupported witness shapes unresolved; retention explicitly preserves deduplication identities and acknowledges residual unbounded storage; the entropy draft covers source injection, Expo Go, failure-before-admission and minter state integrity. Their deferred measurements and design proofs are appropriately presented as future work.

Minor clarification: In the physical-work proposal, explicitly include `nextExpiry` in witness equivalence and paired observations. The existing boolean probe also records the first live witness's expiry, so a maximum-lifetime index must preserve that observable behavior or separately propose changing it. The draft's existing requirement to preserve ordering-sensitive semantics already guards this; naming it would make implementation less error-prone.

This was a read-only documentation and source review. No builds, runtime qualification, edits, or acceptance decisions were performed.

## Author disposition

Both points accepted. The worker proposal now denies unenumerated delegated-token
endpoints, explicitly covers the listed bypass routes and worker direct-data
access, and adds negative HTTP cases. Work lease headers retain their separate
meaning. The physical-work proposal now requires expiry/invalidation equivalence
and says that a maximum-lifetime boolean lookup alone does not establish the
complete ordered-witness contract. A follow-up verdict is recorded only after
it is actually received.
