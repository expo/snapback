# snapback2: init follows project symlinks and writes outside the root

**Status:** Closed
**Resolution:** Init now rejects symlinked managed paths and exclusively creates template files in snapback2/crates/snapback2/src/init.rs; crates/snapback2/tests/init.rs proves external files and directories remain unchanged.
**Systems:** snapback2, init, filesystem security
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/init.rs:85-106

Failure scenario: a cloned project contains AGENTS.md as a symlink to ~/.zshrc. snapback2 init . accepts it as a file and replaces/appends the managed block in ~/.zshrc. A snapback symlink to an external directory similarly receives template files outside the requested project.

Why it happens: ensure_file_or_absent and ensure_directory_or_absent at lines 313-327 use path.exists/is_file/is_dir, which follow symlinks. copy_absent and the update functions then perform ordinary following writes with no canonical-containment or no-follow check.

Suggested fix: use symlink_metadata and directory-relative no-follow opens, reject symlinks in every managed path component, and verify every target remains under the canonical project root. Add file- and directory-symlink refusal tests that assert external bytes stay unchanged.
