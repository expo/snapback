# NP-mac round 7 context

Scope: strict smoke-helper types, the restored-session application test's launch
fixture, preparation output resolution and snapshot-source custody coverage.
Read prompts/reports from rounds 0–6, the round-6 Astra review and supervisor's
Linux failure record, Snapback 4's fence/NOT-DOING/journal, and the witness card.
The first operation fetched and merged origin/main b9a4051494 without conflicts,
producing 209c6ebebb. The only new main file was the Node 26 evaluation ticket;
the earlier lane merge already carried PQ, AV and WK.

Governing LLPs (all in current, none in foundation):

- LLP 3000#1 and #4: Snapback 4 fence and lane ownership.
- LLP 2000.000#12: scoped, measured verification; no extra standing gates.
- LLP 3000.030#3, #6 and #11: private own-build preparation, source and receipt
  custody, full native lifecycle. Repack remains withdrawn.
- LLP 3000.011.005.000#2: compiler facts from the served generation, checked
  against the kept backend before querying; smoke follows the published client.

Active constraints: do not weaken smoke classification or session-replacement
assertions (LLP 3000.011.005.000#2); preserve immutable preparation receipts and
refuse unsupported output destinations (LLP 3000.030#3). The new snapshot test
must detect removal of the existing guard, not introduce an alternate producer.

Rationale: a validated fact is retained alongside its program so strict indexed
access and runtime validation agree. Filesystem traversal follows a link before
applying a following parent component; outputs must be checked at that destination.
The preparation threat model is hygiene for well-behaved projects: Pods and build
phases execute with user privileges, so these audits do not provide a sandbox.

Host rules: pinned Mac Node/Bun/Rust PATH and explicit DEVELOPER_DIR; all written
files under sb4-np/np-stage0 or owned simulator data; only a newly created UDID and
recorded owned PIDs/groups; no system/keychain/Xcode-selection changes, provider
secret files, push or publication. Linux checks use a separate worktree under
~/sb4-np on expo-build-1000, copied warm artifacts and its existing Node 24 runtime.
No other lane's worktree or build artifacts are modified.

Open risks: full client integration, real Xcode path resolution and the snapshot
guard's mutation coverage must be checked. No broader native/toolchain or security
qualification is inferred. Existing @refs still describe the changed code.

Doc updates: existing LLP 3000.030, this report and one append-only journal entry.
Hand-off: none; fixes, regressions and checks are directly commissioned.
