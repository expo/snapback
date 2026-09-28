# Round-5 failure ledger

The final affected checks pass. The one full-suite run returned `== 1 failure(s) in 1281 s` (exit 1,
category `cargo test`) and retains the guide failure below; it is not replaced by a second full run. There were no environmental
failures. Baseline attribution below is for intentional controls
run against main, not unrelated qualification failures.

| Class | Run / failure | Disposition |
| --- | --- | --- |
| Ours | Whole guide: `client::published::published_file_references_resolve_against_package_contents`; same failure in the full suite | Published client reference linked to repository-only issue. Removed that link; complete guide rerun passes 98/98. |
| Ours, setup | Three Python edits raised `ValueError: substring not found` | Guessed scheduler/helper/test boundaries differed; inspected actual text and completed the edit. |
| Ours, formatting | `git diff --check`: new blank line at EOF in overload test | Removed; check passes. |
| Baseline, intentional | 6 main refresh-diagnostic cases | Main fabricates terminal auth on malformed 200 and ends credentials for retryable auth. All six pass on final SDK. |
| Baseline, intentional | 36 main overload/reproduction cases, listed below | Establish the retained fixes; final overload suite passes all 109 cases, including the six main positive controls. |
| Ours, intentional | 2 round-4 replacement cases | Reproduce the discarded claim regression. Both pass against main and final SDK. |
| Ours, intentional mutation | 3 online probe-header cases | Removing only Retry-After from the new pause fails all three modes; final SDK passes. |

## Every negative-control failure

### main-refresh-diagnostics-negative — Baseline, expected

- online: refresh empty preserves the account and allows renewal
- online: refresh invalid-session preserves the account and allows renewal
- online: refresh retryable-auth preserves the account and allows renewal
- web: refresh empty preserves the account and allows renewal
- web: refresh invalid-session preserves the account and allows renewal
- web: refresh retryable-auth preserves the account and allows renewal

### main-confirmed-reproductions-negative — Baseline, expected

- public asset rotation preserves ECONNRESET without consuming another view
- public asset rotation preserves invalid without consuming another view
- public asset rotation preserves success without consuming another view
- public asset rotation preserves terminal-overload without consuming another view
- online: public ephemeral refusal preserves HTTP status and never replays
- web: public ephemeral refusal preserves HTTP status and never replays
- public fresh web schema recover retains startup cause
- public fresh web schema exhaust retains startup cause
- public fresh web schema reset retains startup cause
- public fresh web schema invalid retains startup cause
- public auth guest: invalid retains cause with one request
- public auth guest: reset retains cause with one request
- public auth guest: unreachable retains cause with one request
- public auth signup: invalid retains cause with one request
- public auth signup: reset retains cause with one request
- public auth signup: unreachable retains cause with one request
- public auth login: invalid retains cause with one request
- public auth login: reset retains cause with one request
- public auth login: unreachable retains cause with one request
- public auth refresh: invalid retains cause with one request
- public auth refresh: reset retains cause with one request
- public auth refresh: unreachable retains cause with one request
- public auth logoutAll: invalid retains cause with one request
- public auth logoutAll: reset retains cause with one request
- public auth logoutAll: unreachable retains cause with one request
- online: public probe overload recovers an offline link without adopting identity
- web: public probe overload recovers an offline link without adopting identity
- web: public sync overload recovers an offline link without adopting identity
- online: concurrent public upload retries vary beyond Retry-After
- online: concurrent public asset retries vary beyond Retry-After
- online: concurrent public query retries vary beyond Retry-After
- online: concurrent public mutation retries vary beyond Retry-After
- web: concurrent public upload retries vary beyond Retry-After
- web: concurrent public asset retries vary beyond Retry-After
- web: concurrent public query retries vary beyond Retry-After
- web: concurrent public mutation retries vary beyond Retry-After

### round4-replacement-negative — Ours, expected

- online: supplied replacement refreshes while another account is stored
- web: supplied replacement refreshes while another account is stored

### online-probe-headers-negative — Ours, expected

- public online probe recovery paces retryable and respects Retry-After
- public online probe recovery paces nonretryable and respects Retry-After
- public online probe recovery paces malformed and respects Retry-After
