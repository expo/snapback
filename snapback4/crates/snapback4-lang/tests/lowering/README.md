# Baseline lowering differential

`lowering.rs` compares executed-program serialization byte for byte with
ownership recording disabled and with `ce15819ad.sha256` (one SHA-256 of each program's serialized IR, derived from the `ce15819ad` serialization so the golden stays small). It compares both
admission policies (`eligible`, `never`) and execution observations between
the two switch settings: all seven meters, results, complete refusals and
error sites. Residency policy is held fixed because §19.1 intentionally
changes it. Generated cases use two fixed rows, fixed time, entropy and ids;
census cases start empty. Each program replays the same call sequence in
both arms, including effects of earlier successful calls.

`cases.rs` generates 1,225 source bundles: GPT's exact `pick`, 0–3 early
returns in `if`, `else if` and `for`, setup before and after those returns,
condition and emit-payload setup with `and`, `or`, `??`, helpers, reads and
`new`, and source/helper nesting through depth 3. Queries omit effects and
`new`, which the language refuses. Six argument worlds and step ceilings
10, 28, 34 and 2,000 exercise the generated programs. The 740 original R1p
source bundles are pinned in `r1p-sources.jsonl`; `r1p-programs.txt` pins all
1,112 original mutation identities so none can silently disappear. The
harness also includes the census queries and bindable programs from sources
with schema diagnostics. Admission and engine refusals remain observations.

## Why the invariant is structural

`program/setup.rs`'s `Body` is an ordinary `Vec<Stmt>` plus a separate map
from setup statement paths to their owning condition or payload. `push`,
`extend`, `push_if` and `push_for` perform exactly their original operations
on the code vector. Map recording never reads back into code generation,
name allocation, type refinement or exit analysis. The baseline
`helper_returns(Vec<Stmt>, ...)` function is byte-identical to `ce15819ad`;
`helper_ownership` reads its input to remap only the side map. Embedded scan
predicate blocks and merge setup keep the baseline forms. Only after the
final `Program` exists does presence analysis read the map; admission and
execution see that same flat program. Thus erasing ownership commutes with
each lowering operation for every input, independently of the finite corpus.
The corpus guards that claim against future edits; it is not the proof of
universality.

## Golden provenance and reproduction

Generated on 2026-09-14 from the complete language crate at
`ce15819ad71bd24c9d1b9ec228c083330dee3a31`, extracted with `git archive` into
`/tmp/r2p-evidence/baseline`. All 27 Rust source files were compared byte for
byte against `git show` at that commit. No old compiler source is vendored.
The scratch manifest alone was adapted: workspace version/edition/license
made explicit, and the core dependency pointed at this lane's current core.
The workspace lockfile pinned cached dependencies. The core does not lower
Quarry; using the same core serializer and runtime isolates binder changes.
The golden pins serialized IR only; admission and runtime observations are
compared live using the switch, not frozen as historical engine behavior.

To reproduce from the repository root, set `task_root` to this checkout and
`task_scratch` to a fresh temporary directory. Extract only the old language
crate:

```sh
git archive ce15819ad71bd24c9d1b9ec228c083330dee3a31 snapback4/crates/snapback4-lang | tar -x -C "$task_scratch"
```

In its `Cargo.toml`, replace the three `.workspace = true` entries with
`version = "0.2.12"`, `edition = "2024"`, `license = "MIT"`; point
`snapback4-core` at `$task_root/snapback4/crates/snapback4-core`; append an
empty `[workspace]`. Copy `snapback4/Cargo.lock` beside it. Copy this
`lowering/` directory into its `tests/`, then copy `lowering/generate.rs` to
`tests/golden.rs`. From this checkout's `snapback4/`, run:

```sh
CARGO_TARGET_DIR="$task_scratch/target" CARGO_INCREMENTAL=0 R2P_GOLDEN_OUT="$task_scratch/ce15819ad.jsonl" cargo test --offline --manifest-path "$task_scratch/snapback4/crates/snapback4-lang/Cargo.toml" --test golden -- --nocapture
```

Use a distinct scratch target for each source revision. Sharing one target
between two extracted crates with the same package identity reused an
incremental artifact during the initial probe; the recorded baseline golden
and red regression used separate targets and `CARGO_INCREMENTAL=0`.

The generated JSONL contains 3,219 programs. The committed golden
`ce15819ad.sha256` keeps, per program, `name<TAB>sha256(record.ir)`, derived
with:

```sh
python3 -c 'import json,hashlib,sys; [print(n+"\t"+hashlib.sha256(r["ir"].encode()).hexdigest()) for n,r in map(json.loads,open(sys.argv[1]))]' "$task_scratch/ce15819ad.jsonl" > ce15819ad.sha256
```

The full JSONL (5,166,923 bytes) is not committed. Its hashes and measured comparison
counts are recorded in the dated R2p journal entry. `pick.json` is the single
program's baseline bytes, also present in the full golden. The focused
regression is red on the unmodified lane base
`56cdedba6a8ff343c8d297b246b7431824ef0241`: it emits two fewer guards and costs
28/20 steps for `stop=false/true`, versus the baseline's 34/26.

LLP 3000.013 positional-key migration (2026-09-24): the frozen 740 bundle
identities remain fixed. Ambiguous positional keys now name their historical
columns; non-unique scans explicitly name the historical declared index. Four
`! else` refusal sites move right when named columns are inserted:
`3057aa…:probe` 13:33 → 13:37, `a56271…:push` 124:30 → 124:42,
`b9c841…:clique-relaxed.push` 124:30 → 124:42, and `eaabe4…:scalar`
36:20 → 36:26. Their four digests are updated for exactly those `Require.site`
strings. Comparing the old compiler on the original inputs against the new
compiler on migrated inputs found no other IR difference for those bundles.
The new optional merge fields serialize absent on every historical merge.

LLP 3000.013 Lane K shape replacement (2026-09-24): six frozen census
programs now compile because a field following `*` replaces its inherited
column (including a bare column selecting itself). Their new IR digests live
in `intent-shape-overrides.sha256`; every historical digest and every census
input stays unchanged. The ownership-on/off differential includes these six
programs, with the same admission and execution/meter comparisons. Generate
the current compiler's records with `generate.rs`, keep identities absent
from the historical golden, clear `Program.returned_shapes` as `lowering.rs`
does, and hash the serialized IR. The six sources are the small `messages`
`history`/`repair-shape.history` projections, not previously accepted programs.

LLP 3000.013 Lane P review closure (2026-09-24): alternate-key delete now
lowers directly to `DeleteTarget`. The generated public `Get` previously
charged expired siblings before read/delete authority and disclosed a hidden
backlog through `E_BOUND`. The engine-private replacement retains both gates,
accumulates work privately, and charges only after authority. Sixteen frozen
program digests change (the alternate-key `leave` programs, `probe`, and
`writeForms`); their source identities and the 3,219-program census stay fixed.
The pre-fix binder reproduced all 3,219 existing hashes. Recursive comparison
of the old and new JSON proved that each difference is exactly one
`Let(Get)` / `Require NOT_FOUND` / `Delete` triple replaced by `DeleteTarget`
with the identical table, index, key, provenance and lookup site; no other IR
changed. Only those 16 digests were updated. Ownership-on/off IR, admission,
results, all meters and refusal comparisons remain enforced without exclusions.
