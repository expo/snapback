# LLP 0249 isolated Node action spike

This directory is the decision-support rig for LLP 0249 rollout steps 1–2. It
calibrates package admission, bundle closure, a closed Node power table,
portable-profile refusals, and six draft wire schemas. It is deliberately
outside `tests/` and is not enrolled in Snapback's canonical proof.

**The rig does not establish an isolation capability.** Node's
`--permission` flag and module hooks are useful process-level controls, but
they are not the RFC's required OS sandbox. In particular, this spike has no
seatbelt/Landlock/namespaces enforcement, privileged launcher, live
attestation channel, or same-UID adversarial qualification.

## Run

Node 24.x is the declared engine. Node 25 is also usable for the spike when its
version is recorded in the result.

From the repository root:

```sh
cd archive/spike-isolated-node-action
env -u NPM_TOKEN -u NODE_AUTH_TOKEN \
  npm_config_userconfig=/dev/null \
  npm_config_registry=https://registry.npmjs.org/ \
  npm_config_cache=/private/tmp/llp0249-npm-cache \
  npm install --ignore-scripts --no-audit --no-fund
cd ../..
npm_config_cache=/private/tmp/llp0249-npm-cache node archive/spike-isolated-node-action/run.mjs \
  --out archive/spike-isolated-node-action/RESULTS-20260812.json
```

The first install supplies only the rig's exact Ajv and esbuild tool versions.
The harness owns a separate `sdk-project/package-lock.json`, runs its own
`npm install --ignore-scripts`, and then distrusts that flag: it re-reads every
installed manifest and file before admitting the action dependency closure.
For that child install it pins `registry.npmjs.org`, ignores user npm config,
and removes ambient npm credential variables. Registry metadata and tarballs
are the only network inputs. No credential and no real vendor API request are
used.

To validate only the six draft schemas and their 12 goldens:

```sh
cd archive/spike-isolated-node-action
npm run schemas
```

## What the rig exercises

- `@octokit/auth-token@6.0.0` is the positive pure-JS ESM package. The verifier
  closes its exact npm lockfile graph, integrity list, lifecycle scripts,
  executable module shape, native payload, depth, count, and unpacked bytes.
- esbuild emits one ESM bundle and a linked source map. The harness checks the
  32 MiB limit, residual imports, CommonJS residue, and absolute source paths.
- `preload.mjs` installs the D3-shaped frozen power table: in-memory facades,
  compute/entropy subsets of `node:crypto`, and an exact-host brokered fetch
  stub. All other Node/bare imports refuse through a registration hook.
- `bcrypt@6.0.0` is inspected from registry metadata and tar bytes, then
  refused before any install because its lifecycle and native-addon evidence
  are visible pre-install.
- temporary ordinary portable backends are passed through the existing inline
  handler and final-bundle scanners. Package imports, Node imports, `require`,
  and `WebAssembly` remain refused.
- `schemas-draft/` contains six non-authoritative draft schemas, one valid and
  one invalid golden per schema, and 13 egress-classifier vectors.

The dated narrative result is in `RESULTS-20260812.md`; the exact machine
record is `RESULTS-20260812.json`. Generated bundles and installed trees are
ignored and reproducible.
