#!/usr/bin/env python3
"""Blind two-family code review (Grok 4.6 xhigh + Muse Spark) of one lane's commits.

usage: launch-review.py <lane> <round> <worktree> <base-sha> <candidate-sha>
Builds a read-only capsule reviews/capsule-<lane>-r<round>/ (git archive of the
candidate, no .git), writes REVIEW-TARGET.md + the commit-only diff into it,
then launches grok and muse on briefs/review-template.md with the placeholders
filled. Outputs reviews/<lane>-r<round>-{grok,muse}.md.
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
lane, rnd, worktree, base, cand = sys.argv[1], sys.argv[2], os.path.abspath(sys.argv[3]), sys.argv[4], sys.argv[5]
cap = os.path.join(HERE, "reviews", f"capsule-{lane}-r{rnd}")
if os.path.isdir(cap):
    shutil.rmtree(cap)
os.makedirs(cap)
subprocess.run(f"git -C {worktree} archive {cand} | tar -x -C {cap}", shell=True, check=True)
diff = subprocess.run(["git", "-C", worktree, "diff", f"{base}..{cand}", "--", ".", ":(exclude)snapback2/corpus", ":(exclude)snapback2/metrics"],
                      capture_output=True, text=True, check=True).stdout
stat = subprocess.run(["git", "-C", worktree, "diff", "--stat", f"{base}..{cand}"], capture_output=True, text=True).stdout
open(os.path.join(cap, "LANE-DIFF.patch"), "w").write(diff)
brief_path = os.path.join(HERE, "briefs", f"lane-{lane}.md")
shutil.copy(brief_path, os.path.join(cap, "LANE-BRIEF.md"))
os.makedirs(os.path.join(cap, "PANEL"), exist_ok=True)
shutil.copy(os.path.join(HERE, "plan.md"), os.path.join(cap, "PANEL", "plan.md"))
report = os.environ.get("REPORT", os.path.join(HERE, "reports", f"final-{lane}.md"))
if os.path.exists(report):
    shutil.copy(report, os.path.join(cap, "LANE-REPORT.md"))
extra = [e for e in os.environ.get("EXTRA", "").split(":") if e]
if extra:
    os.makedirs(os.path.join(cap, "REVIEW-EXTRA"), exist_ok=True)
    for e in extra:
        shutil.copy(e, os.path.join(cap, "REVIEW-EXTRA", os.path.basename(e)))
round_note = "" if rnd == "1" else f"""
This is round {rnd}: the base is the round-{int(rnd)-1} candidate the reviewers already judged, and the
diff is the fix round that answers those reviews. `REVIEW-EXTRA/` holds the previous reviews and the
fix brief the implementer was given; judge whether each item was fixed or correctly refused, and whether
the fix introduced anything new. The whole tree is the candidate.
"""
open(os.path.join(cap, "REVIEW-TARGET.md"), "w").write(f"""# Review target — lane {lane}, round {rnd}
{round_note}

- Base commit: `{base}`; candidate commit: `{cand}` (this tree)
- The change under review: `LANE-DIFF.patch` (commit-only diff, corpus/metrics regen excluded)
- The lane brief: `LANE-BRIEF.md`; the plan: `PANEL/plan.md`; the implementer's report: `LANE-REPORT.md` (claims, not facts)

Diff stat:

```
{stat}
```
""")
template = open(os.path.join(HERE, "briefs", "review-template.md")).read()
prompt = template.replace("<LANE>", lane).replace("<SHA>", cand).replace("<BASE>", base)
for family in [f for f in os.environ.get("FAMILIES", "grok,codex").split(",") if f]:
    out = os.path.join(HERE, "reviews", f"{lane}-r{rnd}-{family}.md")
    bfile = os.path.join(HERE, "reviews", f"{lane}-r{rnd}-{family}.prompt.md")
    open(bfile, "w").write(prompt.replace("<OUT>", out))
    if family == "grok":
        cmd = [os.path.expanduser("~/.local/bin/grok"), "--prompt-file", bfile, "--cwd", cap,
               "-m", "grok-4.6", "--reasoning-effort", "xhigh", "--output-format", "plain",
               "--disable-web-search", "--permission-mode", "auto", "--max-turns", "300"]
    elif family == "codex":
        cmd = [os.path.expanduser("~/.volta/bin/codex"), "exec", "--skip-git-repo-check", "-s", "read-only", "-m", "gpt-6-astra",
               "-c", "model_reasoning_effort=xhigh", "-C", cap, "-o", out, open(bfile).read()]
    else:
        cmd = [os.path.expanduser("~/.local/bin/muse"), "exec", "--prompt-file", bfile,
               "--model", "muse-spark-1.3", "--reasoning-effort", os.environ.get("MUSE_EFFORT", "ultra"),
               "--workspace", cap, "--disable-write", "--disable-web-tools", "--trust-workspace",
               "--approval-mode", "never", "--user-input-auto-resolve"]
    log = open(os.path.join(HERE, "reviews", f"{lane}-r{rnd}-{family}.log"), "w")
    if family == "codex":
        p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                             start_new_session=True, cwd=cap)
    else:
        p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=open(out, "w"), stderr=log,
                             start_new_session=True, cwd=cap)
    open(os.path.join(HERE, "pids", f"review-{lane}-r{rnd}-{family}"), "w").write(str(p.pid))
    print(f"review {lane} r{rnd} {family} pid {p.pid} -> {out}")
