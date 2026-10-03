#!/usr/bin/env python3
"""Run a measurement with one ordinary busy process per available logical CPU."""
import json, os, subprocess, sys, time

workers = []
try:
    for _ in os.sched_getaffinity(0):
        workers.append(subprocess.Popen([sys.executable, "-c", "while True: pass"]))
    print(json.dumps({"workers": len(workers), "pids": [w.pid for w in workers],
                      "affinity": sorted(os.sched_getaffinity(0)), "nice": os.nice(0)}), flush=True)
    time.sleep(2)
    result = subprocess.run(sys.argv[1:])
    assert all(w.poll() is None for w in workers), "a busy worker exited early"
    sys.exit(result.returncode)
finally:
    for w in workers:
        if w.poll() is None: w.terminate()
    for w in workers: w.wait()
    print(json.dumps({"reaped": len(workers)}), flush=True)
