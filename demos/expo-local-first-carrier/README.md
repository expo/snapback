# Expo local-first carrier qualification

This is a qualification harness, not a product demo and not a capability
catalog entry. It exercises the module-neutral SQLite carrier against Node's
SQLite binding for supporting evidence and supplies the director for Expo
simulator/device runs. Node evidence can never activate the packaged
publication manifest.

Run the supporting tier:

```sh
volta run --node 24.18.0 node demos/expo-local-first-carrier/scripts/qualify-node.mjs
```

Inspect the real-device plan without touching a device:

```sh
node demos/expo-local-first-carrier/scripts/qualify.mjs \
  --platform ios --device DEVICE_ID --mode process --dry-run
```

An actual process run drives 100 seeded cuts. An actual power run drives 25
cuts and pauses at each cut for the lab relay/operator hard-power action. A
power run cannot be marked complete unless the director receives an external
hard-power witness for every cycle. Raw append-only runs are written under
`evidence/<run-id>/`; reviewed promotional receipts belong under
`tests/acceptance/receipts/` and must be SHA-bound by the packaged publication
manifest in a separate receipt landing.

Actual runs also require `--js-bundle PATH`, `--native-binary PATH`, and
`--battery-reference PATH`. The director hashes those exact artifacts into
the candidate receipt; it refuses to substitute source files or an ambient
commit name for the built JavaScript/native identities or complete-battery
reference.
