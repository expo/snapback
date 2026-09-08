#!/usr/bin/env python3
"""Dispatch one implementation lane to GPT-6 Astra (codex exec, xhigh), detached.

usage: run-lane.py <lane> <worktree> [brief-file]
The prompt is briefs/common.md + '---' + the lane brief. The report lands at
reports/final-<lane>.md (codex -o) — the sandbox sometimes refuses the report
dir, in which case codex writes REPORT-<lane>.md inside the worktree instead.
Logs: logs/codex-<lane>.log; pid: pids/codex-<lane>.
Real node 24 is put first on PATH (the volta shim hangs the compiler worker);
codex is launched by absolute path (the node image dir shadows it with 0.152.1).
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
lane, worktree = sys.argv[1], os.path.abspath(sys.argv[2])
brief = sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, "briefs", f"lane-{lane}.md")
for d in ("reports", "logs", "pids"):
    os.makedirs(os.path.join(HERE, d), exist_ok=True)
common = os.environ.get("COMMON", os.path.join(HERE, "briefs", "common.md"))
prompt = open(common).read() + "\n\n---\n\n" + open(brief).read()
env = dict(os.environ)
env["PATH"] = os.path.expanduser("~/.volta/tools/image/node/24.18.0/bin") + ":" + env["PATH"]
env["SNAPBACK2_COMPILER"] = os.path.join(worktree, "snapback2", "packages", "snapback2", "dist", "compiler.mjs")
cmd = [
    os.path.expanduser("~/.volta/bin/codex"), "exec",
    "-m", "gpt-6-astra", "-c", "model_reasoning_effort=xhigh",
    "-s", "workspace-write", "-c", "sandbox_workspace_write.network_access=true",
    "-C", worktree, "-o", os.path.join(HERE, "reports", f"final-{lane}.md"), "-",
]
log = open(os.path.join(HERE, "logs", f"codex-{lane}.log"), "w")
p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT,
                     start_new_session=True, cwd=worktree, env=env)
p.stdin.write(prompt.encode())
p.stdin.close()
open(os.path.join(HERE, "pids", f"codex-{lane}"), "w").write(str(p.pid))
print(f"lane {lane} pid {p.pid} in {worktree} -> reports/final-{lane}.md")
