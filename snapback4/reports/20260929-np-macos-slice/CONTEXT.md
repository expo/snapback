# NP-mac round 0 context

Scope: LLP 3000.030 §11, witness preparation/lifecycle, Expo witness helper,
and the copied cal25 subject. `main` merged first without conflicts; includes
the LV revert and SQ measurements. No core, contract, wasm or publication work.

Applied `llp-orient` from vendor/llp at 5dd8a033c125e95ccc2536e734afdc924de7d094.
The initially uninitialized submodule was initialized in this worktree.

Governing constraints: LLP 3000#4 (independent fence), LLP 3000.030#3–6 and #11
(own snapshot, bounded preparation, input equality, actual native startup,
non-GUI direct launch, immutable provenance, controls), LLP 3000.007#20.10
(existing receipt/ownership protocol), LLP 3000.019#3.4 (store ownership),
LLP 3000.011.005.000#2 and #5 (real app and smoke limits). Rationale:
LLP 2000.000#12 (short measured loop). The user explicitly commissions the
implementation, report, scoped tests and local commit, with no push/publication.

Likely doc updates: witness card, package READMEs, LLP 3000.030 measurements,
and one append-only journal entry. No new universal gate or claim of full M6/M8.
Both round-0 and both round-1 review copies supplied under `~/sb4-np/reviews/`
were read in full. Their hashes are in `reviews.json`. The original stage-0
script and logs are locally available. Round-1 corrections adopted: exclude
linked expo-updates from both routes, preserve native identity with
`--js-bundle-only` in the experiment, stable private snapshot and project lease,
and fence legacy m6/m8 artifact names. The commissioned owner/port controls
remain required despite the Grok suggestion to drop them.
