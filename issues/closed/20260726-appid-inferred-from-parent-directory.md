# `appId` is inferred from the backend's parent directory name and cannot be overridden

**Filed:** 2026-07-26 · **Source:** building `demos/partitime/backends/snapback`
**Status:** resolved

## What happened

`inferAppId()` in `packages/snapback-codegen/index.mjs`:

```js
function inferAppId(backendDir) {
  return resolve(backendDir).split(/[\\/]/).slice(-2, -1)[0] || 'local-app';
}
```

The Partitime matrix layout is fixed by its frozen spec as
`demos/partitime/backends/{snapback,convex,supabase}/`, so the Snapback app's
id is literally `"backends"`. It appears in `schema.manifest.json`, in the
generated operation schema `$id`s
(`https://schemas.snapback.dev/apps/backends/…`), and in anything that keys off
app identity.

`demo.snapback.json` carries an `id` field but it feeds the demo manifest, not
`appId`.

## Fix candidate

Accept an explicit `appId` from `demo.snapback.json` (or a codegen flag) and
fall back to the directory inference only when absent.

## Resolution (2026-07-26)

Codegen now walks upward from the backend to the nearest
`demo.snapback.json` and uses its explicit `id` as `appId`; only a backend
without such a manifest uses the legacy immediate-parent fallback. An explicit
id is closed input with a 1–64 character lowercase ASCII slug grammar, so path
separators, whitespace, controls, Unicode/case ambiguity, and overlong values
cannot leak into stable function ids or schema `$id` paths.

`function-id.test.mjs` proves nested `<demo>/backends/snapback` identity,
generated schema paths, the portable grammar edge cases, and fail-closed
behavior rather than path fallback. LLP 0004 now owns the identity rule.
