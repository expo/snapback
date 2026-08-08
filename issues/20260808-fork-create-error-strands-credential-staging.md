# Failed (non-crash) `fork create` strands a credential-bearing staging directory that no sweep reaps

**Opened:** 2026-08-08 · **Severity:** P2 (secret residue + unbounded disk; no automatic cleanup) · **Area:** instance_fork

## What

`src/instance_fork.rs:4603-4737` (`publish_with_options`), `src/cli.rs:3586-3660`

`publish_with_options` creates `.{dest}.staging-{uuid}`, mints an admin token
and auth/resume/operation-detail keyrings, and (with `--with-secrets`) copies
the parent's `*.config.json` into staging — then on any later error (unsupported
asset store, digest mismatch `ASSET_CUT_INCOMPLETE_CODE`, WAL/IO failure) simply
returns `Err` with **no cleanup**. `recover`/`recover_bound` reap staging only
for an explicitly named destination, but the CLI default destination is random
(`fork-{uuidv7}`), so a retry never targets the old name.
`automatic_reap_before_create` reaps only *published* expired forks.

## Failure scenario

Repeated failing `snapback fork create --with-secrets` accumulates full database
copies plus live secret-store copies under the fork root indefinitely; they are
invisible to `fork list` (the registry intent is written only after staging
completes), and nothing in the create/reap lifecycle ever deletes them.

## Fix

Wrap the post-`create_dir` body of `publish_with_options` so any `Err` (other
than deliberate test crash-cuts) best-effort `remove_dir_all`s the staging
directory it provably just created; or have `automatic_reap_before_create` sweep
sentinel-bearing, UUID-suffixed staging dirs whose app binding matches the
invoking app.

## Confidence

Medium. The crash-recovery design deliberately routes cleanup through `recover`
(@ref LLP 0158), but that covers crashes; the in-process error path owns the
UUID it just minted and could clean up after itself.
