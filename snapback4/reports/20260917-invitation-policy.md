# B1d.2a managed-policy qualification receipt — 2026-09-17

## Corrected mutation-output qualification

Current qualified source is `e1536df9418e982713f40dcf65acfe9a7722b4a2`.
Its explicit nine-field public mutation results remove the stored digest from
record, acceptance and first/repeated revocation responses. It also enforces
the documented outside-Git scratch boundary before creating its private child.
Root read the exact source and test delta; both own-thread blind delta reviews
are READY ([Sol](../../llp/reviews/3000.009-b1d-invitations.sol.md),
[Grok](../../llp/reviews/3000.009-b1d-invitations.grok.md)). Those reviews
preceded the actual rerun and did not claim to execute it.

At 06:09:17 UTC, one frozen invocation on 450b passed **4/4, no failures or
skips**: three synthetic cases plus one real managed-interpreter journey.
The actual journey took 10453.317516 ms; total duration was 10517.262862 ms.
It retained all 49 refusal probes and 15 recorded invitation IDs and added
exact output field/value assertions on every affected success path. The
unchanged binary is the `1e91bc7fe` CLI with SHA-256
`7342e869fe475e0a4629c36b87f91beac262d4551b769773574903a4cb32f187`.

- Test SHA-256: `a37d049485bd52cc02feba645d40bf0ae9602a52944f4737fcc7c8213b113fc0`.
- Organizations SHA-256: `6cb70304a8d2b07a5324ce2164d0ae8adc087af61d8233143f14d549c4f5eb4b`.
- Schema SHA-256 unchanged: `d4a7bb335b713341390a582b65bb9e97211e7e513ebaf9e16cad983f56322d28`.
- Exact three-file archive SHA-256: `38c9d520dd0c06762f4030ae3b890185d30483a46ea3110b33c49f949485837c`.
- Bundle excluding `06171edca`: `09c46480414ae036f2ded321191ced18e73956c74278bae428b82643ac5c99fb`.
- Combined actual log SHA-256: `2ac012a57a94d1b3072f7ad36df60fc08f4394a203caf9753db32bd1a1c7840c`.

The new private stage was
`/home/ccheever/sb4-b1d2-output-e1536df94-actual-20260917`, mode 0700,
outside Git; its `scratch` child was the explicit parent. The command used
the same three prerequisite environment variables shown below, substituted
that scratch parent, and ran the staged test with Node 24.13.1,
`--test --test-concurrency=1`, under a 180-second foreground cap. Execution
14529 exited zero; its tracked process identities were terminal. The final
log is mode 0600. Successful child cleanup left the scratch parent empty;
as before, this is source-bound assertion evidence, not a retained raw-response
audit. No actual provider, authentication, HTTP concurrency, restart, issuance
or delivery claim follows. The earlier passes and failures below stay retained.

## Historical pre-projection qualification

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
