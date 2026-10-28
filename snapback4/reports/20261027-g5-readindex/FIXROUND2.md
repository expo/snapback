# G5RF2: warm-pool publication mode and reader refresh

2026-10-28, base `c890e2af67`, branch `sb4-pg/g5-readindex`.

The delta reviews were Sol **READY** (no findings) and Grok **NOT READY**.
This round disposes both Grok findings. It does not claim a new review verdict,
Stage R composition, publication qualification or a new performance result.

| Finding | Disposition | Witness |
| --- | --- | --- |
| MATERIAL, in-delta: owner mode changes miss warm HTTP readers/factories | One private `Arc<AtomicU8>` holds the publication mode for the owner, readers, factories, writer slots and replacements. The setter publishes a release store; the single RI predicate acquires it at enrollment, validation and proof use, including after authority resolution. Shared mode was chosen over freezing configuration after construction so future Stage R can close RI across an already warm pool. Unknown/future modes fail closed. | `g5rf2_http_pool_mode_change_blocks_idle_factory_and_saved_proofs` builds the full pool under SynchronousHead, saves proofs, changes the owner to PublishedPrefix, then proves both an idle reader and a forced factory-made reader cannot enroll, validate or consume the proofs. |
| MINOR, pre-existing: a socket refresh silently disables RI process-wide | Reader refresh revokes the grant only when G6 is configured. With G6 off there is no SQL-free epoch to revoke: replacement still rebinds identity/generation/catalog, and RI checks fresh full-stamp/owner SQL. Terminal revocation and commit uncertainty remain sticky and still block RI; no latch is cleared. | `g5rf2_reader_socket_refresh_preserves_ri_but_uncertainty_blocks` kills a real reader backend, validates on its replacement, proves RI hits on it and another reader, then rejects a saved proof under uncertainty. `g5rf2_configured_g6_socket_refresh_still_revokes` is the configured-G6 control. |

`g5rf2_saved_proof_rechecks_publication_mode_and_revocation_after_authority`
changes mode on the owner or releases the real lease during authority resolution;
the in-flight saved proof cannot become an RI hit. The old prefix, takeover and
uncertainty witnesses remain in the affected suites.

The governing constraints are the controls RFC's
[RI subsection](../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md#g5-read-index-validation),
RFC 003 [§5.1](../../../llp/3000.009.001.000.000.003-concurrent-disjoint-commits.rfc.md#51-the-reader-rule)
and [§14](../../../llp/3000.009.001.000.000.003-concurrent-disjoint-commits.rfc.md#14-amendments-this-rfc-would-make),
and the store port's connection/rebinding contract. Both RFCs now record shared
mode custody. Stage R must preserve that cell, select PublishedPrefix before
W/R admission and integrate W-bound V, fills, metadata and minima before
reopening RI. Stage E retains its existing refusal to install after readers or
writer slots exist. The release guide and append-only journal are updated.

## Verification

All builds use the
lane's root `target` and `CARGO_PROFILE_DEV_DEBUG=line-tables-only`. Private
Postgres 16 runs on unused port 55781, with both socket and loopback TCP
available. RI is unset (the serving default) except the existing both-flags
child. No shared cluster is used.

The socket witnesses wait on the reader's actual closed flag before reconnecting.
`Connection::is_closed` is crate-visible so these engine-level witnesses do not
resolve that call through the synchronous-client `Deref`. This changes no
transport behavior or public store-port surface.

Initial harness runs exposed a missing explicit store binding in the HTTP
session helper and the closed-flag visibility issue; those probes were corrected.
The first private cluster configuration also left JIT on, which produced
Postgres errors loading the local installation's missing `libLLVM-17.so.1`.
The cluster was set to `jit=off`, with `fsync`, `synchronous_commit` and
`full_page_writes` on, then checkpointed before the final database run. The
failed invocations remain in local logs; the final results below supersede them.

| Check | Result |
| --- | --- |
| Private PG cache/grant/RI: `cargo test -p snapback4-core --features postgres --lib engine::revision_cache::tests -- --include-ignored --test-threads=1 --nocapture` | 46/46 pass, including all ten core RI witnesses and the new G6 socket control. |
| HTTP RI (`read_index_tests --ignored --test-threads=1`) | 8/8 pass; rerun after the JIT/configuration correction. |
| Private PG pipeline (`pipeline --ignored --test-threads=1`) | 13/13 pass, including socket reconnect/binding, forced-RLS, TCP overlap/NODELAY and queue preparation. |
| Private PG read closure (`read_closure --ignored --test-threads=1`) | 12/12 pass. |
| Core `cargo test -p snapback4-core --features postgres --all-targets` | Pass: 1,297 reported passes, zero failures across 51 summaries (including nested child/example summaries); intentionally ignored private/long witnesses retain their skip status. |
| Core doctests | 38/38 pass. |
| CLI `store_port_ratchet` | 9/9 pass; no allowance change. |
| `./ref-check` | 575 LLP documents, 12,179 references, zero errors or unchecked references. |
| Frozen root Bun install | Pass, no lockfile change. |
| Diagnostics registry regeneration | Pass, no generated diff, including the final regeneration after the visibility adjustment. |
| `git diff --check` | Pass. |

The affected selector was inspected for the delta from `c890e2af67`; this lane
runs the requested affected core/database/HTTP checks, not publication or the
complete client/wasm battery. The broad core all-target result is included above.

**Pre-existing unrelated inventory failure:** `node scripts/check-inventories.mjs`
again fails only `guide-manifest`: missing competitive-checkpoint
`startReply.args.schema.json`, missing todo-v2 Contract `setCompleted.mutation.ts`
and `runtime-links.ts`, and root `@expo/snapback-contract` import parity. These
are the same Snapback 1 paths recorded in `FIXROUND1.md`; expired guide-gap
warnings also remain. No generated registry update is required.

All requested work is committed without a push, stash, git-config change or
credential copy. The private cluster's recorded postmaster and its recorded
children were checked at cleanup, `pg_ctl -m fast -w stop` completed,
`postmaster.pid` is absent and no live owned PID remains. Private data is retained
under `/tmp`; no credentials or cluster state are committed. The lane's inactive
incremental build cache was removed while no compiler was active to preserve
headroom; `/home` never crossed the 60 GiB stop threshold and finishes with
about 72 GiB free.
