# B1d.2a managed-policy qualification receipt — 2026-09-17

Frozen source: `06171edcaf391c4fc0e7f2b36a973622167bdd3a`.
Supervisor-run actual Linux check: **3 passed, 0 failed, 0 skipped** — two
synthetic instrument checks and one actual managed-policy journey. The actual
journey took 10295.154849 ms; total Node duration 10359.706837 ms. Tracked
execution 76706 exited 0; the exclusive 450b test slot was released afterward.

## Exact inputs

- Host: owned private staging on 450b (`100.85.211.16`), not a repository or core tree.
- Node: `/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node`, version 24.13.1.
- CLI: `/home/ccheever/targets/sb4-b1d-hash-1e91bc7fe/debug/snapback4`, source `1e91bc7fe`.
- CLI SHA-256: `7342e869fe475e0a4629c36b87f91beac262d4551b769773574903a4cb32f187`.
- Test SHA-256: `44f7ac8e6f198153b09052880594d37db2505640d2e896b5242c1798903f5482`.
- `organizations.q` SHA-256: `57c142f0a231417e385e0e5bdab08789e787bf9f51780faf230009718d93f5f0`.
- Unchanged `schema.q` SHA-256: `d4a7bb335b713341390a582b65bb9e97211e7e513ebaf9e16cad983f56322d28`.
- Three-file archive SHA-256: `de17e7848ec5eb7e8bf432ab6b0fee9d06f20652ad0f2c3423637f45419a8485`.
- Bundle excluding `a6cb839b7`: `/tmp/sb4-b1d2-policy-06171edca.bundle`, SHA-256 `71c2e7253de91d6b4e0881f86a13dd237bea7db18cd48fab0d84324ee50ebc58`.

Both archive/source checks and the binary digest were verified before execution.
Fresh preflight load was 0.03 / 0.10 / 0.14; staging and scratch parent were
owned by the test user with mode 0700. No install, Rust build, listener,
provider launch, SQL access or core-tree mutation was performed.

## Command

Executed in `/home/ccheever/sb4-b1d2-policy.nvOWiR`, with umask 077:

```sh
timeout 180s env \
  SNAPBACK4_B1D_MANAGED_BIN=/home/ccheever/targets/sb4-b1d-hash-1e91bc7fe/debug/snapback4 \
  SNAPBACK4_B1D_MANAGED_BIN_SHA256=7342e869fe475e0a4629c36b87f91beac262d4551b769773574903a4cb32f187 \
  SNAPBACK4_B1D_MANAGED_SCRATCH_PARENT=/home/ccheever/sb4-b1d2-policy.nvOWiR/scratch \
  /home/ccheever/.local/node-v24.13.1-linux-x64/bin/node \
  --test --test-concurrency=1 \
  summary-06171edca/snapback4/packages/snapback4/test/identity-organizations.test.mjs \
  > policy-r4.stdout.log 2> policy-r4.stderr.log
```

Stdout SHA-256: `5002e95b57be257e66b738a60d15f6f1d974c4870b8b0f5b531b8655f10484fa`.
Empty stderr SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

## Claims and limits

The passing source-bound journey executes all 49 expected refusal probes
(22 query, 27 mutation), the final empty mismatch assertion and 15 successful
invitation IDs. Positive assertions include ordinary owner/admin summaries,
membership and exact-ID invitation reads, valid and existing-member acceptance,
distinct principals sharing a verified email, role changes/removal/leave,
reservation expiry/replacement, and late-capacity refusal rolling back member,
invitation, reservation and audit state. Negative assertions cover recipient,
token/digest, verification/freshness, strict expiry, revocation/reuse and tenant
authorization. The named nonuniform page is never used as a complete inventory.

Principals and times are operator-supplied `--as`/`--now` inputs. Profile setup
uses the service mutations as a fixture; this is **not authentication, session,
OIDC, provider, delivery, concurrent HTTP, lost-ack or restart proof**, and does
not establish full Identity/B. Fresh independent reviews remain parent-owned.

The unchanged frozen instrument removed its successful owned scratch directory
and raw response journal. The parent explicitly approved this before launch;
the retained stdout, exact source and digests support assertion execution, not
a retrospective raw-response audit. All three prior red runs and their failure
scratch/journals remain untouched under the same private staging root.
