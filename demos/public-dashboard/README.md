# public-dashboard

`public-dashboard` is a public, socketless metrics dashboard booted from one
route-declared snapshot-bundle request. The query is explicitly public,
authority-independent, and approved for tokenless inlining.

The `/context-dashboards/:dashboardId` variant proves that a route parameter
may occupy an object-reachable query-argument leaf beside recursively
validated literal context (`null`, literal-union, and array members).

Run:

```sh
node packages/snapback-codegen/index.mjs demos/public-dashboard/snapback
node demos/public-dashboard/tests/acceptance/headless.mjs
```

It does not claim HTML server rendering, authenticated register-mode boot, or
Cloudflare route registration.
