# snapback2: owner temp symlink can clobber an arbitrary file

**Status:** Closed
**Resolution:** Owner state publication now uses a randomized create_new/O_NOFOLLOW 0600 temporary and atomic rename in snapback2/crates/snapback2/src/owner.rs; a fixed-temp symlink clobber regression preserves external bytes.
**Systems:** snapback2, owner, filesystem security
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/owner.rs:475-494

Failure scenario: an untrusted project contains .snapback/owner.json.tmp as a symlink to ~/.zshrc. Starting dev calls fs::write on the predictable temp path, truncating ~/.zshrc to owner JSON, then renames the symlink to owner.json.

Why it happens: the temporary name is fixed and opened with ordinary symlink-following semantics. There is no create_new, O_NOFOLLOW, ownership/type validation, or randomized ownership token before the atomic rename.

Suggested fix: create a randomized same-directory temporary with create_new and O_NOFOLLOW, mode 0600, verify it is a regular file owned by the current user, fsync as appropriate, then rename and only remove the caller-owned temp. Add the symlink clobber regression.
