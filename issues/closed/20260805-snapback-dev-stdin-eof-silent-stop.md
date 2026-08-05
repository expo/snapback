# `snapback dev` treats non-TTY stdin EOF as a successful shutdown request

**Status:** Closed
**Impact:** 5
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Systems:** Packaged CLI, Server lifecycle, Agent operation, Generated apps
**Date:** 2026-08-05
**Governing:** LLP 0041

## Problem

`attachDevControlChannel` attached readline to every non-TTY stdin and called
the dev loop's `stop()` when readline closed. A direct detached launch, CI
runner, or generated app script with stdin connected to `/dev/null` therefore
started successfully and immediately stopped with exit 0. The result was a
silent false success: the server and optional client arm were gone even though
the caller never requested shutdown.

The same EOF behavior is correct for stdio protocol servers such as MCP, so a
global stdin policy change would break a separate lifecycle contract.

## Acceptance

- Non-TTY JSON commands continue to work while stdin is open.
- Non-TTY stdin EOF closes only the optional dev command channel.
- The dev server, watcher, and generated client arm stay live after EOF.
- SIGINT/SIGTERM and interactive `q`/Ctrl-C still shut down cleanly.
- MCP stdio EOF behavior is unchanged.

## Resolution (2026-08-05)

The readline close handler no longer calls `stop()`. Focused unit coverage pins
the channel behavior, while the full generated React dev-loop acceptance test
closes stdin, proves both managed arms remain healthy, then uses SIGTERM and
proves cleanup. No MCP code or test expectation changed.
