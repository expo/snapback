# BN round 4 failure ledger

- **Expected detecting failure (ours, round 3 regression):**
  [round3-rust-control.log](round3-rust-control.log), exit **101**. The new
  test failed with the unchanged round 3 lookup mapping moved into a callable
  helper. Timeout, interruption, simulator nonzero exits (unavailable and
  missing-app fixtures), and spawn failure all became E_WITNESS_APP. The
  successful lookup control passed. [Exact pre-fix extraction/test patch](round3-test-extraction.patch).
- **Incoming-main integration failures (2):** the complete Node witness run
  passed 77/79. `more-then-drop` records four sync attempts versus five at the
  proxy; `dropped-first` records three versus four. The unchanged recorder does
  not see KA's internal reused-socket retry. Both cases still fail their proofs;
  attempt evidence is incomplete. The focused final-transport run repeats both
  failures; substituting only round 3's transport passes both. See REPORT.md,
  witness-node.log/exit, merged-transport-focused.log/exit and
  round3-transport-focused.log/exit. Left unmodified under the narrow scope.
- Final Rust witness units, portable integration, guide, CLI build, SDK build
  and reference validation passed. No unexpected failure attributable to the
  round 4 timeout fix occurred.
- Read-only discovery commands initially tried nonexistent subprocess.rs,
  process.rs, witness.rs guide and witness-simctl glob paths; corrected by
  listing scoped source files. The optional fleet file was absent on this
  Linux host; no remote operation was attempted. A git-config query returned
  1 because core.hooksPath was unset. These were command/discovery mistakes,
  not product or test failures.
- The requested merge had one append-only journal conflict. Both histories
  were preserved. No code conflict resolution was necessary.
- Initial staged whitespace validation flagged git-show indentation in merge.txt
  and blank context lines in the detecting patch. Stripped the metadata's
  trailing whitespace and regenerated the same patch with zero context
  (`git apply --unidiff-zero`); final validation passes. Test logs normalize
  trailing whitespace only, preserving results and failures.

Unexpected test failures: ours **0**, inherited main/integration **2**,
environmental **0**. Full suite deliberately not run under round 4's instruction.
Existing Rust builds emit the inherited tiny_http dead-code warning; it did not
fail a check.
