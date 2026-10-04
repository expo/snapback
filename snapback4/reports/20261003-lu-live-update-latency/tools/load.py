#!/usr/bin/env python3
"""Only the inherited <=16 CPU affinity; the owned keeper kills its own group on EOF."""
import os, signal, subprocess, sys
cpus = os.sched_getaffinity(0)
assert 0 < len(cpus) <= 16, f'refusing burners on {len(cpus)} CPUs'
count = int(sys.argv[1])
assert 0 <= count <= 240
# Parent starts this keeper with detached:true / setsid. Never signal a discovered PID.
children = []
try:
    for _ in range(count):
        children.append(subprocess.Popen([sys.executable, '-c', 'while True: pass'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    print('ready', flush=True)
    sys.stdin.buffer.read()
finally:
    # Reap children before leaving; all are exclusively ours and stay in our group.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    os.killpg(os.getpgrp(), signal.SIGTERM)
    for child in children:
        child.wait()
