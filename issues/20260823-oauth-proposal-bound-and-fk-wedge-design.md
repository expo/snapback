# Design: bound OAuth proposals and remove the pairing-parent FK wedge

Status: Partially implemented — cap landed; cascade and rebuild deferred
Created: 2026-08-23
Related: issues/20260822-oauth-proposal-pairing-sweep-fk-wedge.md (the defect),
issues/20260822-residual-findings-4-9-disposition.md (which wrongly accepted it),
issues/20260823-oauth-pairing-fk-wedge-deferred.md

> **Author ruling (2026-08-23):** land part A, the shared cap, alone. Defer
> parts B/C and the legacy table rebuild. The recommendation below is the
> design record that preceded this split, not a claim that the FK wedge is
> fixed.

## Why this needed a design rather than a patch

The defect was once **accepted as harmless bounded debris**. This design names the precise
reasoning error in that acceptance:

> it cited a real cap on a predicate the OAuth producer deliberately does not satisfy.

The pairing limit counts only unexpired rows with `consumed_at_ms IS NULL`
(`crates/snapback-kernel/src/storage/auth_grants.rs:225-237`); OAuth inserts its parent directly
with `consumed_at_ms = now` (`crates/snapback-kernel/src/storage/auth_integrations.rs:874-910`).
The cap is real, and it has never applied here.

## Reachability — narrower than feared, wider than the ticket says

**Not remotely reachable on a hosted deployment.** The OAuth facade requires a local deployment on
a loopback listener, Sessions auth mode, and an enabled OAuth manifest; hosted serving rejects the
whole family before handler execution. Proposal creation additionally requires a session bearer,
the grant-management session class, and a consenting principal that storage verifies is human.

So: no unauthenticated caller, no scoped token, no agent credential, no ordinary public API caller.
**But any ordinary authenticated human session qualifies** — no admin credential, ownership,
step-up, or privileged role. At 60 requests/minute (a process-memory bucket, lost on restart, keyed
by effective user after authority resolution), that is roughly 60 proposals per minute per user.

Rows are individually bounded (10-minute TTL, length checks, 64-name cap). **Nothing bounds
retained row count** — expiry is a timestamp, not a deletion.

## Blast radius: all three, and the ticket understates it

1. **Unbounded storage growth** — no durable per-user or per-app ceiling, and creation continues
   even after the sweep is wedged.
2. **A correctness wedge** — an expired proposal cannot be approved (pending approval rejects
   `expires_at_ms <= now`) and denial requires an unexpired pending row, so ordinary traffic never
   removes it.
3. **An authenticated local denial-of-service affecting every user.** The pairing sweep is global
   with no user predicate, so **one expired proposal from one user** fails pairing-code mint,
   pairing-code presentation, and the grant-request inbox **for every user and agent on the
   database**.

Two things the original ticket missed: pairing **presentation** is also blocked, and the lifecycle
radius is larger — any OAuth child, even unexpired or approved, can block paths that delete all
pairing parents, including agent-authority termination, application reset, and Sessions-to-dev
teardown.

That is a materially worse finding than the ticket recorded, which is why re-deriving the claims
rather than restating them was worth the round.

## 2. FK wedge mechanism

The child `_snapback_oauth_authorizations.request_id` references `_auth_pairing_requests.id` using `ON DELETE RESTRICT` (`crates/snapback-kernel/src/storage/auth_integrations.rs:52-74`). Every serving connection enables foreign keys (`crates/snapback-kernel/src/storage.rs:7261-7267`).

Shortest production sequence:

1. At time `t`, a valid human session sends one OAuth authorization GET.
2. Storage atomically inserts:

   - pairing parent: `expires_at_ms = t + 10m`, `consumed_at_ms = t`, `grant_id = NULL`;
   - OAuth child: `status = 'pending'`, same expiry.

   See `auth_integrations.rs:838-919`.

3. The caller does nothing until `now >= t + 10m`.
4. Any of the three pairing operations executes:

   ```sql
   DELETE FROM _auth_pairing_requests
   WHERE expires_at_ms <= ? AND grant_id IS NULL
   ```

5. SQLite observes the dependent OAuth child and immediately rejects deletion under `RESTRICT`. SQLite reverts the whole DELETE statement, not merely the blocked row. [SQLite’s foreign-key documentation](https://www.sqlite.org/foreignkeys.html) specifies this immediate `RESTRICT` behavior.
6. The enclosing auth transaction returns `Err` and rolls back (`crates/snapback-kernel/src/storage/auth.rs:1688-1724`).

The database retains the OAuth child, its pairing parent, and every other expired parent selected by that DELETE. Pairing presentation’s coalesced credential-use update is also rolled back. The separate authorization-clock observation performed before these transactions may remain advanced (`auth_grants.rs:217`, `:274`, `:617`), but it does not repair the wedge.

There is no ordinary self-healing path. A repository-wide search finds no production `DELETE FROM _snapback_oauth_authorizations`; disabling the OAuth surface drops the table (`auth_integrations.rs:228-242`), but continued OAuth, pairing, grant-inbox, reset, and restore traffic does not remove the child.

## 3. Fix

### Options

| Option | Benefit | Cost or defect |
|---|---|---|
| Call the current `mint_pairing_code` method | Superficially reuses the cap | Incorrect. It opens its own transaction, generates an unnecessary plaintext secret, cannot preserve atomic parent+OAuth-child creation, and its `consumed_at_ms IS NULL` predicate still does not count existing OAuth parents. |
| Add an OAuth-only count in `begin_oauth_authorization` | Smallest cap patch | Creates a second admission invariant at one caller. A future direct parent producer can omit it; normal and OAuth ceremonies can each consume their full independent budget. |
| Extract one capped pairing-request creation primitive | One mandatory runtime admission point for both producers | Requires defining shared cap semantics and modest storage-module refactoring. |
| Delete OAuth children before pairing parents | No schema migration; repairs the known sweep | Every destructive parent path must remember the order. Missing reset, restore, or a future path recreates the wedge. |
| Change the request FK to `ON DELETE CASCADE` | Makes parent-owned cleanup structural; fixes sweep, reset, restore, and user/agent cascades | Requires rebuilding the exact-shape companion table and confirming that OAuth rows have no independent retention requirement. |
| Skip referenced rows with `NOT EXISTS` | Restores pairing-path availability | Leaves permanent debris, does not fix reset/restore, and hides lifecycle inconsistency. Not an acceptable primary fix. |

### Recommendation

Land a single change set with three parts.

#### A. Centralize and broaden pairing admission

Extract a private storage-kernel primitive such as `create_pairing_request_on(tx, draft, now_ms)`. Both normal pairing mint and OAuth proposal creation must use it inside their existing transaction. Test-only fixture insertion and declared restore remain explicitly separate.

The primitive must:

1. run bounded expired-request cleanup;
2. count unresolved, unexpired ceremonies for the minting user;
3. refuse at ten without eviction;
4. insert the parent row.

Use this shared predicate:

```sql
minted_by_user_id = ?
AND expires_at_ms > ?
AND grant_id IS NULL
```

Do not retain the current `consumed_at_ms IS NULL` predicate as the shared admission definition. That column describes pairing-secret consumption, not whether a consent ceremony still occupies capacity. The new definition counts:

- unpresented pairing codes;
- presented but unresolved pairing requests;
- pending or denied OAuth proposals until expiry.

Approved requests have `grant_id IS NOT NULL` and leave the budget.

This intentionally changes ordinary pairing semantics from “ten unconsumed secrets” to “ten unresolved consent ceremonies per human.” It contains cross-agent and cross-client accumulation under one durable budget. SQLite’s `IMMEDIATE` auth transaction serializes count and insert (`crates/snapback-kernel/src/storage/auth.rs:1715-1724`), so there is no concurrent eleventh-row race.

Preserve the normal route’s existing `SNAPBACK_AUTH_PAIRING_CODE_CAP` diagnostic. Map the same private admission refusal on OAuth to `SNAPBACK_AUTH_PAIRING_REQUEST_CAP` or an OAuth-specific capacity diagnostic; the caller may translate it to `temporarily_unavailable`. The count must remain inside the shared primitive rather than being selected by either caller.

This is “inexpressible” at the production storage-API boundary, not at arbitrary same-crate raw SQL. A database trigger would enforce it absolutely, but attaching a trigger to the frozen `_auth_pairing_requests` catalog requires a new auth-catalog version and migration. That is disproportionate for this repair.

#### B. Make OAuth lifetime subordinate to its pairing parent

Change only the `request_id` FK to `ON DELETE CASCADE`. The pairing row is the ordinary grant-consent lineage; the OAuth row is facade state layered on it. LLP 0204 explicitly says the facade has no independent authority (`llp/0204-app-external-surfaces.rfc.md:684-695`), so child deletion when that lineage is destroyed is the correct ownership rule.

Keep the other OAuth FKs unchanged. In particular, do not cascade from a grant to OAuth: approved pairing parents are already excluded from expiry sweep by `grant_id IS NOT NULL`.

With CASCADE, the existing parent sweep, reset, restore, user deletion, or integration deletion cannot be blocked by the OAuth child. Explicit child-first cleanup may remain during migration, but runtime correctness must not depend on callers remembering it.

#### C. Bound cleanup work

Change the pairing sweep to delete at most `AUTH_GC_BATCH` rows ordered by `(expires_at_ms, id)`, following the existing 512-row auth-GC convention (`crates/snapback-kernel/src/storage/auth.rs:39`, `:1897-1966`). Add pairing cleanup to periodic auth GC and set `immediate_retry` when the batch fills. The lazy calls from mint, presentation, and inbox should invoke the same primitive.

This prevents a database already containing many proposals from turning the first post-fix request into an unbounded delete transaction.

No part of this change should alter `PreparedAuthority`, `effect_guard`, terminal fencing, or the authorized-effect program.

## 4. Migration and existing rows

Changing the FK changes the exact companion schema. `activate_manifest_in` currently creates-if-absent and then compares the catalog to a reference schema (`crates/snapback-kernel/src/storage/auth_integrations.rs:220-262`); merely changing the DDL constant would classify every existing OAuth-enabled database as corrupt.

Add an explicit companion-table migration before exact validation:

1. Recognize either the exact new CASCADE shape or the exact known legacy RESTRICT shape. Refuse every unknown shape.
2. For the legacy shape, in the existing schema-activation transaction:

   - rename the old OAuth table;
   - create the new exact table;
   - copy every column byte-for-byte;
   - drop the old table and recreate the expiry index;
   - run `foreign_key_check`;
   - run the existing exact-schema validation.

This repository already uses the same transactional rebuild pattern for capability links (`crates/snapback-kernel/src/storage/capability_links.rs:161-196`). OAuth activation already runs inside the serialized schema transaction (`crates/snapback-kernel/src/storage/auth_mode.rs:879-917`).

Existing rows:

- Expired ungranted rows become immediately deletable after migration and are removed by bounded GC or the next lazy sweep.
- Existing unexpired rows over ten are preserved. No consent is silently evicted. New creation is refused until enough rows resolve or expire; because proposal and pairing TTLs are ten minutes (`auth_integrations.rs:27`; `auth_grants.rs:23`), a normally timestamped excess drains naturally.
- Approved rows are preserved regardless of age because they carry a grant and remain installation-lineage evidence.
- Unknown, structurally inconsistent, or future-dated rows must fail migration with a typed corruption/repair diagnostic rather than being silently deleted.

The migration is correctness-safe online: it is one transactional schema activation and either publishes the complete new table or rolls back to the legacy table. It is not latency-free. A heavily inflated table must be copied while the writer is serialized. If field evidence shows millions of retained rows, reshape deployment into a code-only child-first cleanup landing followed by the schema rebuild after the table is reduced.

No core auth-catalog version bump is needed because this is the separately exact-validated OAuth companion table.

## 5. Tests and mutation analysis

Tests must be written first. Before production changes, run at least these two against the current code and retain the observed failures:

- an expired OAuth proposal makes pairing mint fail with an FK constraint;
- the eleventh OAuth proposal succeeds instead of returning capacity.

A green test first introduced alongside the fix is insufficient evidence.

| Test and named property | Shortest production mutation that could leave a weaker test green | Required discriminating form |
|---|---|---|
| **Red-first: expired OAuth proposal cannot wedge pairing mint.** | Delete the child explicitly only in mint; a mint-only test passes while presentation, inbox, and destructive paths remain wedged. | Use separate fixtures for mint, presentation, and inbox. Each fixture contains one expired OAuth pair plus unrelated valid work, and asserts both successful work and exact removal of the expired parent and child. |
| **Direct parent deletion cascades to OAuth child.** | A child-first sweep can make all lazy-sweep tests green while leaving `RESTRICT` in the schema. | Execute a raw parent DELETE with foreign keys enabled, assert the child disappears, and assert `PRAGMA foreign_key_list` reports `CASCADE`. Changing the FK to `RESTRICT`, `NO ACTION`, or disabling FKs must fail. |
| **The shared per-user budget is ten across both producers, with no eviction.** | An OAuth-only cap of ten passes an OAuth-only test while allowing ten normal requests plus ten OAuth proposals. A route throttle lowered to ten can also mimic a cap. | Call the storage kernel directly: create nine normal unresolved requests and one OAuth proposal, then require both another normal request and another OAuth proposal to return the exact capacity diagnostic. Snapshot all ten IDs and rows before/after to reject silent eviction. |
| **HTTP reachability and cap match production.** | Returning a cap-looking response after inserting the eleventh row leaves status-only assertions green. Removing session enforcement stays green in a valid-session-only fixture. | Assert unauthenticated and wrong-class requests create zero rows; ten valid session GETs create ten; the eleventh returns the exact storage-cap diagnostic; the durable parent and child counts remain ten. |
| **All destructive parent purges remain usable.** | Fixing only the lazy sweep leaves reset, Sessions→dev, and restore wedged. | Exercise reset, mode downgrade, and restore with a live OAuth proposal. Assert success, expected authorization termination, no OAuth/pairing rows, and preserved exact companion DDL where the operation promises it. |
| **Cleanup is bounded and converges.** | An unbounded DELETE passes a simple “all stale rows disappear” test and reintroduces long writer stalls. | Seed 513 expired OAuth pairs plus live and approved controls. First GC deletes exactly 512 and requests immediate retry; second deletes one; controls remain byte-identical. |
| **Legacy migration preserves data and activates the cap.** | Drop-and-recreate passes schema-shape assertions while losing live consent; trimming excess to ten can make a cap assertion pass. | Seed the exact legacy RESTRICT schema with expired rows, approved rows, and more than ten live unresolved rows. After activation assert byte-identical preservation of all live/approved rows, CASCADE schema, empty `foreign_key_check`, expired-row convergence, refusal while over cap, then admission after expiry. |
| **Migration is atomic under failure.** | A success-only migration test cannot detect a partial rename/copy/drop sequence. | Inject failure after rename and after copy. Each must leave the exact legacy schema and every row intact; a subsequent uninjected activation must succeed. |

Do not substitute source-text tests that search for a helper name. Removing the helper body, bypassing it with direct SQL, or returning early would leave such tests green. The tests above observe database state, exact diagnostics, real FK behavior, and divergent producer combinations.

## 6. Risks and reshape conditions

- **Shared-budget UX:** OAuth proposals can consume all ten slots and temporarily prevent ordinary pairing for that same user. This is intentional containment. If product requirements demand independent concurrency, retain the centralized creation primitive but use two explicit sub-budgets plus a shared aggregate ceiling.
- **Aggregate user count:** ten per user is not a global app bound. If real deployments permit attacker-created human accounts at scale, add a separate app-wide proposal budget; do not inflate the per-user cap to approximate one.
- **Cascade retention:** if OAuth authorization rows acquire an independent audit-retention requirement, CASCADE is no longer correct. Introduce a separate append-only audit record and keep operational proposal state subordinate to the pairing parent.
- **Migration size:** large retained tables can make the transactional rebuild slow. Pre-clean expired children and parents in bounded passes before rebuilding, or split emergency liveness and structural migration into two landings.
- **Unknown legacy shapes:** never infer compatibility from column presence alone. Unknown exact-schema state must refuse for repair.
- **Future raw-SQL producers:** if review finds runtime pairing-parent creation outside normal mint and OAuth begin, centralization is incomplete. Either route every producer through the primitive or escalate to a new catalog version with database-enforced admission.
- **Clock anomalies:** live rows whose expiry is implausibly far in the future will not drain naturally. Treat that as catalog corruption or an explicit operator-repair case; do not silently evict consent.

The approach should be reshaped only if OAuth rows have independent retention semantics, shared ten-slot capacity is product-incompatible, or existing table size makes the exact-schema rebuild operationally unsafe.

## 7. Implementation disposition (2026-08-23)

Part A is implemented: both production pairing-parent producers use one
transaction-local admission primitive counting unexpired rows with
`grant_id IS NULL`, and OAuth capacity maps to HTTP 429. The schema and sweep
are unchanged.

Parts B/C and the complete migration path are deferred. Two independent
reviews reproduced silent data loss in the proposed rebuild, first through an
uninventoried inbound foreign key and then through TEMP-first resolution in the
inbound-FK guard. The remaining blast radius and both reproductions are
recorded in `issues/20260823-oauth-pairing-fk-wedge-deferred.md`.
