"""Retained TF controls: build a pre-KA SDK and mutate only scratch copies."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import time

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
SCRATCH = ROOT / "target/tf-controls"
SCRATCH.mkdir(parents=True, exist_ok=True)
PACKAGE = ROOT / "packages/snapback4"
FIXTURE = "test/expired-server-watch.test.mjs"
ENV = dict(os.environ, SNAPBACK4_BIN=str(ROOT / "target/debug/snapback4"))
COMMIT = subprocess.check_output(["git", "rev-parse", "42ba3ffb90^1"], cwd=ROOT, text=True).strip()
PRE = SCRATCH / "pre-ka"
PRE.mkdir(exist_ok=True)
paths = ["src", "package.json", "tsconfig.json", "tsconfig.build.json"]
archive = subprocess.check_output(["git", "archive", COMMIT, *[
    "snapback4/packages/snapback4/" + name for name in paths]], cwd=ROOT.parent)
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
    tar.extractall(PRE, filter="data")
pre_root = PRE / "snapback4"
pre_package = pre_root / "packages/snapback4"
(pre_root / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
(pre_package / "node_modules").symlink_to(PACKAGE / "node_modules", target_is_directory=True)
shutil.copytree(PACKAGE / "src/wasm", pre_package / "src/wasm")
shutil.copytree(PACKAGE / "test/helpers", pre_package / "test/helpers")
shutil.copy2(PACKAGE / FIXTURE, pre_package / FIXTURE)
with (OUT / "pre-ka-build.log").open("wb") as log:
    subprocess.run(["bun", "run", "build"], cwd=pre_package, stdout=log, stderr=subprocess.STDOUT, check=True)

original = SCRATCH / "original-fixture"
original.mkdir()
shutil.copy2(PACKAGE / "package.json", original)
for name in ["node_modules", "dist", "src"]:
    (original / name).symlink_to(PACKAGE / name, target_is_directory=True)
shutil.copytree(PACKAGE / "test/helpers", original / "test/helpers")
(original / FIXTURE).write_bytes(subprocess.check_output([
    "git", "show", "HEAD:snapback4/packages/snapback4/" + FIXTURE], cwd=ROOT))

results = []
def run(name, package):
    started = time.time()
    command = ["node", "--test", "--test-reporter=tap", FIXTURE]
    result = subprocess.run(command, cwd=package, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    with gzip.open(OUT / (name + ".log.gz"), "wb") as log:
        log.write(result.stdout)
    counts = {key.decode(): int(value) for key, value in re.findall(
        rb"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$", result.stdout, re.M)}
    record = dict(name=name, command=command, cwd=str(package), exit=result.returncode,
                  seconds=time.time() - started, counts=counts)
    results.append(record)
    (OUT / "controls.json").write_text(json.dumps(results, indent=2) + "\n")
    print(record, flush=True)
    return result

run("original-fixture-main-sdk", original)
clean = run("pre-ka-fixed-fixture", pre_package)
assert clean.returncode == 0

local = pre_package / "dist/local.js"
work = pre_package / "dist/read-work.js"
local_text, work_text = local.read_text(), work.read_text()
needle = "Math.min(25 * 2 ** (watch.expiredRetries - 1), 1000)"
assert local_text.count(needle) == 1
try:
    local.write_text(local_text.replace(needle, needle.replace("25", "26", 1)))
    bad = run("pre-ka-delay-26", pre_package)
    assert bad.returncode != 0 and b"expiry retry doubles to the one-second cap" in bad.stdout
    assert b"actual: 26" in bad.stdout and b"expected: 25" in bad.stdout
finally:
    local.write_text(local_text)

# The unchanged count assertion must also reject an extra timer created by retry.
needle = "retry(watch, delay, run) {"
assert work_text.count(needle) == 1
try:
    work.write_text(work_text.replace(needle, needle + "\n        setTimeout(() => {}, delay);"))
    bad = run("pre-ka-duplicate-timer", pre_package)
    assert bad.returncode != 0 and b"one pending retry per watch" in bad.stdout
    assert b"actual: 2" in bad.stdout and b"expected: 1" in bad.stdout
finally:
    work.write_text(work_text)

(OUT / "control-source.json").write_text(json.dumps(dict(
    preKACommit=COMMIT, fixtureSHA256=hashlib.sha256((PACKAGE / FIXTURE).read_bytes()).hexdigest(),
    restoredLocalSHA256=hashlib.sha256(local.read_bytes()).hexdigest(),
    restoredReadWorkSHA256=hashlib.sha256(work.read_bytes()).hexdigest(),
    mutations=["expiry base delay 25 -> 26", "one additional setTimeout inside ReadWork.retry"]
), indent=2) + "\n")
