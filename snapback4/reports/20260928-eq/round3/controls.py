#!/usr/bin/env python3
"""Run from any cwd; mutate only a private source copy, then qualify the lane."""
import difflib
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

REPORT = Path(__file__).resolve().parent
WORKSPACE = REPORT.parents[2]
REPO = WORKSPACE.parent
SCRATCH = WORKSPACE / ".work/round3-controls"
RESULTS = []
ENV = dict(os.environ, CARGO_BUILD_JOBS="8", CARGO_INCREMENTAL="0",
           CARGO_PROFILE_DEV_DEBUG="0", CARGO_PROFILE_TEST_DEBUG="0",
           RUST_TEST_THREADS="8", LIBSQLITE3_FLAGS="-USQLITE_ENABLE_MEMORY_MANAGEMENT")
ENV.pop("EQ_MINT_BASELINE", None)
LANG = ["cargo", "test", "--locked", "-p", "snapback4-lang"]
EQ = ["--test", "selected_prefix", "--test", "selected_prefix_regressions",
      "--test", "selected_prefix_cursors", "--no-fail-fast"]
COMPOSITE = "baseline_minted_composite_unfinished_shape"
OR_TEST = "disjunction_stays_residual_and_returns_rows_from_both_arms"
INTENT = Path("crates/snapback4-lang/src/bind/intent.rs")
READ = Path("crates/snapback4-core/src/engine/read.rs")
FIXTURES = Path("crates/snapback4-lang/tests/fixtures")


def run(name, command, cwd, *, mint=False, failed=()):
    env = dict(ENV)
    # Different source roots must not share compiled package fingerprints.
    env["CARGO_TARGET_DIR"] = str(cwd / "target")
    if mint:
        env["EQ_MINT_BASELINE"] = "1"
    started = time.time()
    log = REPORT / f"{name}.log"
    print(f"RUN {name}: {' '.join(command)}", flush=True)
    with log.open("wb") as out:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=out, stderr=subprocess.STDOUT)
    raw = log.read_bytes()
    text = raw.decode()
    (REPORT / f"{name}.log.gz").write_bytes(gzip.compress(raw, mtime=0))
    log.unlink()
    summaries = [line for line in text.splitlines() if line.startswith("test result:")]
    RESULTS.append(dict(name=name, command=command, cwd=str(cwd), mint=mint,
                        exit=result.returncode, seconds=round(time.time() - started, 3),
                        summaries=summaries, log_sha256=hashlib.sha256(raw).hexdigest()))
    (REPORT / "tests.json").write_text(json.dumps(RESULTS, indent=2) + "\n")
    print(f"{name}: exit {result.returncode}; {'; '.join(summaries)}", flush=True)
    if failed:
        actual = {line.split()[1] for line in text.splitlines()
                  if line.startswith("test ") and line.endswith(" ... FAILED")}
        assert result.returncode == 101 and actual == set(failed), text
    else:
        assert result.returncode == 0, f"STOP: unexpected failure in {name}; see its log"
    return text


def change(path, before, after, name):
    text = path.read_text()
    assert text.count(before) == 1, (name, "mutation anchor is not unique")
    changed = text.replace(before, after)
    patch = "".join(difflib.unified_diff(
        text.splitlines(True), changed.splitlines(True),
        fromfile=str(path.relative_to(SCRATCH)), tofile=str(path.relative_to(SCRATCH))))
    (REPORT / f"{name}.patch.gz").write_bytes(gzip.compress(patch.encode(), mtime=0))
    path.write_text(changed)


def check_shape_failure(text):
    failures = [line for line in text.splitlines() if "called `Result::unwrap_err()` on an `Ok` value" in line]
    assert len(failures) == 2
    for line in failures:
        assert all(field in line for field in ["data: Array([])", "complete: false", "cut: Some(Meter)", "next: Some("])


def split_or_control():
    path = SCRATCH / INTENT
    original = path.read_bytes()
    try:
        before = 'if let Expr::Binary { op, left, right, .. } = &value && op == "and" { split(*left.clone(), out); split(*right.clone(), out); }'
        change(path, before, before.replace('op == "and"', '(op == "and" || op == "or")'), "mutation-split-or")
        text = run("mutation-split-or", LANG + ["--test", "selected_prefix_regressions", "--no-fail-fast", OR_TEST], SCRATCH, failed=[OR_TEST])
        assert "neither disjunct may become a required pin" in text
    finally:
        path.write_bytes(original)


def qualify():
    # Fresh builds select the real workspace paths after the isolated mutations.
    run("final-eq-guide", LANG + EQ + ["--test", "guide"], WORKSPACE)
    run("server-continuation", ["cargo", "test", "--locked", "-p", "snapback4-sim", "--test", "clique", "--no-fail-fast", "merge_continuation"], WORKSPACE)
    run("device-continuation", ["cargo", "test", "--locked", "-p", "snapback4-device", "--test", "device", "--no-fail-fast", "merge_continuation"], WORKSPACE)


def main():
    SCRATCH.mkdir(parents=True, exist_ok=False)
    # Only tracked build inputs, plus the new tests/fixtures; no other worktree.
    tracked = subprocess.check_output(["git", "ls-files", "-z", "snapback4"], cwd=REPO).decode().split("\0")
    for name in filter(None, tracked):
        relative = Path(name).relative_to("snapback4")
        if relative.parts[0] in {"crates", "vendor"} or str(relative) in {
            "Cargo.toml", "Cargo.lock", "experiments/p19-one-query/builder.q",
            "experiments/p19-one-query/equality/builder.q",
        }:
            dest = SCRATCH / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / name, dest)
    for direction in ["first", "last"]:
        shutil.copyfile(WORKSPACE / FIXTURES / f"selected-prefix-shape-composite-{direction}.json",
                        SCRATCH / FIXTURES / f"selected-prefix-shape-composite-{direction}.json")
    originals = {p: (WORKSPACE / p).read_bytes() for p in [INTENT, READ]}
    try:
        # Restore only the pre-EQ selected-index path, keeping runtime unchanged.
        change(SCRATCH / INTENT, "            if !rule { self.selected_prefix(table, read); }\n", "", "mint-baseline")
        run("mint-baseline", LANG + ["--test", "selected_prefix_cursors", "--no-fail-fast", COMPOSITE], SCRATCH, mint=True)
        (SCRATCH / INTENT).write_bytes(originals[INTENT])
        hashes = {}
        for direction in ["first", "last"]:
            path = FIXTURES / f"selected-prefix-shape-composite-{direction}.json"
            shutil.copyfile(SCRATCH / path, WORKSPACE / path)
            hashes[str(path)] = hashlib.sha256((WORKSPACE / path).read_bytes()).hexdigest()
        (REPORT / "fixtures.json").write_text(json.dumps(hashes, indent=2) + "\n")
        run("unmutated-eq", LANG + EQ, SCRATCH)

        block = '''                            position.suffix = Self::cursor_suffix(table, index, scan.prefix.len());
                            position.scope.as_mut().unwrap().prefix = prefix.to_vec();
                            token = encode_cursor(self.schema, &position)
                                .map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
'''
        change(SCRATCH / READ, block,
               "                            if removed == 1 {\n" +
               "".join("    " + line for line in block.splitlines(True)) +
               "                            }\n", "mutation-one-column-shape")
        text = run("mutation-one-column-shape", LANG + EQ, SCRATCH, failed=[
            f"{COMPOSITE}_{direction}_refuses_without_an_extra_retry" for direction in ["first", "last"]])
        check_shape_failure(text)
        (SCRATCH / READ).write_bytes(originals[READ])
        split_or_control()
    finally:
        for path, data in originals.items():
            (SCRATCH / path).write_bytes(data)
            assert (WORKSPACE / path).read_bytes() == data, f"lane source changed: {path}"
    qualify()


if __name__ == "__main__":
    main()
