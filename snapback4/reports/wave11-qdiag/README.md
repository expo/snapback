# Wave 11 QDIAG qualification

`before.json` checks read-only copies of all 100 final schema directories at
498f8110f9 (0.4.27 plus PAGE3); `after.json` checks the same inputs with final
QDIAG. `census.json` gives every note-code count: 335→326 notes, 100/100
successes both times, zero newly refused schemas. Reference checks 10→4,
sparse filters 10→9, unreadable probes 11→9. Input evidence lanes were never
modified. Four reference notes remain on actually unchecked arguments.

`native/report.json` and `lean/report.json` are final seed-0, 1000-case,
four-worker campaigns at 26ee2cbad0. `signature-comparison.json` compares
against the Integration 9 historical baseline. Native has no disagreements;
Lean has 769 pass / 221 unsupported / 10 historical next/no-next occurrences;
no new signatures or unexpected refusals. The later e9544ba528 diagnostics
change no IR, admission, reservation or wire; its affected tests pass.

`public-rule.json` pins the current privacy-preserving ambiguity message;
the earlier MP reproduction artifact remains intact as historical evidence.

The semantic amendment was mutually-blind READY from Muse and fresh Codex at
41ad0a2a5e. Verbatim rounds and final shared author brief: llp/reviews. See the
worktree's WORKSTREAM-REPORT.md for per-item commits, full/affected checks,
wasm measurement + exactly 500 B and independent root Snapback 1 prerequisites.
