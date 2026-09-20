"""Measure one real child, forwarding termination only to the child we own."""
import json
import os
import signal
import subprocess
import sys
import time

record, *command = sys.argv[1:]
started = time.monotonic()
child = subprocess.Popen(command)
for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, lambda signum, frame: child.send_signal(signum))
_, status, usage = os.wait4(child.pid, 0)
result = {
    "command": command,
    "pid": child.pid,
    "elapsed_ms": (time.monotonic() - started) * 1000,
    "user_seconds": usage.ru_utime,
    "system_seconds": usage.ru_stime,
    "peak_rss_bytes": usage.ru_maxrss if sys.platform == "darwin" else usage.ru_maxrss * 1024,
    "exit_status": os.waitstatus_to_exitcode(status),
}
with open(record, "w") as out:
    json.dump(result, out, indent=2)
sys.exit(0 if result["exit_status"] == -signal.SIGTERM else result["exit_status"])
