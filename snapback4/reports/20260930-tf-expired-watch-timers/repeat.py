"""Retained TF repetition command: python3 reports/.../repeat.py from snapback4/."""
import concurrent.futures
import gzip
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
TEST = "packages/snapback4/test/expired-server-watch.test.mjs"
CPUS = sorted(os.sched_getaffinity(0))[:10]
assert len(CPUS) == 10
PIN = ["taskset", "-c", ",".join(map(str, CPUS))]


def run_one(kind, index):
    command = ([] if kind == "unconfined" else PIN) + [
        "node", "--test", "--test-reporter=tap", TEST]
    started = time.time()
    before = os.getloadavg()
    log = OUT / f"{kind}-{index:02}.log.gz"
    with subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, start_new_session=True) as child:
        timed_out = False
        try:
            output, _ = child.communicate(timeout=120)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(child.pid, signal.SIGKILL)
            output, _ = child.communicate()
        with gzip.open(log, "wb") as target:
            target.write(output)
        counts = {key.decode(): int(value) for key, value in re.findall(
            rb"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$", output, re.M)}
        result = dict(kind=kind, index=index, command=command, pid=child.pid,
                      started=started, seconds=time.time() - started,
                      exit=child.returncode, timedOut=timed_out, counts=counts,
                      loadBefore=before, loadAfter=os.getloadavg(), log=log.name)
        result["ok"] = (child.returncode == 0 and not timed_out and counts == {
            "tests": 12, "pass": 12, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0})
    (OUT / f"{kind}-{index:02}.json").write_text(json.dumps(result, indent=2) + "\n")
    print(f"{kind} {index:02}: {'PASS' if result['ok'] else 'FAIL'} {result['seconds']:.2f}s", flush=True)
    return result


def ticks(child):
    fields = Path(f"/proc/{child.pid}/stat").read_text().split()
    return int(fields[13]) + int(fields[14])


host = dict(hostname=socket.gethostname(), affinity=sorted(os.sched_getaffinity(0)),
            pinnedCpus=CPUS, node=subprocess.check_output(["node", "--version"], text=True).strip(),
            started=time.time(), unconfinedWorkers=5, loadedWorkers=1,
            loadProcesses=10, clockTicks=os.sysconf("SC_CLK_TCK"))
(OUT / "repetition-host.json").write_text(json.dumps(host, indent=2) + "\n")
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    results = list(pool.map(lambda n: run_one("unconfined", n), range(1, 51)))

# Continuous CPU work shares exactly the same ten CPUs as each loaded test and
# its servers. Retain PID and CPU-time evidence; only terminate our own children.
burners = []
try:
    for _ in range(10):
        burners.append(subprocess.Popen(PIN + [sys.executable, "-c", "while True: pass"]))
    load_start = time.time()
    before = [ticks(child) for child in burners]
    for index in range(1, 21):
        assert all(child.poll() is None for child in burners)
        results.append(run_one("loaded", index))
    load = dict(started=load_start, seconds=time.time() - load_start,
                workers=[dict(pid=child.pid, affinity=sorted(os.sched_getaffinity(child.pid)),
                              ticksBefore=start, ticksAfter=ticks(child))
                         for child, start in zip(burners, before)])
    (OUT / "load.json").write_text(json.dumps(load, indent=2) + "\n")
finally:
    for child in burners:
        child.terminate()
    for child in burners:
        child.wait()

(OUT / "repetitions.json").write_text(json.dumps(results, indent=2) + "\n")
print(f"TOTAL {sum(r['ok'] for r in results)}/{len(results)}", flush=True)
sys.exit(0 if all(result["ok"] for result in results) else 1)
