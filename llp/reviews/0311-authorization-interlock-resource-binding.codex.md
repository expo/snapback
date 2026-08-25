**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI, `gpt-5.5` at xhigh reasoning effort,
independent ephemeral session
**Date:** 2026-08-25
**Redacted:** no
**Method:** cli-runner

# LLP 0311 review artifact — Codex family

Target: `llp/0311-authorization-interlock-resource-binding.rfc.md`

## Round 1 — Draft r1

- Revision under review: Draft r1, sha256
  `8c9c6b933aec7636c342902521ff101b061f456270d53a5d1e536c51f5b64320`.
- Reviewer: fresh `gpt-5.5` Codex CLI session at xhigh reasoning effort,
  read/reason-only instruction with repository access; no Cargo/build/test
  command and no file edit.
- Independence: separate process and fresh session from the authoring agent;
  same GPT model family, disclosed. A Grok-family launch was attempted first,
  but the installed CLI was unauthenticated and produced no review.
- Result: **NOT READY**, one material concern and one non-material correction.
- Capture note: the CLI emitted the final response twice byte-for-byte. One
  copy is preserved verbatim below; the exact duplicate is not repeated.

### Review body (verbatim)

**Material Finding**
The RFC overclaims “automatic refusal” for raw/path-opened producers unless it makes connection acquisition part of the safety boundary. A `LocalDatabase` SQLite authorizer will not cover helpers that open a fresh `rusqlite::Connection` by path, such as [auth_rescue.rs](</home/ccheever/lanes/mdesign/crates/snapback-kernel/src/storage/auth_rescue.rs:1073>) and `rescue_auth_collision_file` at [auth_rescue.rs](</home/ccheever/lanes/mdesign/crates/snapback-kernel/src/storage/auth_rescue.rs:206>). This conflicts with the RFC’s “closed gateway automatically refuses missed producers” claim for the collision-manifest fixture. The related issue [20260825-no-in-database-mechanism-defends-against-a-raw-connection.md](</home/ccheever/lanes/mdesign/issues/20260825-no-in-database-mechanism-defends-against-a-raw-connection.md:48>) records the principle directly: in-database mechanisms do not defend against a party holding a raw writable connection.

Required fix to the RFC: state that every writable connection to a guarded database must be acquired through a Snapback gateway that installs/asserts the guard before any protected write, and that arbitrary external/raw SQLite writers are either out of threat model or blocked by file/lease/version fencing. Path-taking fixture/maintenance helpers must be demoted, wrapped, or explicitly classed as offline-exclusive before “automatic refusal” is claimed.

**Verified**
The `AuthorizationInterlockState` read/write census is otherwise complete. Source search found only handle-local construction, lifecycle transitions, reservation predicates, transaction prep/commit paths, and sync/server/engine wrappers. Constructors still set `Disabled` at [storage.rs](</home/ccheever/lanes/mdesign/crates/snapback-kernel/src/storage.rs:3045>), [storage.rs](</home/ccheever/lanes/mdesign/crates/snapback-kernel/src/storage.rs:3115>), and [storage.rs](</home/ccheever/lanes/mdesign/crates/snapback-kernel/src/storage.rs:3361>). The fail-open branch is real at [storage.rs](</home/ccheever/lanes/mdesign/crates/snapback-kernel/src/storage.rs:1557>) and [storage.rs](</home/ccheever/lanes/mdesign/crates/snapback-kernel/src/storage.rs:1082>).

The row-survival findings are basically correct for this interlock defect. F157/F171/F172/F173/F175/F188/F190/F191/C005/C009/F094/F143 are not reopened merely by a second disabled handle; their current failures/refusals are at carrier, target-engine, issuer-history, or database-binding consumers. F182 is correctly separated: [auth.rs](</home/ccheever/lanes/mdesign/crates/snapback-kernel/src/storage/auth.rs:1786>) passes cached `self.schema` into the transaction, so a pre-activation handle can retain stale agent mode.

The producer census and cfg distinctions check out for the named categories: graph-corpus install and push/frozen/collision fixtures are additive `test-support`; frozen v2 is `cfg(test)` only at [auth.rs](</home/ccheever/lanes/mdesign/crates/snapback-kernel/src/storage/auth.rs:2689>). Guest reap/claim and function generation are default unguarded producers.

LLP 0059 ordering is respected at the RFC level: lease wait is outside Local/SQLite and in-transaction checks are nonblocking. The follow-on spec still needs an explicit rank for the new resource-coordinator mutex.

Permanent-denial recovery, migration safety, and epoch rollover are handled at the right design level. The rollover finding is source-backed: `install_graph_corpus_streams_for_test` accepts `epoch == MAX`, while `advance_authorization_epoch_in` cannot advance past it.

**Non-Material**
The RFC names `install_authorization_commit_participant_expectation`; the current method is `authorization_expectation_view_for_participant_install`. The classification is right, but the name should be corrected.

NOT READY

## Round 1 disposition

- **Material — raw/path-opened connections:** folded in Draft r2. R5/R9/R10
  make connection acquisition part of the supported safety boundary; §6.5
  scopes the authorizer honestly, inventories every path opener, and requires
  direct file writers to be wrapped/demoted. Migration now requires removal of
  old/raw filesystem write authority rather than claiming a marker can fence an
  uncooperative binary.
- **Non-material — method name:** corrected in §2.2.
- **Lock-rank follow-up:** promoted from observation to R6, Stage B, and
  acceptance evidence.

## Round 2 — Draft r2 delta review

- Revision under review: Draft r2, sha256
  `582704362b9d54d02308ff6ba76d681d229410ba381f9e426cb8f78c2fe617c4`.
- Reviewer: fresh `gpt-5.5` Codex CLI session at high reasoning effort,
  read/reason-only instruction with repository access; no Cargo/build/test
  command and no file edit.
- Scope: Round-1 material disposition, method-name correction, lock-rank fold,
  and new material concerns introduced by r2.
- Result: **READY**, no material concerns; Round-1 material **DISPOSED**.
- Capture note: the CLI again emitted the final response twice byte-for-byte.
  One copy is preserved verbatim below; the exact duplicate is not repeated.

### Review body (verbatim)

**Material Concerns**

None.

Round-1 raw/path-opened connection concern: **DISPOSED**. Draft r2 now makes writable connection acquisition part of the safety boundary in [LLP 0311 R5/R10](/home/ccheever/lanes/mdesign/llp/0311-authorization-interlock-resource-binding.rfc.md:249), explicitly says hostile/arbitrary raw SQLite writers are outside the mechanism’s threat model, and requires supported Snapback writers/path openers to go through the gateway, be demoted, or become offline-exclusive. §6.5 also no longer claims a SQLite authorizer covers path-opened helpers; it specifically calls out `rescue_auth_collision_file` and `install_auth_collision_fixtures_for_test` as needing replacement/demotion.

Method-name fold: verified. r2 uses `authorization_expectation_view_for_participant_install`, matching [storage.rs](/home/ccheever/lanes/mdesign/crates/snapback-kernel/src/storage.rs:2168).

Lock-rank fold: verified. r2 promotes the prior observation into R6 and Stage B: the resource coordinator must receive an explicit rank and prove edges against LLP 0059. That is the right RFC-level disposition; the later spec still owes the actual rank proof.

**Non-Material Observations**

The comparison table’s “Closes raw protected writer” column is acceptable only because §6.5/R10 narrow “raw” to supported Snapback/path-opening writers. A future edit could rename that column to avoid rereading it as “hostile arbitrary SQLite writer.”

The producer table’s “automatically refused” shorthand is now sufficiently qualified by the adjacent “path opener does not” language and §6.5.

No builds, tests, Cargo commands, or file edits were run.

READY
