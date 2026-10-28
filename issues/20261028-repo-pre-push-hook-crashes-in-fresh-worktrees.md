# Pre-push drift hook crashes in fresh worktrees

Status: Open
Date: 2026-10-28
Scope: `.githooks/pre-push` and the frozen-record drift gates it loads.

In a freshly created worktree (no root `node_modules`), `git push origin HEAD:main`
fails before pushing: the pre-push hook's Node gate exits with
`ERR_MODULE_NOT_FOUND` (an unresolved package import; `acorn` in the 0.4.41-0.4.44
publication worktrees). Every push from the 0.4.44 publication had to use
`--no-verify`: `c9c3a35461`, `87fb2ecef4`, the records commit, and the Mac
transport refs. 0.4.43's records push hit the same failure. For `origin/main`
targets the hook would only defer frozen-record gates to the scheduled backstop,
so `--no-verify` changes nothing in practice. But the crash trains people to
bypass the hook, and it would hide a real strict-mode failure.

Expected: the hook either resolves its own dependencies, or reports a clear
"dependencies missing; run bun install at the repo root" and exits 0 for the
deferred (non-strict) path.
