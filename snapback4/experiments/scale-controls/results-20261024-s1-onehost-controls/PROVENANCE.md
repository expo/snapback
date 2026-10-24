# S1-C source and setup custody

The requested `git fetch origin main` succeeded, but the configured origin (`ssh://ccheever@100.65.137.99/home/ccheever/projects/snapback`) returned August commit `94760a651a`, which contains no Snapback 4 source. The requested branch name was created, and then restored to the preserved S1-PG4 branch `ac624fef08` so the commissioned experiment could proceed. The prior G3b branch `41db9a6fd5` remains preserved. No remote or Git configuration was changed and nothing was pushed.

Runner implementation: `d688d6f485`; native seed/provenance/shutdown follow-up: `4cd389a4c1`; consecutive-campaign preflight repair: `b5e34d8912`. The measured matrix records its committed source and source/binary SHA-256 values. Release builds use only the owned `snapback4/target`; no workspace/all-targets build is used. The native seed helper’s offline lockfile refresh changes only `snapback4-core` 0.4.37 →0.4.38, with every third-party pin unchanged, matching S1-PG4’s documented setup repair.

Setup failures remain in the raw archive. The first raw smoke stopped before load because the local PG16.15 installation lacked pg_stat_statements. Its exact matching extension was built from checksum-verified official PostgreSQL 16.15 source and installed under the existing user-local prefix. The first Convex setup stopped before load because its cluster URL included a database path; Convex derives that path from the instance name. Removing the path admits the same private Unix link. Both failed attempts stopped and confirmed their owned processes; neither is a measured capacity trial. A locked native seed-helper build refused the stale local core version before compilation; its documented offline refresh then built successfully.

The three control smokes use one W2/link-A cell each, 100 offered/s, 10 s/20 s, all three repetitions. Independent audits retain 6,000 measured arrivals per smoke with no unknown outcomes. Native Snapback is also exercised through the shared runner as an adapter smoke; it is outside the 36 control cells. No product engine, Quarry fixture, authorization SQL, scheduler, retry/backoff, durability setting, resource ceiling or advocate tuning is modified.

The first matrix launch was refused by the bind-only port preflight immediately after native smoke cleanup. No timed control trial ran. A subsequent listener census was empty; TIME_WAIT from the stopped server is the inferred cause. The preflight now uses the same SO_REUSEADDR policy as the real HTTP listeners while still refusing an active listener. That setup failure and its stopped-process receipt remain archived separately. The complete matrix starts from `b5e34d8912`.

After every timed campaign ended, postprocessing was corrected to distinguish
busy wait samples from the final clean sample that released each cell, and to
verify all counter arithmetic independently. The new replay command list fixes
inherited two-host rerun fields without rewriting archived launch manifests.
The reusable runner now emits those correct one-host commands and restores
subprocess state/removes stopped PG data before its final disk check. These
changes are outside measured timing and preserve all data and SLO decisions.
The launch source/binary hashes, original manifests and raw failures remain
archived; the final report commit carries the corrected tooling.
