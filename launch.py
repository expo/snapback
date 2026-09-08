#!/usr/bin/env python3
"""Launch one panelist detached from the harness (new session, no pipe back).

usage: launch.py <codex|grok|muse> <round-tag> <ABSOLUTE brief-file> [repo-dir]
Writes out/<family>-<tag>.md, log/<family>-<tag>.log, log/<family>-<tag>.pid.
codex by absolute path (~/.volta/bin/codex 0.153.x). grok resolves --prompt-file
against --cwd, so the brief path must be absolute. muse writes to stdout.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
family, tag, brief = sys.argv[1], sys.argv[2], sys.argv[3]
REPO = sys.argv[4] if len(sys.argv) > 4 else os.path.join(HERE, "repo")
out = os.path.join(HERE, "out", f"{family}-{tag}.md")
log = os.path.join(HERE, "log", f"{family}-{tag}.log")
prompt = open(brief).read()
os.makedirs(os.path.dirname(out), exist_ok=True)
os.makedirs(os.path.dirname(log), exist_ok=True)

if family == "codex":
    cmd = [
        os.path.expanduser("~/.volta/bin/codex"), "exec",
        "-s", "read-only", "-m", "gpt-6-astra",
        "-c", "model_reasoning_effort=xhigh",
        "-C", REPO, "-o", out, prompt,
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=open(log, "w"), stderr=subprocess.STDOUT,
                         start_new_session=True, cwd=REPO)
elif family == "grok":
    cmd = [
        os.path.expanduser("~/.local/bin/grok"),
        "--prompt-file", brief, "--cwd", REPO,
        "-m", "grok-4.6", "--reasoning-effort", "xhigh",
        "--output-format", "plain", "--disable-web-search",
        "--permission-mode", "auto", "--max-turns", "200",
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=open(out, "w"), stderr=open(log, "w"),
                         start_new_session=True, cwd=REPO)
elif family == "muse":
    effort = os.environ.get("MUSE_EFFORT", "ultra")
    cmd = [
        os.path.expanduser("~/.local/bin/muse"), "exec",
        "--prompt-file", brief, "--model", "muse-spark-1.3",
        "--reasoning-effort", effort, "--workspace", REPO,
        "--disable-write", "--disable-web-tools", "--trust-workspace",
        "--approval-mode", "never", "--user-input-auto-resolve",
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=open(out, "w"), stderr=open(log, "w"),
                         start_new_session=True, cwd=REPO)
else:
    sys.exit("family must be codex, grok, or muse")

open(os.path.join(HERE, "log", f"{family}-{tag}.pid"), "w").write(str(p.pid))
print(f"{family} {tag} pid {p.pid} -> {out}")
