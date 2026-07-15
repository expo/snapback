**Reviewer family:** GPT (OpenAI Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, workdir = repo root, session id 019f62c8-ed33-7013-9d7c-7d7fb8f7a8cc; 435,195 tokens used. Orchestrated by the ENG-24996 cross-family review gate (LLP 0005 review loop via /llp-review).
**Date:** 2026-07-14
**Redacted:** no redaction applied — no secrets in the reviewed material; reviewer instructed not to read `.agent-local-secrets.md`, credential files, or `llp/reviews/`, and not to quote secret material. Sending repository content to OpenAI was authorized by the human-directed ENG-24996 review-gate assignment.
**Method:** cli-runner — fresh session, blind to all archived reviews. The brief identified the document as an implementation-derived Spec for landed code (LLP 0039 item 3 / ENG-24596) and directed the reviewer at spec-vs-code fidelity, internal consistency, cross-LLP consistency, security soundness, and reimplementability, with MATERIAL/MINOR/EDITORIAL severities.

# LLP 0057 reviews — GPT family

## Round 1 — 2026-07-14

**Reviewed:** `llp/0057-auth-provider-protocol.spec.md`, sha256 `2abcd3f1364697f301b5e1f0d57281a96d40b74d7b03a95c238657c83175ff74` (committed at repo HEAD `fdfdd94`).
**Verdict:** READY WITH REVISIONS

### Review body (verbatim)

## Overall assessment

This is a strong design and an unusually executable Spec. The catalog, cryptographic encodings, mailbox, capability separation, and backup/restore machinery largely match the implementation. However, its implementation-complete claims (`llp/0057-auth-provider-protocol.spec.md:45-47`, `llp/0057-auth-provider-protocol.spec.md:1342-1347`) are too strong: four security/correctness obligations materially diverge from shipped code, followed by several interoperability/documentation defects.

## Strengths

- The marked-catalog contract is rigorous: the DDL matches the implementation (`llp/0057-auth-provider-protocol.spec.md:243-346`; `src/storage/auth.rs:133-302`), and ready-catalog validation compares both SQL definitions and physical constraints (`src/storage/auth.rs:889-991`).

- The cryptographic protocol is precise and faithfully implemented: Unicode canonicalization (`src/auth/crypto.rs:68-100`), unbiased six-digit generation (`src/auth/crypto.rs:127-150`), length-prefixed HMAC with constant-time verification (`src/auth/crypto.rs:247-279`), and canonical bearer parsing/checksum validation (`src/auth/crypto.rs:398-456`).

- Request-code delivery has sound commit/publication ordering. Mailbox capacity is reserved before the transaction, unpublished reservations are RAII-cleaned, and plaintext becomes visible only after durable commit (`src/auth/provider.rs:1739-1843`; `src/auth/mailbox.rs:143-185`, `src/auth/mailbox.rs:288-349`).

- The independent impersonation carrier is a good security boundary. The implementation retains only a digest, compares in constant time, publishes through tightly constrained owner-only channels, and mechanically validates discovery paths (`src/admin_impersonation.rs:55-105`, `src/admin_impersonation.rs:124-153`, `src/admin_impersonation.rs:167-230`).

- Backup and restore are particularly well engineered: validated keyring bytes and SQLite state share one quiescence boundary, restored members are hash-checked and inode-pinned, and publication is commit-ambiguous after rename rather than destructively “cleaned up” (`llp/0057-auth-provider-protocol.spec.md:1027-1110`; `src/auth/backup.rs:74-160`, `src/auth/backup.rs:163-290`, `src/auth/backup.rs:621-650`, `src/auth/backup.rs:702-724`).

- The LLP 0045 handoff is clean: both documents prohibit plaintext codes from entering the durable outbox and delegate only the bounded process-local mechanics to LLP 0057 (`llp/0057-auth-provider-protocol.spec.md:19-22`; `llp/0045-notifications-outbox.rfc.md:21-29`, `llp/0045-notifications-outbox.rfc.md:76-80`).

## Concerns

1. **MATERIAL — Exact v1 table-name collisions can bypass stage-time classification.**

   LLP 0057 classifies an unmarked catalog as `Uninitialized` only when there is no reserved table or exact-v1 name conflict, and claims unrelated non-table objects cannot wedge creation except for exact index names (`llp/0057-auth-provider-protocol.spec.md:214-237`). The implementation checks only reserved objects whose kind is `table`, followed by names from `AUTH_INDEXES`, before returning `Uninitialized` (`src/storage/auth.rs:826-855`).

   Consequently, a view or foreign index named `_auth_users` matches neither check, but activation subsequently executes `CREATE TABLE "_auth_users"` (`src/storage/auth.rs:715-729`). This misses frozen LLP 0039’s stage-time fast-fail guarantee and LLP 0058’s pre-effect collision check (`llp/0039-auth-vertical-slice.rfc.md:392-405`; `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:321-337`). It also lacks the documented typed offline-repair classification (`llp/0057-auth-provider-protocol.spec.md:965-970`).

   *Resolves with:* classify every schema-object name capable of blocking each exact v1 `CREATE`, add typed stage/consume diagnostics, and test views and foreign indexes occupying every table/index name across case variants.

2. **MATERIAL — Refresh allows unbounded tombstone and database growth.**

   Seven days is only a client cadence (`llp/0057-auth-provider-protocol.spec.md:99-105`). Every current live bearer rotates, and each rotation inserts another durable predecessor tombstone (`llp/0057-auth-provider-protocol.spec.md:617-625`, `llp/0057-auth-provider-protocol.spec.md:631-639`). Shipped planning likewise rotates any live current bearer without checking age, rate, or family size (`src/auth/provider.rs:1148-1177`), and commit adds one row (`src/auth/provider.rs:2547-2580`).

   Tombstones survive until the parent session’s 90-day absolute expiry (`llp/0057-auth-provider-protocol.spec.md:393-404`; `src/storage/auth.rs:466-515`). A valid credential holder can therefore refresh the newest bearer repeatedly and grow SQLite at request throughput. Frozen LLP 0039 itself notes that tombstone growth is otherwise unbounded, but assigns the mitigation only to client behavior (`llp/0039-auth-vertical-slice.rfc.md:779-804`).

   *Resolves with:* pin a server-enforced refresh-age/rate bound and a hard family-growth policy. Reaching the hard bound should revoke or force reauthentication rather than discard attribution needed for reuse detection.

3. **MATERIAL — The production family-alarm path does not satisfy its opacity proof.**

   The Spec requires tombstone-only lookup, one fixed transaction/statement shape, and no unpadded family-state path (`llp/0057-auth-provider-protocol.spec.md:661-674`). Production planning instead uses the common current-first resolver (`src/auth/provider.rs:1203-1222`): current tokens return after querying `_auth_sessions`, while misses additionally query `_auth_session_tokens` (`src/auth/provider.rs:2131-2185`).

   The writer also returns immediately after a successful update but performs another `SELECT` after a zero-row update (`src/auth/provider.rs:2362-2429`). The 20–25 ms deadline starts before this work, and the handler merely sleeps until that deadline (`src/auth/provider.rs:1210-1221`; `src/server.rs:6810-6815`). Under slow or contended storage, the minimum delay does not equalize those paths. Acceptance explicitly avoids instrumented statement-count equivalence (`llp/0057-auth-provider-protocol.spec.md:1249-1252`), leaving frozen LLP 0039’s “leaks no family state” obligation unproved (`llp/0039-auth-vertical-slice.rfc.md:1607-1610`).

   *Resolves with:* use a tombstone-only, statement-trace-invariant production path or define a defensible fixed-total publication bucket that remains opaque under contention. Add production-path SQL instrumentation and delayed-storage tests.

4. **MATERIAL — Secret lifetime and zeroization claims exceed shipped behavior.**

   The Spec says secret-bearing Rust values are non-cloneable and their owned buffers zeroize after use (`llp/0057-auth-provider-protocol.spec.md:186-188`, `llp/0057-auth-provider-protocol.spec.md:581-582`). Although `SecretInput` itself is zeroizing (`src/auth/wire.rs:60-87`), exchange converts its code to an ordinary `String` and repeatedly clones it (`src/server.rs:6222-6248`, `src/server.rs:6268-6284`, `src/server.rs:6439-6469`). Refresh, logout, and family-alarm similarly copy bearer plaintext into ordinary strings (`src/server.rs:6511-6518`, `src/server.rs:6607-6614`, `src/server.rs:6699-6710`).

   Session-token digests, which the Spec classifies as secret (`llp/0057-auth-provider-protocol.spec.md:1151-1155`), also appear in cloneable projection rows, while `TokenDigest` is `Clone + Copy` without zeroization (`src/auth/session_projection.rs:107-185`).

   *Resolves with:* carry zeroizing secret wrappers through async/blocking boundaries and define bounded ownership for internal digests. If digest zeroization is intentionally excluded, narrow the normative claim explicitly; plaintext code/bearer copies should still be removed.

5. **MINOR — The credential-response example omits a required field.**

   The exchange/refresh example omits `authorityDescriptor` (`llp/0057-auth-provider-protocol.spec.md:805-818`), despite acknowledging that item 7 now projects it (`llp/0057-auth-provider-protocol.spec.md:73-76`). Shipped serialization and the committed schema require the field (`src/auth/wire.rs:136-153`, `src/auth/wire.rs:176-187`; `schemas/auth.credential.output.schema.json:80-105`), as does frozen LLP 0039 for login and refresh (`llp/0039-auth-vertical-slice.rfc.md:1299-1303`).

   *Resolves with:* add the exact three-field `authorityDescriptor` object to the composed response example while retaining the nested session’s deliberate omission.

6. **MINOR — The asserted request-header bound is not a pinned protocol control.**

   The constants table specifies only the 4 KiB body limit, while the security section asserts that both body and header limits run before parsing (`llp/0057-auth-provider-protocol.spec.md:86-110`, `llp/0057-auth-provider-protocol.spec.md:1163-1166`). Auth routes explicitly install and recheck the body limit (`src/server.rs:3703-3766`, `src/server.rs:6372-6394`), but startup uses plain `axum::serve` without a Snapback-owned header limit (`src/cli.rs:1848-1850`). Any effective bound is therefore an unpinned, dependency- and HTTP-version-dependent transport default.

   *Resolves with:* specify header byte/count accounting, configure it explicitly, and add over-limit tests—or narrow the claim to a named, versioned transport dependency.

7. **MINOR — The future logical-import contract omits mandatory incarnation rotation.**

   LLP 0057 calls its export/import bullets a pinned future contract but says only that import uses an empty catalog, rejects collisions, and imports no sessions (`llp/0057-auth-provider-protocol.spec.md:383-391`). Frozen LLP 0039 requires authorization-stream incarnation regeneration on logical import, Accepted LLP 0053 consumes that rule, and sibling LLP 0059 requires the new incarnation in the same destructive transaction (`llp/0039-auth-vertical-slice.rfc.md:1152-1169`; `llp/0053-authorization-invalidation.rfc.md:583-600`; `llp/0059-session-projection-and-client-barrier.spec.md:195-214`, `llp/0059-session-projection-and-client-barrier.spec.md:994-1014`).

   *Resolves with:* add the delegated same-transaction incarnation rotation to the future import contract and list LLP 0059 as Related.

8. **MINOR — The canonical-address contract is internally misstated and Unicode-version-underspecified.**

   The protocol specifies NFC plus Unicode default lowercase but does not pin a Unicode data version (`llp/0057-auth-provider-protocol.spec.md:490-500`). Code delegates this to `unicode-normalization` and Rust’s lowercase tables (`src/auth/crypto.rs:68-99`), while acceptance supplies selected vectors rather than a complete versioned conformance corpus (`llp/0057-auth-provider-protocol.spec.md:1188-1192`). Independent implementations or runtime upgrades can therefore split durable identities.

   Separately, the security section says canonical addresses appear only in identity rows and mailbox responses (`llp/0057-auth-provider-protocol.spec.md:1157-1161`), but the pinned DDL stores them in verification-code rows (`llp/0057-auth-provider-protocol.spec.md:317-345`).

   *Resolves with:* pin the Unicode version and conformance dataset, and change the storage wording to include protected challenge rows and the explicitly authorized future logical-export surface.

## Suggestions

- Generate every normative JSON example from, or validate it against, the committed schemas. That would have caught the missing descriptor immediately.

- Add a committed closed output schema for `CollisionRescueResult`, whose six-field wire shape currently exists only in Rust and prose (`src/auth/rescue.rs:14-23`; `llp/0057-auth-provider-protocol.spec.md:850-856`).

- Qualify the diagnostics table as item-3-owned and link LLP 0059’s composed projection failures; current routes can emit `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` and `SNAPBACK_AUTH_REVOCATION_UNCERTAIN` (`src/server.rs:6229-6235`, `src/server.rs:6743-6752`).

- Narrow “secret-bearing types do not implement serialization” to primitive wrappers and explicitly name the hand-written closed DTO release seams (`src/auth/wire.rs:176-187`, `src/auth/wire.rs:258-268`). Likewise, narrow collision-candidate zeroization to secret candidate material unless identifiers will also become zeroizing.

- Add LLP 0058, 0059, and 0060 to Related; the document’s current-composed behavior already relies on their later-item seams (`llp/0057-auth-provider-protocol.spec.md:66-77`).

## Open questions

- What server-side refresh policy gives a hard storage bound without erasing predecessor attribution: minimum token age, token-bucket admission, a family cap with forced reauthentication, or a combination?

- Does “leaks no family state” require indistinguishability when SQLite work exceeds 20 ms? If so, what production timing envelope and measurement methodology are normative?

- Is zeroization intended for every plaintext copy and in-memory digest, or only for designated wrapper-owned buffers? The current wording and implementation imply different answers.

- Which preexisting schema-object collisions should be eligible for online rescue, and which should receive a typed offline-repair diagnostic?

## Readiness verdict

READY WITH REVISIONS — the architecture is sound and most mechanisms are faithfully implemented, but the catalog-collision gap, unbounded refresh amplification, family-alarm opacity mismatch, and false secret-lifetime claims require explicit tracked implementation work. The MINOR protocol and cross-LLP defects should be corrected before ratification.
## Round 2 — 2026-07-14

**Revision under review:** `llp/0057-auth-provider-protocol.spec.md`, sha256 `c87b3e3836a3086581c36f7da93296625450313a29af84959ee16a0a4bd96d8b` (committed at repo HEAD `b11a6fa`)
**Runtime detail:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, session id 019f637b-ed6e-7482-baa1-e4186e74720a; 404,608 tokens used; fresh session, blind to all archived reviews and to the concurrent Fable-family round; orchestrated by /llp-super-refine
**Verdict:** NOT READY

### Review body (verbatim)

# 1. Overall assessment

The core proposal is a good idea: protected auth state, explicit credential-family semantics, independent impersonation authority, and database-plus-keyring lifecycle rules are substantially safer than ad hoc authentication. The document is unusually precise and test-oriented.

It is not ready, however. LLP 0057 currently serves simultaneously as the historical item-3 contract and the composed current protocol after LLPs 0058 and 0059. Those layers have diverged. Source inspection also found several load-bearing claims that production code does not satisfy, including token-collision handling, family-alarm isolation, rescue correctness, artifact publication, and restore timing.

The architecture should be retained, but the specification needs a focused reconciliation pass and additional production-path tests before ratification.

# 2. Strengths — with section citations

- **Closed catalog recognition.** `§Reserved namespace and catalog recognition`, `§Catalog version 1`, and `§Activation ordering` clearly distinguish uninitialized, ready, unsupported, corrupt, and colliding states. Exact DDL recognition and fail-closed activation are appropriate for protected authority data.

- **Sound cryptographic framing.** `§Length-prefixed code digest`, `§Session bearer and at-rest digest`, and `§Keyring protocol` specify canonical encodings, domain separation, bounded parsing, at-rest digests, and owner-only key material with unusually good precision.

- **Strong session-family model.** `§Session creation and cap`, `§Rotation`, and `§Logout, ordinary supersession, and family alarm` define the intended current-token/tombstone relationship, generation changes, grace behavior, and destructive alarm semantics clearly.

- **Good capability separation.** `§ImpersonationCapability carrier` sharply separates ordinary administrative authority, secret-read leases, session credentials, raw key material, and the per-boot impersonation bearer. This is the right security shape.

- **Thoughtful operator lifecycle.** `§Collision rescue` and `§Physical backup and declared restore` treat rescue, backup, and restore as explicit operator protocols rather than incidental file copying. The quiescence boundary and restore declaration are valuable designs even though some implementation details need correction.

- **Excellent acceptance ambition.** `§Session generated interleavings`, `§Credential non-substitution`, and `§Rescue, backup, restore, and hygiene` correctly emphasize generated traces, adversarial carrier crossing, failure injection, and schema drift rather than relying on happy-path examples.

# 3. Concerns

1. **MATERIAL — Session-bearer uniqueness and the specified collision retry are not implemented in production.**

   `§Randomness and identifiers` requires up to three complete candidates for observable uniqueness collisions (`LLP 0057:133-137`). Production issuance inserts directly into `_auth_sessions` without checking `_auth_session_tokens` (`src/auth/provider.rs:3327-3388, 3642-3659`). Since resolution checks current sessions before tombstones (`src/auth/provider.rs:2162-2175`), a bearer digest duplicated across those tables would make an old bearer authenticate as the new session. Rotation does check both tables (`src/auth/provider.rs:2593-2600`), demonstrating the intended invariant.

   Coordinated mint and refresh loops retry only `PredecessorChanged`; a constraint collision is propagated as a rollback/error on its first occurrence (`src/auth/coordinator.rs:692-712`; `src/server.rs:6377-6412, 6707-6749`). It can also expose the internal collision diagnostic rather than returning provider-unavailable after the third candidate.

   **Resolution criterion:** Enforce token-digest uniqueness across current and tombstoned credentials in the same transaction, carry an explicit retryable-collision outcome through the coordinator, zeroize each rejected candidate, and test first- and third-collision behavior through production HTTP and host-operation paths.

2. **MATERIAL — Family alarm can act on malformed input and does not implement its tombstone-only, fixed-shape protocol.**

   `§Logout, ordinary supersession, and family alarm` requires tombstone-only lookup, a dummy digest for malformed input, one fixed lookup/update shape, and no revocation not attributable to the presented tombstone (`LLP 0057:668-681`).

   Production substitutes a randomly generated dummy token hash for malformed input and then performs normal current-first/tombstone-second resolution (`src/auth/provider.rs:790-809, 1234-1275, 2162-2227`). It does not require parsing to have succeeded before marking a live tombstone actionable. If the dummy hash collides with a retained tombstone, malformed input revokes that unrelated family. The successful-update and no-op paths also execute different query sequences (`src/auth/provider.rs:2399-2460`), contradicting the fixed-statement opacity claim.

   **Resolution criterion:** Make malformed input semantically incapable of becoming actionable regardless of digest equality, use a tombstone-only fixed transaction path for every input, and add deterministic dummy-collision plus instrumented statement-shape tests.

3. **MATERIAL — Commit-ambiguity policy is contradictory across LLP 0057, LLP 0059, and the implementation.**

   `§Concurrency, locks, and linearization` says an uncertain commit discards plaintext successor/code state and reports unavailable (`LLP 0057:1179-1183`). LLP 0059 instead rereads durable rows and finalizes an exact successor (`LLP 0059 §Rollback and ambiguous commit:428-438`). Production follows LLP 0059: issuance and rotation convert an exact durable successor into a committed result (`src/auth/provider.rs:1351-1387, 3390-3447`), after which the coordinator can return the retained plaintext credential (`src/auth/coordinator.rs:692-768`).

   **Resolution criterion:** Choose one normative policy. If exact-successor reconciliation permits response publication, say explicitly that ambiguity has been resolved and that only the exact retained candidate may be returned, never retried. Otherwise destroy the candidate and report unavailable. Align both LLPs, code, and fault tests.

4. **MATERIAL — Collision rescue is incompatible with LLP 0058’s four-key mode state.**

   LLP 0057’s recovery and transactional algorithm can rewrite a stored manifest (`§Reachability`; `§Transactional algorithm`). LLP 0058 makes `schema_manifest_capability_aware` and `auth_mode_state_v1` part of a cross-validated four-key state and refuses any mismatch without repair (`LLP 0058 §The four keys:374-395`; `§Corrupt-state boundary:503-515`).

   Rescue reads and rewrites only legacy `schema_manifest` (`src/storage/auth_rescue.rs:246-256, 694-759`). Its tests deliberately delete the newer keys (`src/storage/auth_rescue.rs:847-861`). On a managed pre-sessions database, rescue can therefore make legacy and capability-aware manifests differ, which the next open rejects (`src/storage/auth_mode.rs:1232-1239`). Sessions-era poison and staged/quarantined states are also undefined.

   **Resolution criterion:** Specify rescue eligibility for every settled, pending, quarantined, dev, and sessions state, then atomically update every authoritative manifest/identity record or explicitly refuse managed snapshots with a stable offline-repair diagnostic. Add composed reopen tests.

5. **MATERIAL — Rescue does not preserve observable SQLite row identity and AUTOINCREMENT history.**

   The equality proof in `§Transactional algorithm` covers only named column values and multiplicities (`LLP 0057:1002-1011`). The implementation likewise copies and compares only named columns (`src/storage/auth_rescue.rs:267-307, 650-691`).

   Consequently, sparse implicit rowids such as `1, 99` can become `1, 2`. More seriously, an AUTOINCREMENT table whose `sqlite_sequence` high-water mark exceeds its current maximum loses that history, allowing a previously issued identifier to be reused. Both are observable table semantics.

   **Resolution criterion:** Preserve and verify implicit `rowid` and `sqlite_sequence` state, or reject every source shape for which they matter. Add sparse-rowid, deleted-high-water, and reopen tests.

6. **MATERIAL — Some collisions admitted by the recovery posture cannot be named by the rescue operation.**

   LLP 0057 accepts an actual physical source whose case-folded name is auth-reserved and requires only the target to be a valid nonreserved identifier (`LLP 0057:984-987`). Catalog reservation recognizes any name equal to `_auth` or beginning with `_auth_` (`src/storage.rs:5575-5583`), including quoted names containing spaces or non-ASCII suffixes.

   Rescue additionally requires the source to satisfy the ASCII application-identifier grammar (`src/auth/rescue.rs:49-69`; `src/storage/auth_rescue.rs:381-392`). A table such as `"_auth_old table"` can therefore trigger collision handling while being impossible to pass to the only recovery verb.

   **Resolution criterion:** Accept any exact, bounded, NUL-free physical SQLite source name while retaining strict target grammar, or identify sources using an opaque collision identifier. Otherwise do not expose a recovery router for unsupported names.

7. **MATERIAL — Rescue does not reconcile an uncertain destructive commit.**

   LLP 0057 says every error rolls back rescue and separately establishes conservative commit-ambiguity handling (`LLP 0057:1030-1033, 1179-1183`). Rescue nevertheless ends with an unclassified `transaction.commit()?` (`src/storage/auth_rescue.rs:211-220`). Its fault tests stop before the commit boundary.

   A commit error can therefore be reported after the target creation, manifest rewrite, and source drop became durable, with no reopening or result reconciliation.

   **Resolution criterion:** Classify commit uncertainty explicitly and reopen/reconcile the exact source, target, indexes, and manifest state. Exact predecessor may report failure, exact successor may report committed success, and any other state must enter a terminal recovery posture. Inject faults at the commit boundary.

8. **MATERIAL — Backup publication promises mutually exclusive outcomes and overstates inode-conditional rename.**

   `§Consistent backup` says a swap in either the pre- or post-rename window “publishes nothing,” then immediately says a post-rename refusal is commit-ambiguous and deliberately non-destructive (`LLP 0057:1081-1093`).

   Production correctly models the latter: after rename, cleanup is suppressed and postchecks can return an error while a complete unit survives (`src/auth/backup.rs:1039-1075`). The test at `src/auth/backup.rs:2178-2220` demonstrates exactly that. Moreover, `renameatx_np`/`renameat2` receives a source name, not an expected inode (`src/secure_file.rs:563-621`); the identity check and rename are separate operations.

   **Resolution criterion:** Reserve “publishes nothing” for proven pre-rename failure. Define explicit unpublished, published, and commit-ambiguous outcomes for backup and restore, including how an operator validates or cleans up a surviving artifact.

9. **MATERIAL — Restore validates the staged database through replaceable pathnames rather than its retained descriptor.**

   `§Restore` presents the staged unit as descriptor-pinned and fail-closed (`LLP 0057:1103-1117`). The implementation retains the staged inode identity but reopens its pathname for hashing, catalog validation, and retained-key inspection (`src/auth/backup.rs:233-256`; `src/storage/auth.rs:732-748`). Final publication only revalidates identity (`src/auth/backup.rs:629-650`).

   Under the document’s path-swap threat model, a process can temporarily substitute a benign ReadyV1 database for catalog inspection, then restore the original hash-matching but unvalidated inode before final identity validation.

   **Resolution criterion:** Hash and inspect the database through the same retained descriptor, with a descriptor-backed SQLite connection, and make the final validated content identity part of publication. Alternatively, narrow the threat model explicitly if same-UID path/content mutation is out of scope.

10. **MATERIAL — Declared restore bypasses the durable clock floor and can fail on a valid backup.**

   Restore sets every live session’s `revoked_at_ms` to `now` (`LLP 0057:1125-1133`), while the catalog requires `created_at_ms <= revoked_at_ms` (`LLP 0057:292`). LLP 0059 requires every provider, challenge, and session lifetime decision to use the durable floored epoch (`LLP 0059 §Durable session clock floor:321-360`).

   Startup passes raw `SystemTime::now()` into restore before the coordinator seeds that floor (`src/cli.rs:1471-1483`; `src/auth/runtime.rs:261-274`). The update at `src/storage/auth.rs:624-629` can therefore violate the DDL check when restoring a future-dated backup or after wall-clock rollback.

   **Resolution criterion:** Derive restore time from the durable floor and relevant catalog timestamps before revocation, advance the floor atomically with restore, and test backward-clock and future-created-session backups.

11. **MATERIAL — The specified no-ready-file impersonation attachment path does not exist.**

   `§ImpersonationCapability carrier` says the server prints the bearer once to the controlling terminal and a later CLI accepts it through interactive/stdin secret input (`LLP 0057:748-752`). Emission exists (`src/cli.rs:778-809`), but `TargetArgs` has no secret-input carrier (`src/cli.rs:531-542`), and a URL target always resolves to no impersonation capability (`src/cli.rs:850-862`).

   **Resolution criterion:** Implement a no-echo terminal or explicit stdin-secret intake, scoped only to registered impersonation operations and never argv/environment, with redaction tests. Otherwise remove the fallback and require a ready file.

12. **MATERIAL — LLP 0057 and LLP 0059 specify incompatible composed lock rules.**

   LLP 0057 requires maintenance/address coordination to span provider planning, the SQLite transaction, and mailbox cleanup (`LLP 0057:566-570, 1150-1164`). LLP 0059 says to release every database/provider guard before projection Begin and unconditionally prohibits projection locks overlapping provider/catalog locks (`LLP 0059:386-403, 519-534`).

   Production retains maintenance and address guards (`src/auth/provider.rs:962-980, 1021-1025, 1536-1568`) while acquiring topology during `premark_issuance` (`src/server.rs:6364-6405`; `src/auth/coordinator.rs:416-458`). Reset similarly holds exclusive maintenance before topology premark (`src/server.rs:9471-9475`; `src/auth/coordinator.rs:467-480`).

   **Resolution criterion:** Publish one composed lock graph that classifies maintenance, address, keyring, database, topology, stream, and session guards. Either justify explicit exceptions in LLP 0059 or restructure the implementation. Add reset/backup/provider race and deadlock tests.

13. **MATERIAL — `auth.mintSession` has incompatible governing wire contracts.**

   LLP 0057 requires the top-level `authorityDescriptor` on composed credential responses and says `auth.mintSession` returns that same data (`LLP 0057:808-848, 860-861`). Current serialization does so (`src/auth/wire.rs:136-187`; `src/server.rs:9079-9087`). LLP 0024’s exact host-operation row instead requires only the four earlier fields and explicitly excludes an authority-instance id (`LLP 0024:120-135`).

   **Resolution criterion:** Establish one canonical host-operation fixture and revise LLP 0024 or LLP 0057 accordingly. If the current shape wins, clarify that the nested session omits the authority id while the top-level descriptor is required.

14. **MINOR — Mailbox publication is not infallible after commit except for process termination.**

   `§Request-code transaction` calls post-commit publication infallible and process death the only cross-resource residual (`LLP 0057:536-545`). The reservation deadline is fixed before database work (`src/auth/provider.rs:1760-1801`), while `publish` prunes expired reservations and may fail (`src/auth/mailbox.rs:302-323`). A process suspension longer than the challenge TTL can therefore commit an active challenge and then lose its plaintext without terminating.

   **Resolution criterion:** Preserve a valid reservation through the commit/publication critical section, recheck before commit, or document and test this safe-but-unavailable residual.

15. **MINOR — Generated schemas omit the normative JavaScript-safe timestamp maximum.**

   LLP 0057 limits durable and wire timestamps to `9_007_199_254_740_991` (`LLP 0057:81-84`). Generated credential schema fields such as `createdAt`, `expiresAt`, `absoluteExpiresAt`, and `refreshAfter` have only a lower bound (`schemas/auth.credential.output.schema.json:37-53, 84-87`), even though `sessionGeneration` correctly has the upper bound.

   **Resolution criterion:** Use a shared bounded timestamp schema/newtype or explicit schemars annotations, and add negative fixtures above the JavaScript-safe maximum.

# 4. Suggestions

- Split LLP 0057 into a stable item-3 core and a short composed-protocol addendum that explicitly imports LLPs 0058 and 0059. Add a precedence table naming the authority for catalog, mode state, time, projection, routes, and wire DTOs.

- Replace the two-table token namespace with one globally unique token registry containing current/superseded state. That would enforce uniqueness structurally and make family-alarm’s tombstone-only lookup naturally fixed-shape.

- Consider implementing collision rescue with SQLite’s transactional table rename after strict dependency checks, followed by manifest reconciliation. This could preserve rowids and sequence state without a lossy copy/equality protocol.

- Represent backup/restore publication as an explicit state machine: `Unpublished`, `Published`, or `CommitAmbiguous`. Provide an inspection/reconciliation command rather than returning an undifferentiated error after rename.

- Build a normative conformance ledger mapping every MUST to a production entry point and test. Collision, commit, and coordinator tests should exercise the real HTTP/host-operation path rather than only test-only provider helpers.

- State the local filesystem adversary model precisely. Descriptor pinning prevents some path substitution, but it does not by itself prevent a process with the same effective UID from mutating an already-open inode.

# 5. Open questions

1. Must a bearer digest be globally unique across current and tombstoned credentials, and should SQLite enforce that structurally?

2. After exact-successor reconciliation of an uncertain commit, may the retained plaintext credential be returned, or must it always be destroyed?

3. Which LLP is authoritative for the composed lock graph and credential response wire shape?

4. Which LLP 0058 mode states may collision rescue mutate, and what happens to staged deployment identities?

5. Is collision rescue intended to preserve implicit rowids and AUTOINCREMENT history, or should those schemas be refused?

6. Is family-alarm opacity a fixed response envelope only, or a fixed database statement/query footprint as currently written?

7. Is a same-UID concurrent filesystem process within the backup/restore threat model?

8. Is the terminal-only impersonation carrier a supported product path, and is `--as-role` implemented or merely reserved?

9. Must declared restore advance the durable clock floor in the same transaction as revocation?

# 6. Readiness verdict

Not ready. The proposal’s direction is strong, but unresolved MATERIAL issues remain in credential uniqueness, family-alarm safety, commit semantics, rescue correctness, artifact publication, restore behavior, impersonation reachability, locking, and wire-contract coherence.

READINESS VERDICT: NOT READY

### Orchestrator disposition (round 2, outside the verbatim body)

Spot-checks verified against `b11a6fa`: issuance inserts into `_auth_sessions`
without the tombstone existence check while rotation performs the cross-table
`EXISTS(...) OR EXISTS(...)` (src/auth/provider.rs:2593-2600, 3642-3665);
resolution is current-before-tombstone (2162-2178); the malformed-input dummy
hash path (790-809); restore passes raw `SystemTime::now()` floored only to the
JS max (src/cli.rs:1471-1483); `TargetArgs` carries no stdin secret
(src/cli.rs:531-542); 0024's mintSession row excludes the authority-instance id
from the flat session (llp/0024:132); 0059's exact-successor ambiguous-commit
rule (llp/0059:428-438).

Disposition (round-2 revision): #3 (commit ambiguity) and #12 (composed locks)
→ §Concurrency reconciled to LLP 0059 as authoritative; #13 (mintSession wire)
→ §Public provider DTOs precedence paragraph; #1 (token uniqueness), #11
(impersonation stdin), #4/#5/#6/#7 (rescue four-key/rowid/name/commit) → pinned
as behavior with named defect obligations and acceptance rows (spec-vs-code
gaps, not design changes); #2 (family-alarm malformed) → parsed-ok predicate
gate; #8 (backup publishes-nothing) → three-outcome naming; #9 (restore
descriptor) → descriptor-bound inspection; #10 (restore clock floor) → floored
restore time; #14/#15 (mailbox reservation residual, timestamp schema bound) →
timestamp bound pinned, reservation residual left as documented safe-unavailable
residual. Suggestion to split the document into item-3 core + composed addendum
is left to the author (altitude was ratified 2026-07-12 for the umbrella).

## Round 3 — 2026-07-14

**Revision under review:** `llp/0057-auth-provider-protocol.spec.md`, sha256 `f11f3595556f33f6e0547a935cdd0635106c79a64e46d6726b6f40737b4e778f` (round-2 working-tree revision; repo HEAD `b11a6fa`)
**Runtime detail:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, session id (round 3); 353,360 tokens used; fresh session, blind to all archived reviews and to the concurrent Fable-family round; orchestrated by /llp-super-refine
**Verdict:** NOT READY

### Review body (verbatim)

# 1. Overall assessment

LLP 0057 has a strong protocol core and is directionally a good idea. It is unusually explicit about authority boundaries, durable state, credential secrecy, crash ambiguity, and acceptance evidence.

It is not ready in its current form. The document simultaneously presents itself as the frozen v1 contract, the description of the current implementation, and the acceptance authority for an implementation that has since moved to catalog v2. Those roles now conflict. Repository inspection confirms several acknowledged conformance gaps and exposes additional safety and coherence failures, including unsafe v2 restore composition, ambiguous-publication cleanup, pathname-based restore inspection, malformed family-alarm actionability, and a keyring durability hole in the normative design itself.

The revision history shows substantial improvement, but the resulting plan still needs explicit version ownership, several unresolved rescue decisions, and production-path evidence matching its acceptance claims.

# 2. Strengths

- **Clear authority and scope boundaries.** `§Summary` and `§Scope and non-goals` distinguish provider service authority, process-local operator authority, caller authority, and future hosted work (`llp/0057-auth-provider-protocol.spec.md:30-98`). The separation between plaintext-code ownership and durable challenge state is especially clean.

- **Concrete state machines rather than vague security prose.** `§Request-code semantics`, `§Exchange semantics`, and `§Session bearer and family state machine` define closed outcomes, transactional effects, rotation, revocation, and credential matrices (`llp/0057-auth-provider-protocol.spec.md:543-759`). The cryptographic implementation closely follows the specified canonicalization, unbiased code sampling, length-prefixed HMAC framing, constant-time comparison, and bearer parsing (`src/auth/crypto.rs:74-162`, `src/auth/crypto.rs:258-345`).

- **Strong fail-closed catalog and keyring foundations.** Exact catalog recognition compares marker, SQL, and physical schema and rejects unsupported or additional protected objects (`llp/0057-auth-provider-protocol.spec.md:242-293`; `src/storage/auth.rs:1448-1503`). Keyring parsing and file validation are bounded, closed, owner-only, and zeroizing (`llp/0057-auth-provider-protocol.spec.md:467-541`; `src/auth/keyring.rs:543-605`).

- **Serious treatment of crash and path-swap threats.** The backup, restore, rescue, and concurrency sections explicitly distinguish rollback from unknown commit, retain inode identity, and reject convenient but unsafe “copy the files” semantics (`llp/0057-auth-provider-protocol.spec.md:1082-1375`). The backup source copy itself is genuinely descriptor-bound and produces a standalone SQLite image (`src/storage/auth.rs:1174-1225`).

- **Useful acceptance criteria.** The acceptance section covers adversarial collisions, malformed inputs, clock rollback, ambiguous commits, schema drift, and production projections rather than relying only on unit helpers (`llp/0057-auth-provider-protocol.spec.md:1398-1558`). These are the right kinds of tests for this protocol.

# 3. Concerns

1. **MATERIAL — The implementation and acceptance status is internally contradictory.**

   The Summary and Status say item 3 is implemented and exercised by executable acceptance authority (`llp/0057-auth-provider-protocol.spec.md:64-66`, `llp/0057-auth-provider-protocol.spec.md:1592-1599`). The same document then states that shipped code does not satisfy multiple required behaviors (`llp/0057-auth-provider-protocol.spec.md:1629-1636`) while claiming no open question blocks implementation (`llp/0057-auth-provider-protocol.spec.md:1579-1582`). Inspection confirms those gaps and finds additional failures described below.

   **Resolution criterion:** Replace “implemented” with an accurately scoped implementation status and classify each acceptance row as specified, implemented, and production-path verified; or close every required gap and produce repeatable evidence for the exact production routes before retaining the current status claim.

2. **MATERIAL — The v1 specification composes unsafely with the repository’s current v2 catalog.**

   LLP 0057 defines marker `1`, exact `ReadyV1`, and a backup command restricted to `ReadyV1` (`llp/0057-auth-provider-protocol.spec.md:123-126`, `llp/0057-auth-provider-protocol.spec.md:264-295`, `llp/0057-auth-provider-protocol.spec.md:1186-1193`). Current code creates v2 and recognizes both versions (`src/storage/auth.rs:21-35`, `src/storage/auth.rs:111-153`). Backup accepts either version but always writes the current constant—`2`—into the manifest, even when the image is v1 (`src/auth/backup.rs:100-105`, `src/auth/backup.rs:147-153`).

   More seriously, v2 adds credentials, grants, grant tokens, invitations, and pairing requests. LLP 0055 requires declared restore to revoke or purge those authority classes (`llp/0055-agent-principals-and-scoped-grants.rfc.md:1171-1200`), but current restore touches only sessions and verification challenges (`src/storage/auth.rs:1111-1129`). LLP 0057 does not list LLP 0055 as Related.

   **Resolution criterion:** Either enforce the documented `ReadyV1` restriction for backup and restore, or revise the compositional contract so manifests record the image’s actual marker and declared restore atomically handles every v2 authority class. Add v1 and v2 backup/restore fixtures and link LLP 0055 explicitly.

3. **MATERIAL — Ambiguous publication can destructively alter an already-published artifact, and the promised outcome model is absent.**

   The Spec requires cleanup suppression after any rename attempt and distinguishes `Unpublished`, `Published`, and `CommitAmbiguous` (`llp/0057-auth-provider-protocol.spec.md:1226-1246`). Backup sets `publication_attempted` only after rename returns success (`src/auth/backup.rs:1055-1065`). If rename took effect but returned an ambiguous error, `Drop` can still unlink every child through the live directory descriptor (`src/auth/backup.rs:1081-1102`). Restore has the same ordering (`src/auth/backup.rs:631-645`, `src/auth/backup.rs:663-686`).

   The operation also cannot report the required three-way result: `create_backup` returns only a manifest or generic error, and the CLI prints only ordinary success (`src/auth/backup.rs:76-84`, `src/cli.rs:693-708`).

   **Resolution criterion:** Suppress destructive cleanup before issuing the rename, or reconcile exact source and destination identities before cleanup. Return a typed three-state publication result through the CLI and fault-test ambiguous rename, post-rename validation, and parent-fsync failure.

4. **MATERIAL — Restore does not inspect the exact staged database inode it publishes.**

   The Spec requires hashing, catalog inspection, and retained-key inspection through one retained descriptor (`llp/0057-auth-provider-protocol.spec.md:1262-1268`). The destination descriptor is dropped after copying; hashing and SQLite inspection then reopen the staged pathname (`src/auth/backup.rs:235-258`, `src/auth/backup.rs:548-555`, `src/auth/backup.rs:390-394`). The catalog helpers are also pathname-only (`src/storage/auth.rs:1228-1247`).

   This recreates the exact swap window the normative text says is forbidden.

   **Resolution criterion:** Retain the staged database `File` through publication and perform hashing, catalog inspection, and key-reference inspection using a descriptor-bound SQLite connection. Add an adversarial swap test between hash and inspection.

5. **MATERIAL — Durable clock-floor seeding occurs after several durable auth operations.**

   LLP 0057 requires every durable auth `now` to use the LLP 0059 floor and explicitly forbids raw wall time for pre-coordinator restore (`llp/0057-auth-provider-protocol.spec.md:101-117`, `llp/0057-auth-provider-protocol.spec.md:1287-1293`). Startup nevertheless passes raw `SystemTime::now()` into restore (`src/cli.rs:1471-1483`), which storage writes directly into live session rows (`src/storage/auth.rs:1083-1127`). The durable floor is seeded later by `build_coordinator` (`src/auth/runtime.rs:261-274`).

   The ordering affects more than restore: sessions-to-dev downgrade receives raw provider time before coordinator construction (`src/cli.rs:272-279`; `src/storage/auth_mode.rs:729-760`), and startup GC runs before the floor is seeded (`src/cli.rs:1588-1602`). A future-dated backup or backward clock can therefore fail revocation constraints instead of restoring or downgrading.

   **Resolution criterion:** Seed from the persisted floor and relevant catalog maxima immediately after catalog inspection, before mode composition, restore, GC, or keyring lifecycle work. Represent floored time with a distinct type that raw `u64` or `SystemTime` cannot satisfy accidentally.

6. **MATERIAL — The keyring commit-ambiguity rule proves visibility, not durability.**

   After rename or parent-fsync failure, the Spec permits later operations to use whichever complete prior/candidate ring is visible after reopening (`llp/0057-auth-provider-protocol.spec.md:519-525`). Code implements exactly that byte comparison (`src/auth/keyring.rs:621-647`, `src/auth/keyring.rs:681-695`).

   After a failed parent-directory `fsync`, observing candidate bytes does not prove the rename will survive a crash. A later request may issue and commit a challenge using the candidate key; a crash may then restore the prior directory entry, leaving the durable challenge with an unavailable key.

   **Resolution criterion:** Keep issuance unavailable after ambiguous publication until directory durability is positively re-established, or adopt a journaled/two-slot keyring protocol whose recovery can prove which generation is durable. Reopening equal bytes alone must not authorize new durable references.

7. **MATERIAL — Malformed family-alarm input can perform the write the Spec says is impossible.**

   The normative rule requires a parsed-ok predicate to gate revocation even if the dummy digest deliberately collides with a tombstone (`llp/0057-auth-provider-protocol.spec.md:721-731`; acceptance at `llp/0057-auth-provider-protocol.spec.md:1540-1542`). Code substitutes the dummy digest for malformed input, but sets `actionable: true` whenever that digest finds a live tombstone, without checking parse success (`src/auth/provider.rs:1234-1264`). The transaction revokes whenever `actionable` is true (`src/auth/provider.rs:2464-2489`). The existing malformed test does not force the dummy collision.

   **Resolution criterion:** Carry parse success into the conditional mutation and require it for revocation. Use a dedicated tombstone-only, input-invariant transaction shape and add the exact dummy-equals-tombstone production-route test.

8. **MATERIAL — Session-token uniqueness and bounded collision retry are not implemented through production paths.**

   The Spec requires issuance and rotation to check current and tombstone tables transactionally and retry up to three complete candidates (`llp/0057-auth-provider-protocol.spec.md:176-189`, `llp/0057-auth-provider-protocol.spec.md:1535-1539`). Issuance inserts directly without a tombstone check (`src/auth/provider.rs:3642-3659`), and the coordinator has no retryable-collision outcome (`src/auth/coordinator.rs:692-724`). Rotation checks both tables, but a collision becomes an internal error rather than a new candidate; the production route retries only predecessor races (`src/auth/provider.rs:2593-2601`, `src/server.rs:6727-6749`).

   **Resolution criterion:** Introduce one typed retryable-collision result shared by issuance and rotation, enforce cross-table absence inside the transaction, zeroize rejected candidates, and prove the exact three-candidate behavior through HTTP and host-operation paths without exposing an internal-collision diagnostic.

9. **MATERIAL — Rescue still contains unresolved protocol choices and fails every newly stated safety obligation.**

   The Spec allows “preserve or refuse” for observable row identity and “update every key or refuse” for managed databases, but does not choose a v1 policy or enumerate eligibility across LLP 0058 states (`llp/0057-auth-provider-protocol.spec.md:1102-1124`). That is real implementation latitude despite the claim that no design question remains.

   Current code also:

   - applies strict application-identifier validation to source names (`src/auth/rescue.rs:49-70`);
   - copies named columns without preserving or refusing implicit `rowid`/`sqlite_sequence` (`src/storage/auth_rescue.rs:267-307`);
   - rewrites only legacy `schema_manifest` (`src/storage/auth_rescue.rs:700-759`); and
   - performs a bare commit without predecessor/successor reconciliation (`src/storage/auth_rescue.rs:211-220`).

   These contradict `§Source-name reachability`, `§Row identity`, `§Compatibility with LLP 0058`, and the rescue commit rule (`llp/0057-auth-provider-protocol.spec.md:1089-1124`, `llp/0057-auth-provider-protocol.spec.md:1167-1178`).

   **Resolution criterion:** Pin one exact v1 rowid/AUTOINCREMENT policy; enumerate every eligible LLP 0058 state and its four-key mutation or refusal diagnostic; then implement source reachability and exact commit reconciliation with production-path tests.

10. **MATERIAL — Public host-operation DTO ownership conflicts with LLP 0024.**

   LLP 0024 defines `auth.mintSession` as a flat credential payload and explicitly excludes an authority-instance id (`llp/0024-agent-operating-surface.spec.md:120-135`). LLP 0057 reinterprets that exclusion as applying only to the nested session and adds top-level `authorityDescriptor.authorityInstanceId` (`llp/0057-auth-provider-protocol.spec.md:934-948`). LLP 0024’s wording describes the whole operation-specific `data` payload, not only the nested object. Code follows LLP 0057 (`src/auth/wire.rs:129-186`).

   A second conflict exists for rescue: LLP 0024 says the result has exactly six fields, while LLP 0057 adds `restartRequired` to the recovery result (`llp/0024-agent-operating-surface.spec.md:134-135`; `llp/0057-auth-provider-protocol.spec.md:950-966`; `src/auth/recovery.rs:308-315`).

   **Resolution criterion:** Designate one document as the sole host-operation DTO owner and amend/version LLP 0024 explicitly, or remove the additional fields. Commit schemas and fixtures for ordinary and startup-recovery variants.

11. **MATERIAL — Committed JSON schemas do not express the normative numeric domains.**

   LLP 0057 limits durable/wire timestamps to the JS-safe range and session generation to `1..=9_007_199_254_740_991` (`llp/0057-auth-provider-protocol.spec.md:101-121`). Rust wire fields remain plain `u64` (`src/auth/wire.rs:35-40`, `src/auth/wire.rs:95-103`, `src/auth/wire.rs:218-228`). Generated schemas consequently contain only `minimum: 0`, with no JS-safe maximum (`schemas/auth.request-code.output.schema.json:9-12`, `schemas/auth.credential.output.schema.json:40-53`). The credential authority descriptor also permits generation zero, contrary to the session protocol.

   This matters because LLP 0037 makes generated, committed schemas contract authority (`llp/0037-schema-source-of-truth.decision.md:67-84`, `llp/0037-schema-source-of-truth.decision.md:131-151`).

   **Resolution criterion:** Introduce wire-semantic timestamp and session-generation newtypes or credential-specific schema projections, regenerate the schemas, and add zero, maximum, and maximum-plus-one validation fixtures.

# 4. Suggestions

- Introduce a version-composition matrix covering catalog version, supported operations, authority classes, restore effects, owning LLP, and required manifest version. That would make the 0057/0055 relationship explicit.

- Create shared type-state abstractions such as `FlooredAuthNow`, `ParsedBearerDigest`, and `DurablePublication<T>`. These would make raw wall time, dummy-digest authority, and unclassified rename outcomes difficult to express in code.

- Split the 1,600-line document into a short core provider Spec plus separately reviewable rescue and backup/restore specifications. The LLP 0005 workflow specifically recommends decomposition for documents over roughly 800 lines with independently reviewable topics (`vendor/llp/llp/0005-rfc-process.guide.md:101-103`).

- Maintain a generated conformance table mapping every normative acceptance row to its production entry points, test identifiers, supported catalog versions, and current result. Separate “unit helper exercised” from “HTTP/host-op/recovery route exercised.”

- Centralize destructive bulk revocation instead of duplicating its SQL between downgrade and restore. This reduces future drift when new authority classes are added.

# 5. Open questions

1. Is LLP 0057 intended to remain a historical v1 protocol, or is it the current compositional authority for every catalog version?

2. Which LLP solely owns host-operation `data` DTOs, and how are later additions versioned without reinterpretation?

3. What exact rescue behavior is supported for each settled, pending, quarantined, dev, and sessions mode state, and for each rowid/AUTOINCREMENT shape?

4. What durable recovery procedure should follow a failed keyring parent `fsync` before new challenges may reference the candidate key?

5. What operator-visible command and evidence distinguish `Published` from `CommitAmbiguous` after backup or restore failure?

6. What executable evidence is required before the Status may say “implemented”: unit vectors, fault-injected storage tests, production HTTP tests, host-operation schema tests, or all of them?

7. What admission control protects the public family-alarm endpoint’s mandatory `IMMEDIATE` transaction from writer-lane denial of service, and has its latency-equalization claim been measured under slow commits?

# 6. Readiness verdict

The design direction is promising, but unresolved material correctness, crash-safety, version-composition, wire-contract, and implementation-evidence concerns remain.

READINESS VERDICT: NOT READY

## Independent implementation review — 2026-07-15

### Provenance

- Reviewer family: GPT (OpenAI Codex)
- Provider/runtime: Codex CLI 0.144.4
- Model: `gpt-5.6-sol`
- Review mode: read-only, ephemeral, high reasoning effort
- Reviewed commit: `3e52f2b158f70fc2e19b7853e956c823b8f3800e`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review

READINESS VERDICT: NOT READY

- MATERIAL: Normative prose is stale and false after implementation. It still says issuance lacks the tombstone check and retry is only for `PredecessorChanged`; that the stdin impersonation capability is not shipped; and that rescue reachability, rowid/AUTOINCREMENT, managed state, and commit reconciliation remain defects. Reconcile the current-state prose with the shipped behavior and move superseded facts to a historical changelog.
- MINOR: The normative vocabulary still calls raw-clock restore a named defect even though the implementation now closes it.

## Final implementation review — 2026-07-15

### Provenance

- Reviewer family: GPT (OpenAI Codex)
- Provider/runtime: Codex CLI 0.144.4
- Model: `gpt-5.6-sol`
- Method: read-only, ephemeral CLI; high reasoning effort; blind to `llp/reviews/`
- Reviewed commit: `62a11cedfb1ff7ad0258dc3e6ce667989b88b819`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Review body (local Markdown links omitted)

## Overall assessment

Fresh blind review of committed HEAD `62a11cedfb1ff7ad0258dc3e6ce667989b88b819`. I did not read review artifacts or credentials and made no changes.

The ENG-25001 repairs are technically strong, but two material discrepancies remain between the normative Spec and the current implemented boundary.

## Strengths

- Ownership and precedence are unusually explicit: LLP 0039 owns product outcomes, LLP 0045 the delivery durability boundary, LLP 0058 staged mode, and LLP 0059 clock, commit, and projection ordering.
- Cross-table token uniqueness is implemented before mutation for issuance and rotation, with explicit collision outcomes and bounded coordinator retries.
- Malformed family alarms remain non-actionable even when the dummy digest equals a tombstone, with a focused adversarial test.
- Restore correctly derives its destructive timestamp from the durable floor, host sample, and restored creation frontier; exhausted generations fail closed.
- Backup/restore descriptor binding, keyring revalidation, rowid preservation, `AUTOINCREMENT` refusal, managed-state rescue refusal, bounded stdin intake, and portable schema maxima are concretely implemented and tested.

## Concerns

- **MATERIAL — The normative catalog version and activation contract no longer describe current production behavior.** LLP 0057 fixes `AUTH_CATALOG_VERSION` at `1`, defines only `ReadyV1`, and says activation creates that exact catalog. Current code defines version `2` as the created/current catalog and writes that marker even through `activate_auth_catalog_v1_in`. LLP 0055 confirms fresh catalogs are now v2, but LLP 0055 is absent from 0057’s Related/precedence story.
  **Resolution:** Reconcile 0057 as an explicitly versioned v1 base protocol: add LLP 0055 precedence/relationship, distinguish legacy-v1 recognition from fresh-v2 creation, and revise activation, constants, acceptance, and implementation-status claims so an implementer cannot reasonably create v1 as the current catalog.

- **MATERIAL — The promised three-state backup publication result is not exposed.** The Spec requires the operation to return exactly `Unpublished`, `Published`, or `CommitAmbiguous`, because only the first proves no output exists. Implementation correctly suppresses cleanup once rename is attempted, but every pre/post-rename failure becomes the same `SNAPBACK_AUTH_BACKUP_INVALID`; the CLI emits structured output only on success. Tests confirm both a proven pre-rename failure and a post-rename surviving unit produce that same code.
  **Resolution:** Return a stable, machine-readable publication-state field or distinct diagnostic for every exit, and test clean publication, proven pre-rename failure, ambiguous rename, post-check failure, and parent-fsync failure.

- **MINOR — Acceptance overstates production-path collision coverage.** The Spec says tombstone collisions are asserted through production HTTP and host-operation paths. Existing focused tests exercise provider transaction seams; production route loops exist, but no deterministic route/host-op test forces first-through-third tombstone collisions.
  **Resolution:** Add injected-RNG HTTP exchange/refresh and host-op mint tests, or narrow the acceptance claim to the evidence actually present.

No independent EDITORIAL concern rises above these items.

## Readiness verdict

**NOT READY**

## Blind final re-review — 2026-07-15 (`c38eabc`)

**Family:** GPT
**Provider/runtime:** OpenAI Codex CLI 0.144.4, `gpt-5.6-sol`, high reasoning, read-only ephemeral sandbox
**Redacted:** No
**Method:** Independent per-document review at exact commit `c38eabc75ae48fb186c3a39c9b9e7feff39145b8`; reviewer was instructed not to read `llp/reviews/` and made no edits or status decision.

### Review body

**Verdict NOT READY**

**MATERIAL —** LLP 0057 §Acceptance lines 1502–1511 and 1625 claim executable legacy-v1 reopen, preservation, and backup-marker evidence. No test constructs an exact v1 catalog or reaches `ReadyV1`; existing activation tests exercise only fresh `ReadyV2` (`src/storage/auth.rs` lines 2197–2240). Resolution criterion: add an exact frozen-v1 fixture proving reopen as `ReadyV1`, session usability, agent-surface refusal, no migration during activation, and backup/restore retaining marker `1`.

**MATERIAL —** Rescue commit-boundary and managed-state evidence remains incomplete. LLP 0057 lines 1654–1666 explicitly disclaim injected rescue commit-boundary coverage and composed managed-state fixtures. The reconciliation branch in `src/storage/auth_rescue.rs` lines 221–233 is therefore unexercised. Its sole managed-state test, lines 1066–1095, inserts only an invalid `{}` `auth_mode_state_v1`, not a valid LLP 0058 four-key settled, pending, or quarantined snapshot. Resolution criterion: fault-inject definite rollback, committed-but-error, and divergent reconciliation outcomes; add valid four-key fixtures proving manifest-named rescue refuses without mutation and orphan handling preserves all keys.

**MINOR —** `activate_auth_catalog_v1` and `activate_auth_catalog_v1_in` (`src/storage/auth.rs` lines 887 and 1375) now create `CURRENT_CATALOG = CATALOG_V2`. Behavior is correct, but the stale names obscure the newly established precedence. Resolution criterion: rename them to version-neutral/current-catalog activation names and update callers.
