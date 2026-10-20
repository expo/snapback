#!/usr/bin/env python3
"""Run an S1a block, preserving every attempt and rejecting load > 8.

Usage: python3 scripts/s1a.py NEW_RESULTS_DIR raw|execution|commit|sqlite|ping|all
Each repetition is a measurement block; uptime and vmstat 1 5 bracket it.
Three repetitions per setting are summarized by tables.py. The PG commit
stage keeps S0's three runs on one namespace (cold FK plan in the first).
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


def run(out, block, number, args, gate=6, wait=True):
    prefix = f"{block}-{number}"
    previous = sorted(out.glob(prefix + "-*.json"))
    if any(json.loads(p.read_text()).get("accepted") for p in previous):
        return True
    attempts = [int(p.name.split(".")[0].rsplit("-",1)[1]) for p in out.glob(prefix + "-*.before.txt")]
    attempt = max(attempts, default=0) + 1
    while True:
        # Leave headroom for the S0 proxy's own spinning forwarding threads.
        while os.getloadavg()[0] > gate:
            if not wait:
                return False
            print(f"waiting for starting load <= {gate}: {os.getloadavg()[0]:.2f}", flush=True)
            time.sleep(5)
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
                  "accepted": quiet, "starting_load_gate": gate, "result": result}
        with (out / (name + ".json")).open("x") as record_file:
            record_file.write(json.dumps(record) + "\n")
        print(f"{name}: exit {process.returncode}, max load {max(loads):.2f}, "
              f"{'accepted' if quiet else 'REJECTED; rerunning'}: {' '.join(args)}", flush=True)
        if quiet:
            # Product failures are retained as failed cells, never retried
            # for success. Only environmental load rejection triggers reruns.
            return True
        if not wait:
            return False
        attempt += 1
        gate = max(2, gate - 0.5)



def tasks(block):
    for number, args in enumerate(cells(block)):
        if block in ("ping", "commit"):
            yield block, f"{number:02d}", args
        else:
            for repeat in range(3):
                yield block, f"{number:02d}-r{repeat}", args + ["--runs", "1"]


def starting_gate(args):
    # Headroom affects scheduling only. Acceptance always requires max <= 8.
    if args[0] == "sqlite-execution":
        threads = int(args[args.index("--threads")+1])
        return 5 if threads == 32 else 6 if threads == 16 else 7
    if args[0] == "pg-execution":
        c = int(args[args.index("--connections")+1])
        net = args[args.index("--net")+1]
        return 5 if c == 64 and net == "rtt200" else 6 if c >= 32 else 7
    if args[0] == "raw" and "rtt200" in args:
        return 6
    return 7


def effective_gate(out, task):
    block, number, args = task
    rejected = 0
    for path in out.glob(f"{block}-{number}-*.json"):
        record = json.loads(path.read_text())
        if not record.get("load_qualified", False) and not record.get("interrupted"):
            rejected += 1
    # Retrying a load rejection is useful only with more starting headroom.
    # No product parameter, timeout, retry budget or measured window changes.
    return max(2, starting_gate(args) - 0.5 * rejected)


if __name__ == "__main__":
    destination = Path(sys.argv[1]).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    if sys.argv[2] != "all":
        for block, number, args in tasks(sys.argv[2]):
            run(destination, block, number, args, gate=effective_gate(destination,(block,number,args)))
    else:
        pending = []
        for block in ("raw", "execution", "commit", "sqlite"):
            for task in tasks(block):
                b, number, args = task
                if not any(json.loads(p.read_text()).get("accepted") for p in destination.glob(f"{b}-{number}-*.json")):
                    pending.append(task)
        # One subprocess at a time. Spend quiet gaps on the cells needing
        # most headroom; among those, prioritize the 0.5 ms decision cells.
        pending.sort(key=lambda t: (starting_gate(t[2]), 0 if "rtt500" in t[2] else 1, t[0], t[1]))
        while pending:
            eligible = [task for task in pending if os.getloadavg()[0] <= effective_gate(destination,task)]
            if not eligible:
                print(f"waiting for load headroom: {os.getloadavg()[0]:.2f}; {len(pending)} blocks remain", flush=True)
                time.sleep(5)
                continue
            task = eligible[0]
            if run(destination, *task, gate=effective_gate(destination,task), wait=False):
                pending.remove(task)
