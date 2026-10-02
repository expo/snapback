# Round 5 failure ledger

All product development failures below are **ours**. None is attributed to a
baseline or environmental exception. Logs remain alongside this ledger; early
runs are superseded by the final affected cohorts and final-source full suite.

- `check-first`: new admission walk attempted to extend references to expressions
  from boxed expressions; fixed explicit `Box::as_ref`. `check-second` passes.
- `fields-first`: incorrect test filter selected zero tests; not counted as proof.
  Two earlier shell invocations used an incorrect working directory and could
  not create their log paths; no tests ran. Both are command setup mistakes.
- `deadlines-first`: fixture omitted an immutable through key and used an invalid
  positional permit index; fixed fixture syntax/identity. Second run passes.
- `admission-first`: accepted value-filter control inferred a forbidden computed
  index. The admitted control now explicitly selects byId before filtering.
- `device-first`, `device-second`: the new full-row metadata query did not pin
  its audience group; then the test forced the wrong index. Changed the query to
  its declared conversation audience, letting the binder choose the index.
  Both runs had 12 passed / 2 failed; the focused third and final full cohort pass.
- `http-first`: the new setup fixture lacked insert authority for rooms and
  through rows. Added explicit fixture insert rules. `http-second` passes.
- `guide-first`: three failures: E_VIEW_KEY's first mention produced the wrong
  contextual excerpt and two contextual why cards exceeded 4096 bytes.
  `guide-second`: the same two card-size failures remained. Shortened redundant
  contextual explanations; `guide-third` passes all 110 guide checks and the
  ephemeral compatibility check.
- The combined `guide-third` invocation also had one compiler-test failure: a
  proposed sync syntax was not valid Quarry. Removed that invalid case; actual
  supported raw sync audiences are covered by the 220-case matrix.
- Wasm iterations 1–7 exceeded the unchanged 605225-byte cap: 606061, 605911,
  605982, 605991, 605893, 605752 and 605672 bytes gzip respectively. These are
  introduced budget failures, not acceptable landing artifacts. Shared rule
  operand binding, slice-based timeline merging, single-buffer conjunction
  flattening and the existing compact field-map collector pay for the repair.
  Iteration 8 is 605008 bytes. Final build and suite must reproduce it.
- `wasm-diff.txt` is exploratory twiggy output taken while a build was replacing
  an intermediate artifact; it is not used for a final byte or attribution claim.
- Three round-4 rollback controls deliberately fail: wasm metadata exit 1, deadline exit 101 and metadata
  exit 101. Both failure signatures were checked; all temporary source replacements
  were restored. They are expected negative controls, not final-source failures.

A final reference-check invocation was initially launched from snapback4/ rather
than the repository root. It therefore found zero LLP documents and reported
1,365 missing references. This is **our command setup error**, retained as
ref-check-wrong-cwd.log.gz, not 1,365 product defects. The root invocation passes
with 525 LLP documents, 10,079 references, zero errors and zero unchecked.

The initial staged whitespace check flagged the verbatim output of 16 Rust test
logs ending in a blank line and two space-only lines in the expected Node negative
control. This was **our evidence packaging issue**. Those 17 logs are now gzip
archives, preserving their original bytes while making the staged diff clean.

The initial measurement runner waited for an idle host while other lanes ran
CPU burners. It was deliberately stopped before any BG/LL samples or suite
started (exit 143); `initial-idle-admission.jsonl` retains the saturated-host
evidence. The driver now runs the full suite before latency measurements. This
is a scheduling change, not a failed test or discarded latency sample.

Final-source suite: `== 0 failure(s) in 1957 s`, exit 0. Every final-suite
failure: none (ours 0, baseline 0, environmental 0). All 1,789 captured source
digests are unchanged; wasm matches the measured artifact. The single completed
invocation and full counts are bound in REPORT.md and final-verification.json.
