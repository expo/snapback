# `sync-agent-skills` `rm -rf`s real directories at fixed dot-paths, automatically from git hooks

**Opened:** 2026-08-08 · **Severity:** P2 (silent data loss from an automatic checkout/merge hook) · **Area:** scripts / git hooks

## What

`scripts/sync-agent-skills:31-39, 62-68`

```sh
link() { ... if [ -L "$path" ] || [ -e "$path" ]; then rm -rf "$path"; fi; ln -s "$target" "$path"; }
```

applied to `.agents/skills`, `.claude/skills`, `.cursor/skills`, `.pi/skills`,
`.opencode/skills`, and `skills/<name>`. This runs automatically from the
post-checkout / post-merge hooks (with `--quiet`).

## Failure scenario

A user or another tool materializes, say, `.claude/skills/` as a **real
directory** containing project-local skills not from the vendored repos. On the
next `git checkout`/`git merge`, the hooks run this script and the directory is
`rm -rf`'d without warning or backup, replaced by a symlink. The loss is silent.

## Fix

Only `rm` when the existing path is a symlink (or an empty dir). On a populated
real directory, warn and skip, or move it aside to `path.bak.<ts>` before
linking.

## Confidence

High on behavior. The symlink normalization is deliberate; the destructive
handling of a non-symlink directory with unknown content is not guarded.

## Resolution (2026-08-08)
Fixed on main (Lane G). Verified: bash -n / node --check on edited scripts; cargo verify-project OK.
