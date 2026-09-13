# Guide gap: Exact prebuilt macOS host ignored Coterie's external URL

**Filed:** 2026-08-15 · **Status:** Open · **Systems:** Exact, Guide, Demos,
Native hosts

**Related:** LLP 0266; Diary 0086; Exact LLP 0318

## Problem

From `demos/coterie`, the documented shared-host command

```text
exact run macos --url http://127.0.0.1:8085
```

selected a verified prebuilt `ExactAppMac` artifact and launched without an
obvious error, but the window continued to show that artifact's embedded
Caltrain application. The direct Acto tree contained `caltrain-shell-root`,
not Coterie's `coterie-root`, and the Coterie dev-server relay registered no
macOS target.

This is dangerous for demo and benchmark evidence because the command appears
successful while the selected host is not running the requested application.

## Guide/tooling closure wanted

The Exact authoring guide and CLI should make the prebuilt-host requirements
and failure state unambiguous. Preferably `exact run macos --url ...` should
either load the requested external bundle and register against its relay, or
fail closed with a diagnostic explaining that the discovered host is an
embedded/app-specific artifact and how to build or select a compatible shared
host. A post-launch identity check against the requested relay/root would
prevent false platform claims.

Until this closes, Coterie must not claim a macOS live-host pass from that
artifact; a web/native compile is not substitute evidence.
