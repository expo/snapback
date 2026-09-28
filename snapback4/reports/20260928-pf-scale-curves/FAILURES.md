# Failure index

The first full suite's Rust executables were built from the production tree and existing tests identical to main `ddf317b139a9fa97a1dd61b21afd021a62ec1054`. Each existing device failure below reproduced when run alone, serially, from the suite's same test executable. They predate PF’s storage change.

| Existing Rust test | Class | Serial exit |
| --- | --- | ---: |
| `snapback4-device::device::search_global::forms::memory::cases::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::forms::memory::cases::w13e_grouped_cut_continues_through_9000_memberships` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::forms::sqlite::cases::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::forms::memory::cases::w13e_dense_500` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::forms::sqlite::cases::w13e_grouped_cut_continues_through_9000_memberships` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::forms::sqlite::cases::w13e_dense_500` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::lazy::memory::cases::w13f_dense_500` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::forms::memory::cases::w13e_newest_measures_complete_page_and_opening_envelope` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::forms::memory::cases::w13e_dense_1000` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::forms::sqlite::cases::w13e_dense_1000` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_dense_500` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::lazy::memory::cases::w13f_clique_every_row_hits_in_1000_lanes` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::lazy::memory::cases::w13f_dense_1000` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::forms::sqlite::cases::w13e_newest_measures_complete_page_and_opening_envelope` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_clique_every_row_hits_in_1000_lanes` | Baseline on this host | 101 |
| `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_dense_1000` | Baseline on this host | 101 |

Additional failures / corrections:

- **Ours, corrected formatting:** the staged diff check caught Matplotlib SVG trailing spaces, CSV CRLF endings, and an extra Markdown EOF line. The artifacts and their producer now use clean whitespace.

- **Ours, corrected:** the added SQL-kind counters initially borrowed a moved trace statement (E0382). The counter helper now borrows it; both regressions pass.
- **Ours, corrected:** initial regression compile needed an explicit iterator result type (E0283); fixed by passing the iterator directly.
- **Ours, corrected:** the first regression fixture omitted the immutable reference/target columns required for recorded aggregate paths. Both tests initially refused to compile the fixture; declarations now match the builder.
- **Ours, corrected setup:** the first client build preceded the wasm build and could not find generated wasm declarations. Built wasm, then rebuilt the client successfully.
- **Ours, corrected setup:** the serial confirmation launcher first assumed only one executable named `device-*`; there were two targets. It now selects the executable by its listed test inventory.
- **Ours, intentional negative control:** an extra unmetered `SUM(length(data)) FROM r` in a copied test fixture makes both tests fail the zero-fullscan assertion (124 and 1,110 fullscan steps). Product and normal test sources were unchanged.
- **Environmental input layout, resolved:** the supplied instrument symlink points to a missing macOS path. The repository fixture hash matches exactly; it was used read-only. The local LLP skill submodule was initially unpopulated and was initialized inside this worktree. The documented fleet file is absent on this host; no remote dispatch was needed.
- **Baseline measurement failures:** the original calibration midpoint failures and every before/after midpoint miss are reported without changing the ceiling; see `summary.json` for each verdict.

Final full suite: `== 1 failure(s) in 1335 s` (`cargo test`). The final Rust
failure set equals the 16 names above exactly; every one is baseline on this
host. Client tests passed 4,366/4,366 with 10 skipped; all 79 model tests passed.
No additional or unresolved introduced test failure. No environmental test
failure. The original full run reported `== 1 failure(s) in 2159 s`, also the
same Rust failures. See the two complete logs and `rust-failure-comparison.json`.
