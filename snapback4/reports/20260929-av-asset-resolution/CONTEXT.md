# AV context pack

Scope: `useAsset`, `client.asset`, ordinary avatar placement/retention and
home-row authorization. Engineering Snapback 4; the app is read-only evidence.
Applied the repository's `llp-orient` skill from the existing lane-wk copy
because this worktree's skill symlink points at an uninitialized submodule.

Governing documents (all named 3000 documents below are in `llp/current/`,
none in `llp/foundation/`; foundation's Snapback 1 gates do not cross this fence):

1. LLP 3000 §4 and §7: fence; one asset, one home; current home-row rule;
   no-byte-cache one-view contract and indistinguishable absent/hidden assets.
2. LLP 3000.007 §8: ordinary viewed media retention, revoked/expired home purge.
3. LLP 3000.019 §3.5: confirmed download receipt, store/cell/generation identity;
   replicated copies or a referenced id are not authority to retain bytes.
4. LLP 3000.008.002.000 §6: stable ownership and revocation for media handles;
   one-view ownership above transient lists, explicit open, no implicit retry.
5. LLP 3000.013 §6 and §13: principal/store/client custody boundaries.
6. LLP 1006: column-type and one-home rationale inherited only as adopted by
   LLP 3000, not Snapback 2's distinct carrier/decoder implementation.

Read `snapback4/AGENTS.md`, `NOT-DOING.md`, journal tail, the root/design brief,
`rules/RULES.md`, the assets/media alias card and the client media-viewer card.
The current assets card is the surface authority; the LLPs explain its choices.

Constraints: no new grant or per-observation asset scope (LLP 3000 §7);
no URL or response reuse across principals; no one-view retry (LLP
3000.008.002.000 §6); no retention without a download-confirmed live home
(LLP 3000.019 §3.5); no wasm budget increase (593,719 B gzip).

Open question: d-02's permanent-loading inference lacks a failing runtime
snapshot; the supplied pattern and frozen export resolve successfully.
The actual old-URL-on-selection-change defect is independently testable and
does not establish that inference. Update the existing handle-governing LLP,
media card and client reference, with a separate unresolved reproduction ticket.

Hand-off: none for the local patch; d-02 needs the original failing state.
