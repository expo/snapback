# snapback2: init overwrites unreadable or non-UTF8 project files

**Status:** Closed
**Resolution:** Init now propagates unreadable and non-UTF-8 managed-file failures from snapback2/crates/snapback2/src/init.rs; crates/snapback2/tests/init.rs proves byte-for-byte preservation.
**Systems:** snapback2, init, data loss
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/init.rs:164-197

Failure scenario: an existing AGENTS.md contains a non-UTF8 byte. read_to_string fails, unwrap_or_default converts the failure to empty content, and init overwrites the file with only the managed block. .gitignore is similarly replaced with only .snapback/. A writable but unreadable file follows the same path.

Why it happens: update_agents and update_gitignore treat every read error as absence/empty rather than a conflict. Preflight checks only file kind, and the later write has no backup or recovery.

Suggested fix: propagate read failures as E_INIT_CONFLICT and leave the original bytes untouched, or use a deliberately byte-preserving append where valid. Add invalid-UTF8 and read-permission tests with byte-for-byte post-refusal assertions.
