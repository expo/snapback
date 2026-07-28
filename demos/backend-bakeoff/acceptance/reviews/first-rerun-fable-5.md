# Signal Desk first-rerun review — Fable 5

**Reviewer:** Claude Fable 5  
**Model selector:** `claude-fable-5`  
**Effort:** max  
**Date:** 2026-07-27  
**Reviewed revision:** `1d57f9dd31d2bc62fe9cbe5b2d1c330eb41159dc` (implementation evidence was primarily produced at `b1006fa2dfbda5ab2db1f74185189f60335ea160`)  
**Method:** fresh read-only review with `Read`, `Grep`, and `Glob`; `llp/reviews/` excluded  
**Disposition:** verbatim retained reviewer response

I have enough to render the review. I independently traced each audit item to the tree rather than taking the summary on faith; here is what holds up, what's overstated, and what must change.

## Verdict: NOT READY (for a second bakeoff, and for treating these profiles as publishable)

The first run left the Snapback arm materially incomplete (comparator arm failed on a stale binary; browser evidence honestly unclaimed), and independent inspection confirms two high-severity defects in security-relevant generated profiles plus a React-cleanup contract violation. None is an active exploit in the *shipped* demo declarations, but each breaks an invariant the LLPs and COMPARISON rely on. The good news: the capability manifest is honest (relation/activity and hosted profiles are correctly unadvertised), and the cold-install canary fix is sound.

## Verified material findings, ranked

**1. HIGH — `write-with-activity` does not bind the source row to the authorized scope.** LLP 0110 §2.1 requires that every non-scope row read/written by the plan carry `scopeForeignKey`/`scopeIncarnation` and be guarded to equal the selected scope. The codegen builds only a scope-owner guard (`packages/snapback-codegen/define.mjs:1853-1859`: `get(scope)`, `guard(scope.owner==authUserId)`, `…primary.steps`, `assertSourceChanged`, `insert(activity)`), and the runtime `AssertSourceChanged` step only checks that exactly one changed row matches `(table,id,operation)` (`src/storage.rs:3729-3767`) — never that the source belongs to the scope. So authority rests entirely on author-written guards. The demo is safe only by construction: `addTaskWithActivity` inserts `incidentId: arg('incidentId')` (same arg as scope), and `toggleTaskWithActivity` hand-writes the `task.incidentId == incidentId` guard (`functions.mjs:316-319`). A future declaration with an arg-supplied source id and no manual guard would let any owner of *any* scope patch/delete another scope's row. This is the exact handler-tier footgun the profile claims to eliminate; it must be closed before the profile is published or presented as an authorization primitive.

**2. HIGH — inline-handler admission misses computed member access (Function-constructor reach).** LLP 0108 §A says inline v1 "admits no … `eval`, `Function`." The extractor's forbidden-node scan only catches statically-named `eval`/`Function` calls and `new Function` (`packages/snapback-codegen/inline-handlers.mjs:200-213`) and reflection via `reflectionProblem`, which resolves member names only when they are static strings (`inline-handlers.mjs:129-149`, `214-219`). A computed access whose key is not a static literal — e.g. `({})[k][k]('return …')()` where `k` is a runtime-built `'constructor'` — is not flagged, reaching the `Function` constructor and defeating the static `ALLOWED_GLOBALS` allowlist. Whether this is a full sandbox escape depends on the Ibex/Hermes runtime containment, which I did not verify; `inline_handler_v1` is experimental and the benign demo never exercises it. Still a real gap in a security-admission control that the spec asserts is closed.

**3. MEDIUM-HIGH — React provider disposal calls an admin-only disconnect route.** LLP 0102 is explicit: "Provider/root unmount does not call an admin disconnect route." But `provider.dispose()` and the attach-deadline recovery both call `client.disconnect(connectionId)` (`packages/snapback-react/index.mjs:1689`, `:360`), and that method is an admin request — `#adminReq('POST', /_snapback/api/connections/{id}/disconnect)` (`packages/snapback-client/index.mjs:5186-5202`, whose own comment says "Admin teardown addresses the WIRE id"). In sessions/hosted deployments an ordinary React client lacks admin authority, so the call errors and is swallowed by `recordDiagnostic`; the "exact cleanup" in `react-query-group.v1.json` (`serverSubscriptions:0`) is actually carried by the manager-close/unsubscribe steps, masking a dead/erroring admin call. If it ever *succeeded* on a connection shared across roots/mounts (LLP 0102 allows both), it would tear down siblings. Remove it before leaning on React cleanup as evidence.

**4. LOW-MEDIUM — comparator receipts attest client-asserted identities, not minted principals.** The comparator kit records `observerIdentity`/`actorIdentity` straight from the caller-supplied `userId` strings (`packages/snapback-cli/comparator-profile.mjs:630-636`, fed from `identities.*` at `:576-577`, `:611-613`), with only a distinctness check (`:279`). In dev-impersonation these are asserted headers, so a receipt can claim "two independent identities" the server never authenticated as distinct principals. It's an evidence-integrity weakness in the kit (auth is explicitly out of scope for the app), but it over-attests, so the comparator kit shouldn't be cited as identity-separation proof.

**5. LOW — search `after: null` and loosely-tied options.** `SearchRequestV1.after` is `string?` (`packages/snapback-client/index.d.mts:157`) but the `search()` method admits `after?: string | null` (`:509`, `:518`), and its `options` are a hardcoded literal rather than `FunctionArgs<Ref>`, so a `null` the wire won't accept typechecks. Minor.

**6. LOW — bounded-children "one row" seal is by convention.** The per-row payload is a properly sealed discriminated union in both the generated type (`api.d.ts:130-132`) and the runtime `records(union(...))` contract with `allowExtra:false` and absent-variant `maxItems:0` (`functions.manifest.json:1303-1451`). But the *outer* result is `ReadonlyArray<…>`, not the one-element tuple LLP 0110 §1.3 requires, so cardinality (0 or many rows) isn't enforced. Minor.

**7. LOW — versioned-seed client surface returns `unknown`.** `ensureVersionedSeed`/`previewVersionedSeed`/`resetInstall…` return `Promise<unknown>` with loosely typed options (`index.d.mts:465-493`), so callers hand-walk untyped fields (`versioned-seed.mjs:11` `preview?.requested?.dataVersionStream`) despite LLP 0109 defining closed `SeedPreviewResultV1`/`SeedInstallReceiptV1` carriers. A DX/typing gap, not a safety one.

### Where the audit overstated or is already resolved

- **"Unbranded/unsound search typings"** is overstated: the generated ref binds a precise, branded page — `SearchPageV1<{commanderId:string,…}, Id<"incidents">>` (`api.d.ts:137`) — and the generated `FunctionReference` is structurally identical to the client's `SnapbackFunctionReference` (`api.d.ts:21-33` vs `index.d.mts:24-41`), so the first `search<Ref>` overload matches and `FunctionResult<Ref>` stays precise at the call site. The real residual is only finding #5.
- **"Cold-proof falsely matches public field names"** is fixed and now sound: a cryptorandom canary `snapback-cold-canary-<48 hex>` is injected as `SNAPBACK_ADMIN_TOKEN`/`VITE_SNAPBACK_ADMIN_TOKEN` at build and proven absent from built assets, requiring an unguessable ≥32-char value (`scripts/snapback-package-cold-install.mjs:643-676`; `…-lib.mjs:5-13`). Non-vacuous — a `VITE_`-prefixed token would normally inline into the bundle.
- **"Relation/activity capability publication bypass"** does not appear in the shipped manifest: `bounded_children_v1`/`write_activity_v1` are neither advertised nor matured (`capability.manifest.json:23-29`), consistent with LLP 0110's blocked-publication posture. The legitimate concern is that the demo *executes* these unadvertised Review-stage profiles (which LLP 0110 permits) while finding #1's scope hole is open — so the risk lives in #1, not in the manifest.
- **"Optional JSON result union bug"** I could not reproduce at this revision: the union disjointness classifier (`packages/snapback-contract/result-contract-validator.mjs:69-105`) and first-match runtime validation (`:330-339`) look sound. Either it predates b1006 or is overstated; it needs a named repro before it's actionable.

## Product/DX signals this run surfaced

- The whole point of the generated profiles is "authority as closed, inspectable data, not handler callbacks," yet `write-with-activity` still delegates the load-bearing scope check to hand-written guard steps. The builder should synthesize the scope-membership guard from the declared foreign-key/incarnation fields (as §2.1 specifies) so the inspectable ceiling is also the enforced one.
- The binary-identity mismatch the COMPARISON already flags (doctor reports healthy while the build fails to link, `COMPARISON.md:150-153`) is the same class as the comparator's `SNAPBACK_REQUEST_JSON_INVALID`: codegen emitted `registerGroupEligible` (`routes.manifest.json:24`) ahead of the selected binary. P0 items #3/#4 (exact runtime/link smoke test; first-class identity-mismatch message) are the right fixes and this run is fresh evidence they're mandatory, not cosmetic.
- Result-contract typing is now genuinely precise for search, bounded-children, and activity results end-to-end — a real improvement over the baseline "arbitrary results degrade." The remaining degradation is concentrated in untyped protocol surfaces (seed, `fetchBundle`, `ensureApp` all `unknown`).
- `full_text_search_v1` advertises `maturity:"stable"` (`capability.manifest.json:49`) while its result page depends on `result_contract_v1`, still `experimental` (`:26`). Worth reconciling — a stable capability resting on experimental machinery is an odd seam.

## Mandatory before a second bakeoff vs. legitimate follow-ups

Mandatory:

1. Enforce source/aux-row scope binding in `write-with-activity` (codegen-injected guard or runtime check), with a paired-store cross-scope refusal fixture. (#1)
2. Close the inline-handler computed-member gap — reject non-static computed member access and dynamic element keys, or prove runtime VM containment — before any `inline_handler_v1` advertisement. (#2)
3. Remove the admin `disconnect` call from React provider disposal/recovery; prove cleanup via reference-counted unsubscribe only. (#3)
4. Rebuild/select the binary that includes `registerGroupEligible`, then re-run the full three-backend matrix **including the Snapback comparator arm**, and only then let COMPARISON assert the revised ranking.

Legitimate follow-ups: comparator receipts should bind to server-echoed principals (#4); tighten `search after` typing and derive options from `FunctionArgs<Ref>` (#5); pin bounded-children outer cardinality to one row (#6); give the versioned-seed client its closed result types (#7); reconcile search stable-vs-experimental dependency.

## Overclaims to correct

- COMPARISON's "Post-improvement React receipt" (`COMPARISON.md:8-26`) is careful — it defers the final ranking to the full rerun and doesn't erase baseline disadvantages — but its "exact provider/client/server cleanup" claim is undercut by finding #3; the cleanup is not what the design specifies.
- The improvement-program ticket lists item 2 (`snapback dev` supervisor) as "Shipped" and its acceptance requires "one package-owned command proves the comparator properties" (`issues/20260727-…:88`). Given the comparator arm's failure at the recorded revision, that row is not yet satisfied and shouldn't be treated as closed.
- LLP 0110's "Implemented landing evidence" (§ dated 2026-07-27) states the profile proves "sealed authorization behavior" and passes `write_with_activity_source_assertion_is_atomic_and_replay_safe`. That test proves atomicity/replay/no-op refusal, **not** scope containment; the §2.1 relationship-proof is unimplemented (#1). The Review status and blocked publication are honest, but the "sealed authorization" phrasing overstates what the code enforces.
- Not an overclaim, but worth stating plainly: because the Snapback comparator arm failed and browser evidence is unclaimed, the run's Snapback ranking inputs are provisional. COMPARISON already says so; the tickets should mirror that rather than reading as if the improvement program's evidence bar is met.
