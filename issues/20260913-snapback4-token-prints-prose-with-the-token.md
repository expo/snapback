# Snapback 4: `snapback4 token` prints prose and the token together on stdout

Status: Open
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
