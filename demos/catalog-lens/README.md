# catalog-lens

`catalog-lens` is a headless bookstore catalog that exercises Snapback's
bounded relational query and opaque continuation-cursor path. Books are
owner-scoped roots; publishers are a public, uniquely indexed dimension.

Run:

```sh
node packages/snapback-codegen/index.mjs demos/catalog-lens/snapback
node demos/catalog-lens/tests/acceptance/headless.mjs
```

This demo claims only the local headless surface. It does not claim full-text
search, maintained projections, offline relational execution, or hosted
relational-query support.
