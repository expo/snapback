# Admin console credential is passed on `open` / `xdg-open` argv

**Opened:** 2026-08-12 · **Severity:** P2 (security; local AdminWrite bearer) · **Area:** CLI / admin

## What

`console_fragment_url` (`src/cli.rs:6091-6096`) builds `/_snapback/admin/#credential=sbcc_…&expiresAtMs=…`. `open_admin_browser` (`src/cli.rs:6111-6134`) does `Command::new("open"|"xdg-open").arg(url)`.

The fragment stays off HTTP; it still appears in the helper’s argv. Same class as the closed “no secrets on argv” ticket (`issues/closed/20260808-secrets-on-argv-across-cli-and-supervisor.md`), new site.

## Why it matters

On Linux `/proc/<pid>/cmdline` is world-readable for the life of `xdg-open` / the browser launcher. `sbcc_` is a live AdminWrite bearer.

## Fix

Open a credential-free URL and complete mint in-page (loopback claim, or `stdin`/`--no-open` only). Do not put `sbcc_` on argv.

## Confidence

High. Previous argv ticket is closed and did not include this path.
