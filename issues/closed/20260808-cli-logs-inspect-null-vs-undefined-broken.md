# `snapback logs` / `snapback inspect` always fail when optional flags are omitted (null-vs-undefined drift)

**Opened:** 2026-08-08 · **Severity:** P1 (two documented CLI commands are unconditionally broken) · **Area:** snapback-cli

## What

`packages/snapback-cli/index.mjs` ~3755-3775 (consumed by
`deployment-control.mjs` `normalizeAdapterQuery`)

`takeFlag(args, name, fallback = null)` (index.mjs:2909) returns **`null`** when
a flag is absent, never `undefined`. But the local `logs`/`inspect` query
builder guards each optional flag on `=== undefined`:

```js
...(limitRaw === undefined ? {} : { limit: Number(limitRaw) }),
```

Since `limitRaw` is `null`, the "present" branch always runs: `limit:
Number(null)` = `0`. `normalizeAdapterQuery`'s `limit ?? 100` does not apply to
`0`, so it throws `SNAPBACK_ADAPTER_QUERY_INVALID` (`limit < 1`).

## Failure scenario

Bare `snapback logs --target <id>` and `snapback inspect --target <id>` — the
documented minimal invocation — can never succeed. The `snapback hosted
inspect|logs` sibling (index.mjs ~3665) correctly tests `=== null`, confirming
this is copy drift between the two paths.

## Fix

Change the four guards (`sinceRaw`/`untilRaw`/`limitRaw`/`cursor`) to
`=== null`. Consider a shared option-parsing helper so the two siblings can't
drift again.

## Confidence

High — verified `takeFlag`'s null default, the `=== undefined` guards, and the
correct `=== null` sibling directly.

## Resolution (2026-08-08)

Fixed on `main` at 78e78b021: the four local `logs`/`inspect` `queryOptions` guards now test `=== null` (matching the `hosted` sibling). Verified `node --check` and pre-push gates.
