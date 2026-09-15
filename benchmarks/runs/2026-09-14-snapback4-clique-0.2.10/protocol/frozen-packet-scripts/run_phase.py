#!/usr/bin/env python3
"""Run one builder, holistic score, grade, or M7 session in the foreground.

usage: run_phase.py builder|score|grade|m7 astra|grok|muse
"""

import fcntl
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PENDING = "PENDING_PUBLISHED_FIXED_PIN"
EXPO_PENDING = "PENDING_PUBLISHED_EXPO_PIN"
NODE_BIN = Path.home() / ".volta/tools/image/node/24.18.0/bin"
CODEX = Path.home() / ".volta/bin/codex"
GROK = Path.home() / ".local/bin/grok"
MUSE = Path.home() / ".local/bin/muse"
CLAUDE = Path.home() / ".local/bin/claude"
MODELS = {
    "astra": ("gpt-6-astra", "medium"),
    "grok": ("grok-4.6", "xhigh"),
    "muse": ("muse-spark-1.3", "xhigh"),
}


def completed(path: Path) -> bool:
    return path.is_file() and json.loads(path.read_text()).get("exitCode") == 0

if len(sys.argv) != 3 or sys.argv[1] not in {"builder", "score", "grade", "m7"} or sys.argv[2] not in MODELS:
    raise SystemExit(__doc__)
phase, wave = sys.argv[1:]
version = (ROOT / "SNAPBACK4_VERSION").read_text().strip()
expo_version = (ROOT / "SNAPBACK4_EXPO_VERSION").read_text().strip()
semver = r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?"
if version == PENDING or not re.fullmatch(semver, version):
    raise SystemExit("set SNAPBACK4_VERSION to the exact published fixed pin, then run scripts/render.py")
if expo_version == EXPO_PENDING or not re.fullmatch(semver, expo_version):
    raise SystemExit("set SNAPBACK4_EXPO_VERSION to the exact published Expo pin, then run scripts/render.py")

lane = ROOT / "lanes" / f"{wave}-snapback4"
logs = ROOT / "logs"
tag = "" if phase == "builder" else f".{phase}"
name = f"{wave}-snapback4{tag}"
prompt = ROOT / "prompts" / f"{name}.md"
prompt_text = prompt.read_text() if prompt.is_file() else ""
if (
    not prompt_text
    or PENDING in prompt_text
    or EXPO_PENDING in prompt_text
    or f"snapback4@{version}" not in prompt_text
    or f"snapback4-expo@{expo_version}" not in prompt_text
):
    raise SystemExit(f"prompt is missing or stale for snapback4@{version} / snapback4-expo@{expo_version}; run scripts/render.py: {prompt}")
pins = json.loads((ROOT / "PACKAGE_PINS.json").read_text())
if pins != {"snapback4": version, "snapback4-expo": expo_version, "frozen": True}:
    raise SystemExit("PACKAGE_PINS.json is not frozen to both version files; run scripts/render.py")
if (logs / f"{name}.start.json").exists():
    raise SystemExit(f"{name} already has a start record; preserve it and use a new run root for a fresh session")
if not (lane / "instrument").is_symlink() or (lane / "instrument").resolve() != (ROOT / "instrument").resolve():
    raise SystemExit(f"lane instrument link is missing or wrong: {lane / 'instrument'}")
if phase == "builder":
    residue = [p for p in lane.iterdir() if p.name != "instrument"]
    if residue:
        raise SystemExit(f"builder lane is not cold: {', '.join(sorted(p.name for p in residue))}")
elif not completed(logs / f"{wave}-snapback4.end.json") or not (lane / "final-report.md").is_file():
    raise SystemExit(f"{phase} requires the completed continuous builder and its final-report.md")
if phase == "m7" and (
    not completed(logs / f"{wave}-snapback4.grade.end.json")
    or not (lane / "grading/DONE").is_file()
):
    raise SystemExit("M7 requires the completed independent grade and grading/DONE")
if phase == "m7" and not completed(logs / f"{wave}-snapback4.score.end.json"):
    raise SystemExit("M7 requires the completed same-family holistic score")
if phase == "m7" and not (ROOT / "grades/summary.json").is_file():
    raise SystemExit("M7 requires scripts/summarize_grades.py after all three complete grades")

if phase != "score":
    occupied = []
    for port in range(49340, 49360):
        probe = socket.socket()
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            # Only a listening socket is an occupied port: the range lies inside
            # macOS's ephemeral range, so an unrelated outbound connection can
            # hold a port here as its local end.
            listening = subprocess.run(["lsof", "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"], capture_output=True, text=True).stdout.strip()
            if listening:
                occupied.append(port)
        finally:
            probe.close()
    if occupied:
        raise SystemExit(f"assigned ports are occupied: {occupied}; inspect and stop only the recorded owner PIDs")

lock = None
if phase in {"builder", "score"}:
    lock = open(logs / f"{phase}.serial.lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit(f"another {phase} session holds logs/{phase}.serial.lock; {phase} sessions must run serially")

if phase == "grade":
    (lane / "grading").mkdir(exist_ok=True)
elif phase == "m7":
    (lane / "m7").mkdir(exist_ok=True)
elif phase == "score":
    (ROOT / "scores" / wave).mkdir(parents=True, exist_ok=True)

model, effort = MODELS[wave]
stdin = subprocess.DEVNULL
if phase == "grade":
    model, effort = "claude-opus-5", "provider-default"
    cmd = [
        str(CLAUDE), "-p", "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose",
        "--model", model, "--add-dir", str(ROOT / "instrument"),
    ]
    stdin = open(prompt)
elif phase == "score":
    effort = "xhigh"
    if wave == "astra":
        cmd = [
            str(CODEX), "exec", "-s", "read-only", "--skip-git-repo-check", "--color", "never",
            "-m", model, "-c", "model_reasoning_effort=xhigh", "-C", str(ROOT),
            "-o", str(ROOT / "scores" / wave / "FINAL.md"), "-",
        ]
        stdin = open(prompt)
    elif wave == "grok":
        cmd = [
            str(GROK), "--prompt-file", str(prompt), "--cwd", str(ROOT), "-m", model,
            "--reasoning-effort", "xhigh", "--output-format", "plain", "--disable-web-search",
            "--permission-mode", "auto", "--max-turns", "300",
        ]
    else:
        cmd = [
            str(MUSE), "exec", "--prompt-file", str(prompt), "--model", model,
            "--reasoning-effort", "xhigh", "--json", "--yolo", "--trust-workspace",
            "--user-input-auto-resolve", "--max-model-steps", "2000", "--workspace", str(ROOT),
        ]
elif wave == "astra":
    output = lane / ("FINAL.md" if phase == "builder" else "m7/FINAL.md")
    cmd = [
        str(CODEX), "exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check",
        "--json", "--color", "never", "-m", model, "-c", f"model_reasoning_effort={effort}",
        "-C", str(lane), "-o", str(output), "-",
    ]
    stdin = open(prompt)
elif wave == "grok":
    cmd = [
        str(GROK), "--prompt-file", str(prompt), "--cwd", str(lane), "-m", model,
        "--reasoning-effort", effort, "--output-format", "streaming-json",
        "--permission-mode", "bypassPermissions", "--max-turns", "5000",
    ]
else:
    cmd = [
        str(MUSE), "exec", "--prompt-file", str(prompt), "--model", model,
        "--reasoning-effort", effort, "--json", "--yolo", "--trust-workspace",
        "--user-input-auto-resolve", "--max-model-steps", "50000", "--workspace", str(lane),
    ]

for executable in (Path(cmd[0]), NODE_BIN / "node"):
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise SystemExit(f"required executable is unavailable: {executable}")

env = dict(os.environ)
env["PATH"] = str(NODE_BIN) + ":" + env.get("PATH", "")
for key in list(env):
    if key.startswith("SNAPBACK_") or key in {"CI", "EXPO_PUBLIC_SNAPBACK_URL", "VITE_SNAPBACK_URL"}:
        env.pop(key, None)

score_dir = ROOT / "scores" / wave
stdout_path = score_dir / "raw.out" if phase == "score" else logs / f"{name}.ndjson"
stderr_path = score_dir / "raw.err" if phase == "score" else logs / f"{name}.stderr.log"
start_path = logs / f"{name}.start.json"
end_path = logs / f"{name}.end.json"
pid_path = logs / f"{name}.pid"
started_epoch = int(time.time())
started_monotonic = time.monotonic()

cwd = ROOT if phase == "score" else lane
with open(stdout_path, "x") as stdout, open(stderr_path, "x") as stderr:
    process = subprocess.Popen(cmd, stdin=stdin, stdout=stdout, stderr=stderr, cwd=cwd, env=env)
    pid_path.write_text(f"{process.pid}\n")
    start_path.write_text(json.dumps({
        "lane": f"{wave}-snapback4", "phase": phase, "pid": process.pid,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_epoch)),
        "startedEpoch": started_epoch, "command": cmd, "model": model, "effort": effort,
        "prompt": str(prompt), "cwd": str(cwd), "stdout": str(stdout_path), "stderr": str(stderr_path),
        "packages": {"snapback4": version, "snapback4-expo": expo_version},
        "detached": False,
    }, indent=2) + "\n")

    def forward(signum, _frame):
        if process.poll() is None:
            process.send_signal(signum)

    signal.signal(signal.SIGINT, forward)
    signal.signal(signal.SIGTERM, forward)
    returncode = process.wait()

ended_epoch = int(time.time())
end_path.write_text(json.dumps({
    "lane": f"{wave}-snapback4", "phase": phase, "pid": process.pid,
    "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ended_epoch)),
    "endedEpoch": ended_epoch, "wallSeconds": round(time.monotonic() - started_monotonic, 3),
    "exitCode": returncode, "stdout": str(stdout_path), "stderr": str(stderr_path),
}, indent=2) + "\n")
print(f"{name}: exit {returncode}; lifecycle in {start_path.name} / {end_path.name}; logs retained")
raise SystemExit(returncode)
