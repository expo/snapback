# access-desk

`access-desk` is a headless workspace notes app that exercises resource
membership bootstrap, another-principal admission, query gating, and
transactional permission checks.

Run:

```sh
node packages/snapback-codegen/index.mjs demos/access-desk/snapback
node demos/access-desk/tests/acceptance/headless.mjs
```

The roster is private authorization backing. The demo does not claim
administrator removal, offline retained membership reads, or hosted auth.
