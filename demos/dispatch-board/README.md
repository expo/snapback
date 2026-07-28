# dispatch-board

`dispatch-board` is a headless incident intake app. One mutation creates an
incident and its audit entry using invocation-frozen `ctx.runtime.now()` and
fresh `ctx.runtime.id()` values.

Run:

```sh
node packages/snapback-codegen/index.mjs demos/dispatch-board/snapback
node demos/dispatch-board/tests/acceptance/headless.mjs
```

It does not claim background delivery, notifications, or a general audit
subsystem.
