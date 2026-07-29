## 2026-07-29 — Research Room final refresh: safe refusal and clean r3

This draft is for serialized coordinator integration. It does not edit the
shared diary.

### What happened

The first refreshed run had already stopped for a builder-side secret exposure.
For the next attempt I built a fail-closed wrapper that gave both the CLI and a
separate credential parser pre-opened `0600` stdout/stderr files under a
process-owned `0700` root. The only caller-visible output was fixed-schema JSON
with counts, hashes, and booleans.

That boundary worked exactly as intended. r2's CLI child exited zero, but the
parser rejected the output and retained no carriers. I did not inspect or
recover the raw output. The exact target stopped immediately and all resource,
port, raw-file, and credential probes returned zero.

Static inspection of the official Supabase CLI `v2.110.0` source explained the
failure. `supabase start` always renders its final status in the pretty format,
even when the global `--output env` flag is supplied. Current labels are
`Project URL`, `Publishable`, and `Secret`, while the first parser expected
older labels. The environment vocabulary had also grown to include REST, MCP,
Functions, storage, Mailpit, and the new S3 region name. A narrow, source-cited
correction plus an exact-output adversarial case brought the suite to 9/9.

After independent review, r3 used a fresh project and target namespace with a
new port block. The corrected wrapper parsed five exact private carriers
without exposing their values. A second local runner consumed those carriers
and contained acceptance/performance output the same way. All 15 scenarios
recorded evidence. The exact target then stopped, the carriers were destroyed,
and cleanup was clean.

### What felt good

- PostgreSQL made the core model unusually direct. RLS covered outsider
  isolation across tables, RPCs, questions, citations, and secret metadata.
- Storage, Auth, pgvector, generated full-text search, pg_cron, Edge Functions,
  and Realtime private Broadcast all worked in one official local stack.
- Database-triggered private Broadcast gave a strong collaborator path: Bob
  saw exactly four progress events while Mallory saw none.
- Transactional RPCs made cancellation, late-patch prevention, idempotent
  retry, and distinct terminal outcomes precise and inspectable.
- The local stack cost claim is simple and honest: actual local provider cost
  was zero.

### What felt bad or surprising

- A command accepted `--output env` but ignored it for the final `start`
  display. That is a serious automation papercut around credential-bearing
  output.
- Successful startup emitted thousands of credential-bearing bytes plus
  diagnostics. Safely obtaining the few values the application needed required
  a substantial containment and parsing subsystem.
- The output contract changed from legacy JWT labels to publishable/secret
  labels without a versioned machine-readable descriptor.
- The broad TypeScript configuration reports 23 diagnostics even though the
  production build and the executed TS acceptance/performance programs pass.
  That makes "is this project green?" less crisp than it should be.
- Startup and teardown require a fairly heavy Docker topology for a small app.

### Snapback improvement implications

- A machine-readable start descriptor should be a stable, versioned contract,
  not a presentation mode. Presentation flags must never be silently ignored.
- Ready/status receipts should be nonsecret by default. Credential material
  should go only to an explicitly requested owner-only file or inherited file
  descriptor, never ordinary terminal output.
- Snapback should preserve Supabase's end result for authorization and data
  expressiveness: policy-backed multi-user isolation, transactional functions,
  durable scheduling, file authorization, semantic/keyword search, and
  first-class realtime collaboration.
- Local lifecycle cleanup should expose exact namespace/resource proofs and
  make it easy to prove that no listener, carrier, or runtime remains.
- The strongest competitive target is Supabase's breadth without its
  credential-output and local-stack automation friction.

### Performance and claim boundaries

The r3 local window used two warmups and seven recorded samples. Median local
times were 2.427 ms for keyword search, 1.912 ms for the write RPC, 1.790 ms
for progress Broadcast, 3.555 ms for reconnect, and 238.739 ms for the Vite
artifact build. Hosted deployment was not sampled because no project-scoped
hosted CLI token was in scope; no hosted latency or cost claim is made.
