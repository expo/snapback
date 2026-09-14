# Snapback 4: `snapback4 token` prints prose and the token together on stdout

Status: Closed
Priority: P3
Date: 2026-09-13
Systems: CLI (`token`)
Observed version: published `snapback4@0.2.8`
Evidence status: two correction loops in one ceremony-bar run (`benchmarks/runs/2026-09-13-snapback4-ceremonybar-before/run-2/run-log.md`, loops 3 and 5)

## Problem

`snapback4 token --service <name>` prints explanatory prose together with
the bearer token, and the agent's script that captured stdout for the token
got the prose too ("CLI stderr prose included in bearer token"; "extract
opaque token by token alphabet because merged stdout and stderr order
varies"). A script should be able to `TOKEN=$(npx snapback4 token --service
worker)`.

## Fix

Print the token alone on stdout and every sentence on stderr (or behind
`--json`), and say so on the services card and in the README.

## Resolution — 2026-09-14 (Lane T)

The token and one newline are now the only stdout form, including when
`--json` is passed, for project and `--release` service tokens; explanatory
text stays on stderr. The README and services card pave
`TOKEN=$(npx snapback4 token --service worker)`. The CLI mints service
tokens only; viewer sessions are minted through `/auth/session`.

On base `30cf4ce809d68eb8f99c770a7cf6b98d3193708a`, the default token
command already separated the streams: stdout measured 44 bytes before
and after. Its `--json` exception measured 128 bytes before and 44 after.
The fix removes that exception and locks the contract with piped-output
tests: all eight calls (four flag forms on both stores) yield a 43-character
base64url token plus newline, with prose only on stderr. Each captured
token successfully mints a session through `/auth/session`, and that
session runs a query as the intended principal.

The adjacent stdout audit also separates `serve`/`dev`'s URL from lifecycle
and supervised-worker logs, `types`' generated path from its status,
`data`'s JSON lines from its truncation hint, and SQL's table from its
inspection header and row-count/truncation footer. SQL `--json` remains
one JSON result; `check --json --cost` keeps cost prose on stderr so stdout
also remains one JSON result. `init` and the other human reports keep their prose.
No chat-app or fixture script parses the old token shape. Targeted
periphery tests: 12 passed, 0 failed; compiled guide tests: 8 passed,
0 failed. Full-suite qualification is recorded in the Lane T journal entry.
