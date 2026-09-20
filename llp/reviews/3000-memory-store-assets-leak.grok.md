# Implementation review: Snapback 4 — an in-memory store no longer leaks a temp directory per engine (`issues/20260919-snapback4-memory-store-leaks-an-assets-directory-per-engine.md`) — Grok family

- **Family:** Grok (xAI Grok CLI, `grok-4.6`, reasoning effort xhigh)
- **Provider / runtime:** `grok --permission-mode plan --no-subagents --disable-web-search`, on the lead's machine, detached worktree at `ab6c242aa3` (base `7ef61e81a1`)
- **Date:** 2026-09-19
- **Redacted:** no
- **Method:** blind to the other family, read-only; one brief for both families (`brief.md` in the review directory): six questions — correctness of the fix, everything that assumed the directory existed, permissions, drop ordering and concurrency, the tests, anything else. Recorded verbatim below; absolute worktree paths shortened to repository paths, nothing else changed. The author of the change commissioned the review and is not an independent reviewer of it.
- **Verdict:** READY (three Low: every file-store upload re-chmodded `assets/`; `let _ = remove_dir_all` is the right unwind choice; the ticket's status line). The first and third applied in `6781aff5c1` (uploads touch the directory only when it is ephemeral); the second needs no change, as the reviewer said.

---

I'll inspect the baseline, the implementation commit, and the surrounding store/asset code before writing the review.I'll read the store, assets, private filesystem, and engine paths next, then every caller of `Store::memory()` and `assets_dir()`.I'll narrow the search to Snapback 4 callers and the engine's asset paths.The leak fix is correct and tightly scoped. `ephemeral_assets` is set only by `Store::memory()`; file opens, read-only handles, and `reader()` keep it false, so `remove_dir_all` cannot target a project `assets/`, a user path, or a directory two live stores share. Callers that touch the directory either create it on first write, treat `NotFound` as success, or only look at the path while the store is alive. `git diff --check` is clean.

Nothing above Low remains.

| # | Answer | Evidence |
|---|---|---|
| 1 | Yes: the flag is true only for `Store::memory()`; file stores, `open_read_only`, and `reader()` pass false. The Drop path cannot run against a project `assets/`, a caller path, or a shared live directory. | `store.rs:74`, `108`, `116–121`, `206`, `240–250`, `39–45`; `ids.rs:11–18` (80-bit mint); unique `temp_dir()/snapback4-<pid>-<ulid>` |
| 2 | No production misbehavior before first upload or after drop. Writes create the parent; reads/sweeps tolerate a missing path; GET only opens a file after a grant; device/`dev --memory` fixtures do not assume the directory exists. | `assets.rs:38–41`, `92–103`; `engine/mod.rs:473–515`, `558–578`, `621–627`; `serve/assets.rs:37–42`, `63–79`; `serve.rs:276`, `328`; `serve_tests.rs:28`, `1133–1176`, `1210`; device tests use `Store::memory()` without `assets_dir()` |
| 3 | Memory dirs/files are still 0700/0600 via `private_fs`. Skipping `existing_file` on ephemeral is right (nothing pre-exists). Re-calling `directory` on a file store’s `assets/` at each upload re-applies 0700 and still refuses a symlink; it does not relax privacy. | `private_fs.rs:10–19`, `29–46`, `55–68`; `store.rs:134–141`; `assets.rs:38–43`; unix asserts in `security.rs:262–266`, `serve_tests.rs:1162–1176` |
| 4 | Engine owns one `Store`; the host mutex/`Arc<Shared>` keeps it alive across out-of-lock upload I/O and sweep `remove_files`. Memory stores have no `reader()`. Drop swallows `remove_dir_all` errors, so a failed cleanup or unwind cannot mask the original panic. | `engine/mod.rs:233–234`, `240–242`, `267–273`; `serve.rs:48–51`, `299`; `assets.rs:37–42`; `serve_maintenance.rs:58–61`; `store.rs:39–45` (`let _ =`) |
| 5 | The new test discriminates: it fails at baseline and if eager create returned (`!exists` before upload), and fails if `Drop` were removed (upload-then-drop). The sidecar amendment is the right replacement. Upload-then-drop leftover is tested; file-store non-deletion is covered by the reopen of `old`. | `security.rs:237–241`, `246–269`, `232–236` |
| 6 | File-store uploads now re-ensure `assets/` (mkdir/chmod/symlink check) on every write — extra syscalls, recreate-if-deleted. Ticket matches the code; signal-kill leftover is called out. `git diff --check` silent. | `assets.rs:38–41` vs `store.rs:136–141`; ticket lines 25–36; diff `--check` empty |

### Findings

**Low** — `snapback4-core/src/assets.rs:38–41`. Every file-store upload now calls `private_fs::directory` on an already-prepared `assets/`. That re-chmods 0700 and will recreate a deleted `assets/` instead of failing at `create_new`. Not a privacy regression (same owner-only rules); smallest fix if unwanted is to create the parent only when `ephemeral_assets` is true (thread the flag into `Upload`) or only on `ErrorKind::NotFound`.

**Low** — `snapback4-core/src/store.rs:41–43`. `let _ = remove_dir_all` can leave one directory if removal fails (busy mount, permissions). That is the right panic/unwind choice; a second panic would hide the first. No code change required.

**Low** — ticket status line. It already says “Closed … fixed on main (this landing)” for a change that is still under review. Cosmetic.

No Critical, High, or Medium issues.

Verdict: READY
