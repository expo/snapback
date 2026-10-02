#!/usr/bin/env python3
"""Record Linux host CPU utilization during a command, without changing its work."""
import json, os, subprocess, sys, threading, time
from pathlib import Path


def counters():
    values = list(map(int, Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
    return sum(values), values[3] + values[4]


def monitor():
    total, idle = counters()
    while not stopped.wait(1):
        next_total, next_idle = counters()
        delta = next_total - total
        print(json.dumps({'host_sample': time.time(),
                          'cpu_busy_percent': 100 * (1 - (next_idle - idle) / delta) if delta else 0,
                          'load': os.getloadavg()}), flush=True)
        total, idle = next_total, next_idle


stopped = threading.Event()
thread = threading.Thread(target=monitor)
print(json.dumps({'host_affinity_cpus': len(os.sched_getaffinity(0)),
                  'host_logical_cpus': os.cpu_count()}), flush=True)
thread.start()
try:
    result = subprocess.run(sys.argv[1:])
    sys.exit(result.returncode)
finally:
    stopped.set()
    thread.join()
