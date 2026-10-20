#!/usr/bin/env python3
"""Run an S1a block, preserving every attempt and rejecting load > 8.

Usage: python3 scripts/s1a.py NEW_RESULTS_DIR raw|execution|commit|sqlite|ping
Each repetition is a measurement block; uptime and vmstat 1 5 bracket it.
Three independent repetitions per setting are summarized by tables.py.
Existing attempt files are never overwritten. Re-running the
command skips accepted settings and retries rejected ones in NEW files.
NETS and CP_* may select RTTs and timing; defaults match the S0 timer.
"""
import itertools
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent.parent
BIN = HERE / "target/release/snapback4-postgres-commit-path"


def cells(block):
    nets = os.environ.get("NETS", "rtt200 rtt500 rtt1000").split()
    if block == "raw":
        for net, keys in itertools.product(nets, ["disjoint", "hot1"]):
            yield ["raw", "--net", net, "--writers", "32", "--counters", keys]
    elif block == "execution":
        for net, c in itertools.product(nets, [8, 16, 32, 64]):
            yield ["pg-execution", "--net", net, "--connections", str(c)]
    elif block == "commit":
        for net, fraction, n in itertools.product(nets, [0, 10, 30], [1, 4, 16, 64]):
            yield ["model", "--protocol", "A", "--net", net, "--counters", "disjoint",
                   "--batch", str(n), "--full-writes", "--non-head-pct", str(fraction)]
    elif block == "sqlite":
        scratch = os.environ["SQLITE_DIR"]
        for c in [1, 4, 16, 32]:
            yield ["sqlite-execution", "--threads", str(c), "--dir", scratch]
        for n in [1, 4, 16, 64]:
            yield ["sqlite-commit", "--batch", str(n), "--dir", scratch]
    elif block == "ping":
        for net in ["unix", "tcp", "rtt0"] + nets:
            yield ["ping", "--net", net, "--n", "3000"]
    else:
        raise ValueError(block)


def snapshot(path):
    with path.open("x") as out:
        subprocess.run(["date", "-u", "+%FT%TZ"], stdout=out, check=True)
        subprocess.run(["uptime"], stdout=out, check=True)
        subprocess.run(["vmstat", "1", "5"], stdout=out, check=True)


def run(out, block, number, args):
    prefix = f"{block}-{number}"
    previous = sorted(out.glob(prefix + "-*.json"))
    if any(json.loads(p.read_text()).get("accepted") for p in previous):
        return
    attempt = len(previous) + 1
    while True:
        # Leave headroom for the S0 proxy's own spinning forwarding threads.
        while os.getloadavg()[0] > 6:
            print(f"waiting for starting load <= 6: {os.getloadavg()[0]:.2f}", flush=True)
            time.sleep(30)
        name = f"{prefix}-{attempt:02d}"
        snapshot(out / (name + ".before.txt"))
        loads = [os.getloadavg()[0]]
        started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with (out / (name + ".stdout")).open("x") as stdout, (out / (name + ".stderr")).open("x") as stderr:
            process = subprocess.Popen([str(BIN)] + args, stdout=stdout, stderr=stderr)
            while process.poll() is None:
                loads.append(os.getloadavg()[0])
                time.sleep(1)
        loads.append(os.getloadavg()[0])
        snapshot(out / (name + ".after.txt"))
        loads.append(os.getloadavg()[0])
        try:
            result = json.loads((out / (name + ".stdout")).read_text())
        except ValueError:
            result = {"cell": "crashed"}
        quiet = max(loads) <= 8
        record = {"started": started, "argv": args, "exit_status": process.returncode,
                  "load_samples_1s": loads, "max_load": max(loads), "load_qualified": quiet,
                  "accepted": quiet, "result": result}
        (out / (name + ".json")).write_text(json.dumps(record) + "\n")
        print(f"{name}: exit {process.returncode}, max load {max(loads):.2f}, "
              f"{'accepted' if quiet else 'REJECTED; rerunning'}: {' '.join(args)}", flush=True)
        if quiet:
            # Product failures are retained as failed cells, never retried
            # for success. Only environmental load rejection triggers reruns.
            return
        attempt += 1


if __name__ == "__main__":
    destination = Path(sys.argv[1]).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    for number, args in enumerate(cells(sys.argv[2])):
        if sys.argv[2] == "ping":
            run(destination, sys.argv[2], f"{number:02d}", args)
        else:
            for repeat in range(3):
                run(destination, sys.argv[2], f"{number:02d}-r{repeat}", args + ["--runs", "1"])
