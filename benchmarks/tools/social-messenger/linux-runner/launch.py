#!/usr/bin/env python3
"""Launch one lane in the foreground under harness custody.

usage: launch.py <wave> <backend>      e.g. launch.py astra snapback2
Reads prompts/<wave>-<backend>.md, runs the wave's CLI with cwd = lanes/<wave>-<backend>,
writes logs/<wave>-<backend>.{ndjson,stderr.log,pid,start.json}.
The process is PID/start/end tracked and the Astra native rollout tree is retained.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from run_support import exclusive_run_root, retain_codex_rollout_tree, rollout_snapshot, run_env, wait_tracked_process

ROOT = Path(__file__).resolve().parent.parent
wave, backend = sys.argv[1], sys.argv[2]
# Keep custody for the actor's full lifetime. prepare.py hands its already-held
# descriptor through exec; a direct launch takes the same lock here.
RUN_ROOT_LOCK = exclusive_run_root(ROOT)
RUN_ROOT_LOCK.__enter__()
lane = ROOT / "lanes" / f"{wave}-{backend}"
prompt_path = ROOT / "prompts" / f"{wave}-{backend}.md"
logs = ROOT / "logs"
logs.mkdir(exist_ok=True)
name = f"{wave}-{backend}"
env = run_env()
stdin = subprocess.DEVNULL

if wave == "astra":
    cmd = [
        "/home/ccheever/.local/bin/codex", "exec",
        "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check",
        "--json", "--color", "never",
        "-m", "gpt-6-astra", "-c", "model_reasoning_effort=medium",
        "-C", str(lane), "-o", str(lane / "FINAL.md"), "-",
    ]
    stdin = open(prompt_path)
    model, effort = "gpt-6-astra", "medium"
elif wave == "grok":
    cmd = [
        os.path.expanduser("~/.local/bin/grok"),
        "--prompt-file", str(prompt_path), "--cwd", str(lane),
        "-m", "grok-4.6", "--reasoning-effort", "xhigh",
        "--output-format", "streaming-json", "--permission-mode", "bypassPermissions",
        "--max-turns", "5000",
    ]
    model, effort = "grok-4.6", "xhigh"
elif wave == "muse":
    cmd = [
        os.path.expanduser("~/.local/bin/muse"), "exec",
        "--prompt-file", str(prompt_path), "--model", "muse-spark-1.3",
        "--reasoning-effort", "xhigh", "--json", "--yolo", "--trust-workspace",
        "--user-input-auto-resolve", "--max-model-steps", "50000",
        "--workspace", str(lane),
    ]
    model, effort = "muse-spark-1.3", "xhigh"
else:
    sys.exit("wave must be astra, grok, or muse")

out = open(logs / f"{name}.ndjson", "w")
err = open(logs / f"{name}.stderr.log", "w")
started = int(time.time())
rollouts_before = rollout_snapshot() if wave == "astra" else set()
p = subprocess.Popen(cmd, stdin=stdin, stdout=out, stderr=err, cwd=lane, env=env)
(logs / f"{name}.pid").write_text(str(p.pid))
(logs / f"{name}.start.json").write_text(json.dumps({
    "lane": name, "pid": p.pid, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "startedEpoch": started, "command": cmd, "model": model, "effort": effort,
    "prompt": str(prompt_path), "cwd": str(lane),
}, indent=2))
print(f"{name} pid {p.pid} -> {logs / (name + '.ndjson')}", flush=True)
wait_error = None
try:
    returncode, interrupted = wait_tracked_process(p)
except BaseException as error:
    wait_error = f"{type(error).__name__}: {error}"
    returncode, interrupted = p.poll() if p.poll() is not None else 125, "harness-wait-error"
finally:
    ended = int(time.time())
    out.close(); err.close()
    if stdin is not subprocess.DEVNULL:
        stdin.close()
native_manifest = None
native_capture_error = None
if wave == "astra":
    try:
        native_manifest = str(retain_codex_rollout_tree(
            root=ROOT, lane=lane, phase=f"{name}-builder", stdout_path=logs / f"{name}.ndjson",
            before=rollouts_before, started_epoch=started, ended_epoch=ended,
        ))
    except Exception as error:
        native_capture_error = f"{type(error).__name__}: {error}"
(logs / f"{name}.end.json").write_text(json.dumps({
    "lane": name, "pid": p.pid, "startedEpoch": started, "endedEpoch": ended,
    "exit": returncode, "interrupted": interrupted, "nativeManifest": native_manifest,
    "waitError": wait_error,
    "nativeCaptureError": native_capture_error,
    "nativeTreeStatus": "retained" if native_manifest else "incomplete-unavailable",
    "capBoundaryAdjudication": "unavailable-old-lightweight-runner-no-authentic-boundary-controller",
}, indent=2) + "\n")
print(f"{name} exit {returncode} after {ended - started}s", flush=True)
sys.exit(returncode)
