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