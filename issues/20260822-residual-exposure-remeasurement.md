# Re-measurement: the property is still false, but true for three named subsets

Status: Superseded — rerun after the detached-action landing; latest measurement linked below
Created: 2026-08-22
Related: issues/20260821-residual-caller-terminal-write-exposure.md (the original measurement),
issues/20260822-authorized-effect-program-status.md

## The question, unchanged

> Can an ordinary session or scoped-service caller still get a durable SQLite write committed after
> their own authority has gone terminal?

## The answer at `261e595ad`

**Still no — the property is false.** The highest-consequence remaining path is unchanged:
detached-action `ctx.runMutation`. The detached host retains the caller's `PreparedAuthority`,
child mutations inherit it, and `validate_live` checks abandonment, generation and deadline —
**not session or service liveness**. The final closures acquire only the mode guard plus action
gate before the SQLite commit. It applies to session and scoped-service callers alike and can
commit arbitrary application mutation effects.

That path was blocked on an author ruling at this measurement point. The
caller-bound ruling landed 2026-08-22 and the detached-action fence later
closed this top path; see
`issues/20260823-remeasurement-after-detached-action-fence.md`.

## But it is now true for three named subsets

This is the part the original measurement could not say:

1. **Ordinary `/mutation` calls** once the approval gate has returned without creating a pending
   effect. The route reserves session/service authority before Local, and every HostPlan and Ibex
   commit branch reaches the reservation's deepest guard. *(Approval-gated intent creation remains
   outside this bound.)*
2. **The eight migrated cuts** — capability-link mint and revoke, the three immediate-push cuts
   when an actual publication exists, Session acknowledgement, agent-invitation mint, Ask spend
   reservation.
3. **The complete caller-backed asset SQLite family** — inspect and TUS HEAD reserve through lazy
   expiry; finalize reserves independently for preflight, planning, completion/retry and cleanup
   receipt; width paths reserve around every SQLite phase while leaving the PUT outside.

A property true for precisely-bounded subsets is a materially different position from one that is
globally false, and worth stating that way.

## The landings introduced no new exposure

Checked specifically, because fences adding reservations and permit-splitting to previously
unfenced paths is exactly how new races appear — and this program has seen fixes introduce their
own defects:

- `AuthorizedEffectReservation` owns the publication and service permits and each commit guard
  **borrows** it, so acquiring and dropping an inner guard cannot release the outer permit.
- Push branches on `has_fenced_publication()`, which checks the actually-installed publication and
  explicitly preserves mode-only credential-free watch reactions. Reservation, claim and
  transmitting each take a fresh reservation before their own guarded transaction.
- Session acknowledgement uses **one** reservation across both current- and legacy-fingerprint
  commits, so logout cannot slip between them. Its scoped-service sibling stays on exact
  revalidation inside the serialized Local turn.
- Asset finalize retains one reservation across all Phase-A siblings and another across Phase-C/D,
  dropping only before PUT and cleanup, with the next SQLite phase reacquiring.
- Moved-witness revalidation is permit-free but read-only, and the route reserves again before
  returning to Phase C/D.

Marked INFERRED: this is static analysis, not exhaustive execution.

## Where the closure set stands

Every remaining caller-backed asset SQLite cut is closed, and 8 of 9 previously in-flight mode-only
sites are closed. What remains: six active ranked direct-route families plus the stream-attempt
family, with watch creation deliberately excluded and standalone clock prewrites removed from the
active set by the accepted disposition (clocks attached to still-open approval or denial parents
remain part of those parent fixes).

## Provenance

Read-only codex re-measurement against `261e595ad`. Full per-exposure delta table and citations
appended below.

---

## Current answer

No—the safety property is still false at `261e595ad`. Yes, an ordinary session or scoped-service caller can still cause a durable SQLite commit after its own authority has terminated.

The highest-consequence remaining path is detached-action `ctx.runMutation`: the detached host retains the caller’s `PreparedAuthority`, child mutations inherit it, and `validate_live` checks abandonment, generation, and deadline—not session/service liveness ([server.rs:675](crates/snapback-server/src/server.rs:675), [server.rs:1093](crates/snapback-server/src/server.rs:1093), [server.rs:1307](crates/snapback-server/src/server.rs:1307)). The final closures still acquire only the mode guard plus action gate before the SQLite commit ([engine.rs:18055](crates/snapback-engine/src/local/engine.rs:18055), [engine.rs:18338](crates/snapback-engine/src/local/engine.rs:18338), [storage.rs:6083](crates/snapback-kernel/src/storage.rs:6083)). This applies to both session and scoped-service callers and can commit arbitrary application mutation effects.

The property is true for these meaningful subsets:

- Ordinary `/mutation` calls after the approval gate has returned without creating a pending effect. The route reserves session/service authority before Local, and every HostPlan/Ibex commit branch reaches the reservation’s deepest guard ([server.rs:27379](crates/snapback-server/src/server.rs:27379), [server.rs:27457](crates/snapback-server/src/server.rs:27457), [engine.rs:17278](crates/snapback-engine/src/local/engine.rs:17278), [engine.rs:17355](crates/snapback-engine/src/local/engine.rs:17355)). Approval-gated intent creation remains outside that bound.
- The eight `860c2c2fd` migrated cuts: capability-link mint/revoke, the three immediate-push cuts when an actual publication exists, Session acknowledgement, agent invitation, and Ask reservation. Examples of the outside-Local reservations and deepest guards are at [server.rs:25888](crates/snapback-server/src/server.rs:25888), [server.rs:2019](crates/snapback-server/src/server.rs:2019), [server.rs:27181](crates/snapback-server/src/server.rs:27181), [server.rs:14835](crates/snapback-server/src/server.rs:14835), and [server.rs:25252](crates/snapback-server/src/server.rs:25252).
- The complete caller-backed asset SQLite family. Inspect/HEAD now reserve through lazy expiry ([asset_routes.rs:150](crates/snapback-server/src/server/asset_routes.rs:150), [asset_routes.rs:356](crates/snapback-server/src/server/asset_routes.rs:356)); finalize reserves independently for preflight, planning, completion/retry, and cleanup receipt ([asset_routes.rs:228](crates/snapback-server/src/server/asset_routes.rs:228)); width paths reserve around every SQLite phase while leaving PUT outside ([asset_routes.rs:562](crates/snapback-server/src/server/asset_routes.rs:562), [asset_routes.rs:763](crates/snapback-server/src/server/asset_routes.rs:763)). Both storage wrappers acquire the guard immediately before `COMMIT` ([asset_attempts.rs:353](crates/snapback-kernel/src/storage/asset_attempts.rs:353), [asset_reads.rs:213](crates/snapback-kernel/src/storage/asset_reads.rs:213)).

The reservation’s exact bound is: terminal-first closes later reservations; reservation-first retains the session/service permits and forces the terminal transaction to wait until the guarded commit finishes ([invocation.rs:1225](crates/snapback-sync/src/auth/invocation.rs:1225), [invocation.rs:1267](crates/snapback-sync/src/auth/invocation.rs:1267), [invocation.rs:1701](crates/snapback-sync/src/auth/invocation.rs:1701)).

## Delta for the original nine

None of the nine ranked findings was closed by these two implementation landings. The implementation work closed the separately listed in-flight and asset blocks.

| # | Original exposure | Delta | Current evidence |
|---|---|---|---|
| 1 | Detached-action nested mutations | **Unchanged** | Caller authority is retained/inherited, but the commit still has only mode plus action-liveness guards ([server.rs:1279](crates/snapback-server/src/server.rs:1279), [engine.rs:18061](crates/snapback-engine/src/local/engine.rs:18061), [engine.rs:18364](crates/snapback-engine/src/local/engine.rs:18364)). |
| 2 | Grant/OAuth approval | **Unchanged** | Grant approval remains mode-only ([server.rs:15014](crates/snapback-server/src/server.rs:15014)); it inserts the delegated grant and changes the request without checking the initiating session row ([auth_grants.rs:438](crates/snapback-kernel/src/storage/auth_grants.rs:438), [auth_grants.rs:491](crates/snapback-kernel/src/storage/auth_grants.rs:491)). OAuth still performs approval and code issuance as two mode-only transactions ([oauth.rs:567](crates/snapback-server/src/server/oauth.rs:567), [oauth.rs:581](crates/snapback-server/src/server/oauth.rs:581), [engine.rs:4933](crates/snapback-engine/src/local/engine.rs:4933), [engine.rs:4952](crates/snapback-engine/src/local/engine.rs:4952)). |
| 3 | Pending-effect approval | **Unchanged** | The approver session is prepared, but the decision still takes a mode-only guard ([effects.rs:240](crates/snapback-server/src/server/effects.rs:240), [engine.rs:5134](crates/snapback-engine/src/local/engine.rs:5134)). The transaction consumes proof and commits `pending → approved`, after which the original mutation/action is dispatched ([pending_effects.rs:624](crates/snapback-kernel/src/storage/pending_effects.rs:624), [effects.rs:326](crates/snapback-server/src/server/effects.rs:326)). |
| 4 | Watch renewal/management | **Unchanged** | Transition and renewal remain mode-only ([engine.rs:24451](crates/snapback-engine/src/local/engine.rs:24451), [engine.rs:24472](crates/snapback-engine/src/local/engine.rs:24472)). Resume still has an unfenced transition followed by a second enqueue transaction ([watches.rs:599](crates/snapback-kernel/src/storage/watches.rs:599), [watches.rs:616](crates/snapback-kernel/src/storage/watches.rs:616)); renewal still replaces the anchor grant and commits at [watches.rs:526](crates/snapback-kernel/src/storage/watches.rs:526). Transitions admit sessions and active scoped integrations ([engine.rs:38617](crates/snapback-engine/src/local/engine.rs:38617)). |
| 5 | Denial/revocation decisions | **Unchanged** | Pending-effect denial ([engine.rs:5158](crates/snapback-engine/src/local/engine.rs:5158)), grant denial ([server.rs:15038](crates/snapback-server/src/server.rs:15038)), OAuth denial ([engine.rs:4911](crates/snapback-engine/src/local/engine.rs:4911)), and grant revocation ([server.rs:15080](crates/snapback-server/src/server.rs:15080)) remain caller-mode-only. The target service-terminal gate protects the tokens being retired, not the initiating management session. |
| 6 | Approval-gated intent creation | **Unchanged** | The helper still runs before the ordinary mutation reservation ([server.rs:27354](crates/snapback-server/src/server.rs:27354)), persists Session or ServicePrincipal authority snapshots ([server.rs:27764](crates/snapback-server/src/server.rs:27764)), and calls a mode-only insert before returning `202` ([server.rs:27823](crates/snapback-server/src/server.rs:27823), [engine.rs:6120](crates/snapback-engine/src/local/engine.rs:6120), [pending_effects.rs:559](crates/snapback-kernel/src/storage/pending_effects.rs:559)). |
| 7 | Auxiliary artifacts | **Newly-understood-differently** | Behavior is unchanged: OAuth proposals, pairing hashes, and operation ranges remain mode-only ([engine.rs:4885](crates/snapback-engine/src/local/engine.rs:4885), [server.rs:14860](crates/snapback-server/src/server.rs:14860), [engine.rs:11001](crates/snapback-engine/src/local/engine.rs:11001)). They are now explicitly accepted because a terminal-first outcome leaves no delivered code, usable grant, spend, or cross-authority range ([disposition:254](issues/20260822-residual-findings-4-9-disposition.md:254)). |
| 8 | Read-side lazy expiry/pruning | **Newly-understood-differently** | The non-asset paths remain mode-only and can still commit cleanup after logout ([engine.rs:4990](crates/snapback-engine/src/local/engine.rs:4990), [pending_effects.rs:475](crates/snapback-kernel/src/storage/pending_effects.rs:475), [auth_grants.rs:612](crates/snapback-kernel/src/storage/auth_grants.rs:612)). They are accepted as authority-independent expiry/pruning ([disposition:285](issues/20260822-residual-findings-4-9-disposition.md:285)). The asset members were separately closed by `261e595ad`. |
| 9 | Authorization-clock prewrites | **Newly-understood-differently** | The separate clock transaction still exists ([auth_agent_credentials.rs:1443](crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1443)). It is no longer an independent closure item: clocks belonging to findings 2 and 5 must be absorbed into those parent transactions; clocks belonging to accepted findings 7/8 remain accepted ([disposition:309](issues/20260822-residual-findings-4-9-disposition.md:309)). |

## Did the landings create anything new?

**INFERRED: no new ordinary-caller terminal-write exposure was introduced.** Static confirmation:

- An `AuthorizedEffectReservation` owns the publication and service permits, and each commit guard borrows the reservation, so acquiring and dropping an inner guard does not release the outer permit ([invocation.rs:1229](crates/snapback-sync/src/auth/invocation.rs:1229), [invocation.rs:1243](crates/snapback-sync/src/auth/invocation.rs:1243)).
- Push branches on `has_fenced_publication()`, whose definition checks the actual installed publication and explicitly preserves mode-only credential-free watch reactions ([invocation.rs:1501](crates/snapback-sync/src/auth/invocation.rs:1501)). Reservation, claim, and transmitting each obtain a fresh reservation before their respective guarded transaction ([server.rs:2019](crates/snapback-server/src/server.rs:2019), [server.rs:2060](crates/snapback-server/src/server.rs:2060), [server.rs:2095](crates/snapback-server/src/server.rs:2095)).
- Session acknowledgement uses the same reservation across both current- and legacy-fingerprint commits ([engine.rs:10939](crates/snapback-engine/src/local/engine.rs:10939), [engine.rs:10973](crates/snapback-engine/src/local/engine.rs:10973)). Its scoped-service sibling remains on exact service revalidation inside the serialized Local turn ([engine.rs:10886](crates/snapback-engine/src/local/engine.rs:10886)).
- Asset finalize retains one reservation across all Phase-A sibling transactions and a separate one across all Phase-C/D siblings ([engine.rs:14075](crates/snapback-engine/src/local/engine.rs:14075), [engine.rs:14277](crates/snapback-engine/src/local/engine.rs:14277)). The permit is deliberately dropped only before PUT/cleanup; the next SQLite phase reacquires a fresh reservation ([asset_routes.rs:282](crates/snapback-server/src/server/asset_routes.rs:282), [engine.rs:14615](crates/snapback-engine/src/local/engine.rs:14615)).
- Moved-witness revalidation is permit-free but read-only, and the route reserves again before returning to Phase C/D ([engine.rs:13881](crates/snapback-engine/src/local/engine.rs:13881), [asset_routes.rs:307](crates/snapback-server/src/server/asset_routes.rs:307)).
- Refusal-state writes do not commit before a terminal-first refusal: they use the phase’s existing reservation at the final cut, then return the error ([engine.rs:14143](crates/snapback-engine/src/local/engine.rs:14143), [engine.rs:14655](crates/snapback-engine/src/local/engine.rs:14655)). Generic guarded auth transactions likewise roll back if the final guard refuses ([auth.rs:1743](crates/snapback-kernel/src/storage/auth.rs:1743)).

Checked-in race matrices encode both orderings for the five non-push `860` families, all three push cuts, and all asset route families ([server tests:31569](crates/snapback-server/src/server/tests.rs:31569), [server tests:32195](crates/snapback-server/src/server/tests.rs:32195), [server tests:33211](crates/snapback-server/src/server/tests.rs:33211)). I did not execute them because the requested strict read-only posture excludes writing build artifacts.

I also verified watch creation rather than trusting the description: its extracted engine function has the same SHA-256 before `860c2c2fd` and at HEAD (`1fcd4d…084b`), and `storage/watches.rs` has the same whole-file SHA-256 (`92e53b…b19`). Current creation is still mode-only ([engine.rs:24344](crates/snapback-engine/src/local/engine.rs:24344)); it remains deliberately excluded.

## Revised closure set

| Closure block | Current state | Size delta |
|---|---|---|
| Remaining asset ticket | **Complete** | Removed. `261e595ad` closed inspect/HEAD lazy expiry, both width paths, finalize, guarded refusals, and cleanup receipts ([resolved ticket:57](issues/closed/20260821-asset-width-prework-and-lazy-expiry-unfenced.md:57)). |
| Nine in-flight mode-only sites | **Eight complete; watch creation deliberately excluded** | All non-excluded work in this block is gone. Watch creation remains behind its classifier, bounded HostPlan, bounded commit capsule, and off-writer DNS prerequisites ([watch decision:78](issues/20260822-watch-creation-fence-design-decision.md:78)). |
| Stream-attempt refactor and fences | **Entirely remains** | Larger/more precise than the original label: caller/mode/host provenance must be separated through R1–R4, and no stream fence may land before R4 ([stream design:28](issues/20260822-stream-attempt-refactor-design.md:28)). Current caller creation/start/settle/cancel still flows through unguarded all-dirty persistence and per-row autocommits ([server.rs:956](crates/snapback-server/src/server.rs:956), [server.rs:2372](crates/snapback-server/src/server.rs:2372), [server.rs:28173](crates/snapback-server/src/server.rs:28173), [settlement.rs:11](crates/snapback-kernel/src/storage/settlement.rs:11)). |
| Critical direct routes | **Detached nested mutation, grant/OAuth approval, and pending-effect approval remain** | Grant/OAuth grew: clock observation, grant creation, and code issuance need one atomic transaction. All three need the bounded commit capsule; detached actions require one reservation per nested mutation, not one per action ([critical design:10](issues/20260822-critical-direct-route-fence-design.md:10), [critical design:20](issues/20260822-critical-direct-route-fence-design.md:20)). |
| Watch management | **Remains** | Smaller than the asset migration, but resume is still a two-transaction transition/enqueue operation; renewal is one authority-replacing transaction ([disposition:32](issues/20260822-residual-findings-4-9-disposition.md:32)). |
| Denial/revocation | **Remains** | Larger than originally apparent and the riskiest remaining direct-route item: absorb clock writes and compose the caller reservation with the target service-terminal protocol ([disposition:43](issues/20260822-residual-findings-4-9-disposition.md:43), [disposition:200](issues/20260822-residual-findings-4-9-disposition.md:200)). |
| Approval-gated intent creation | **Remains conditionally** | Smaller: fence only when the actual prepared authority carries a caller publication; credential-free branches remain mode-only ([disposition:211](issues/20260822-residual-findings-4-9-disposition.md:211)). |
| Auxiliary issuance, non-asset lazy cleanup, standalone clocks | **Removed from active closure** | Shrunk to zero independent migrations by the accepted disposition; clocks attached to still-open approval/denial parents remain part of those parent fixes ([disposition:49](issues/20260822-residual-findings-4-9-disposition.md:49), [disposition:309](issues/20260822-residual-findings-4-9-disposition.md:309)). |

No files were modified.

Yes—the program is closer: it closed every remaining caller-backed asset SQLite cut and 8 of 9 previously in-flight mode-only sites, leaving six active ranked direct-route families plus the stream-attempt family, with watch creation deliberately excluded.
