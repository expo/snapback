#!/usr/bin/env python3
"""Launch foreground fresh-session M7 for a lane, same model and effort
as its continuous session: launch_m7.py <wave> <backend>.
Reads prompts/<wave>-<backend>.m7.md; cwd = the lane; writes logs/<wave>-<backend>.m7.*.
"""
import json, os, subprocess, sys, time
from pathlib import Path
from run_support import (
    ScaleOwnerCustody, enable_child_subreaper, exclusive_run_root,
    retain_codex_rollout_tree, rollout_snapshot, run_env, wait_tracked_process,
)

ROOT = Path(__file__).resolve().parent.parent
wave, backend = sys.argv[1], sys.argv[2]
RUN_ROOT_LOCK = exclusive_run_root(ROOT)
RUN_ROOT_LOCK.__enter__()
lane = ROOT / "lanes" / f"{wave}-{backend}"; logs = ROOT / "logs"; name = f"{wave}-{backend}"
prompt_path = ROOT / "prompts" / f"{name}.m7.md"
(lane / "m7").mkdir(exist_ok=True)
env = run_env()
stdin = subprocess.DEVNULL
if wave == "astra":
    cmd = ["/home/ccheever/.local/bin/codex", "exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "--json", "--color", "never",
           "-m", "gpt-6-astra", "-c", "model_reasoning_effort=medium", "-C", str(lane), "-o", str(lane / "m7" / "FINAL.md"), "-"]
    stdin = open(prompt_path); model, effort = "gpt-6-astra", "medium"
elif wave == "grok":
    cmd = [os.path.expanduser("~/.local/bin/grok"), "--prompt-file", str(prompt_path), "--cwd", str(lane), "-m", "grok-4.6", "--reasoning-effort", "xhigh",
           "--output-format", "streaming-json", "--permission-mode", "bypassPermissions", "--max-turns", "5000"]
    model, effort = "grok-4.6", "xhigh"
elif wave == "muse":
    cmd = [os.path.expanduser("~/.local/bin/muse"), "exec", "--prompt-file", str(prompt_path), "--model", "muse-spark-1.3", "--reasoning-effort", "xhigh",
           "--json", "--yolo", "--trust-workspace", "--user-input-auto-resolve", "--max-model-steps", "50000", "--workspace", str(lane)]
    model, effort = "muse-spark-1.3", "xhigh"
else:
    sys.exit("wave must be astra, grok, or muse")
out = open(logs / f"{name}.m7.ndjson", "w"); err = open(logs / f"{name}.m7.stderr.log", "w")
started = int(time.time())
rollouts_before = rollout_snapshot() if wave == "astra" else set()
# Capture the run identity and stale-terminal baseline before the fresh actor.
scale_custody = ScaleOwnerCustody(root=ROOT, lane=lane, name=f"{name}.m7")
env = scale_custody.actor_env(env)
enable_child_subreaper()
p = subprocess.Popen(cmd, stdin=stdin, stdout=out, stderr=err, cwd=lane, env=env)
scale_custody.start(p.pid)
(logs / f"{name}.m7.pid").write_text(str(p.pid))
(logs / f"{name}.m7.start.json").write_text(json.dumps({"lane": name, "phase": "m7", "pid": p.pid, "model": model, "effort": effort, "startedEpoch": started, "command": cmd, "prompt": str(prompt_path)}, indent=2) + "\n")
print(f"{name} m7 pid {p.pid}", flush=True)
wait_error = None
scale_custody_error = None
try:
    returncode, interrupted = wait_tracked_process(p)
except BaseException as error:
    wait_error = f"{type(error).__name__}: {error}"
    returncode, interrupted = p.poll() if p.poll() is not None else 125, "harness-wait-error"
finally:
    ended = int(time.time())
    try:
        scale_custody.finish(f"actor-exit:{returncode}")
    except Exception as error:
        scale_custody_error = f"{type(error).__name__}: {error}"
        if returncode == 0:
            returncode = 125
    out.close(); err.close()
    if stdin is not subprocess.DEVNULL:
        stdin.close()
native_manifest = None
native_capture_error = None
if wave == "astra":
    try:
        native_manifest = str(retain_codex_rollout_tree(
            root=ROOT, lane=lane, phase=f"{name}-m7", stdout_path=logs / f"{name}.m7.ndjson",
            before=rollouts_before, started_epoch=started, ended_epoch=ended,
        ))
    except Exception as error:
        native_capture_error = f"{type(error).__name__}: {error}"
(logs / f"{name}.m7.end.json").write_text(json.dumps({
    "lane": name, "phase": "m7", "pid": p.pid, "startedEpoch": started,
    "endedEpoch": ended, "exit": returncode, "interrupted": interrupted,
    "waitError": wait_error,
    "scaleCustody": str(scale_custody.receipt_path),
    "scaleCustodyError": scale_custody_error,
    "nativeManifest": native_manifest, "nativeCaptureError": native_capture_error,
    "nativeTreeStatus": "retained" if native_manifest else "incomplete-unavailable",
    "capBoundaryAdjudication": "unavailable-old-lightweight-runner-no-authentic-boundary-controller",
}, indent=2) + "\n")
print(f"{name} m7 exit {returncode} after {ended - started}s", flush=True)
sys.exit(returncode)
