#!/usr/bin/env python3
"""Read-only packet check. Pass --allow-pending before the package pin exists."""

import ast
import hashlib
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PENDING = "PENDING_PUBLISHED_FIXED_PIN"
EXPO_PENDING = "PENDING_PUBLISHED_EXPO_PIN"
WAVES = {"astra", "grok", "muse"}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


copy = ROOT / "instrument"
expected = {}
for line in (ROOT / "INSTRUMENT.sha256").read_text().splitlines():
    sha256, name = line.split("  ", 1)
    expected[name] = sha256
actual = {str(p.relative_to(ROOT)): digest(p) for p in copy.rglob("*") if p.is_file()}
if actual != expected:
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    changed = sorted(k for k in expected.keys() & actual.keys() if expected[k] != actual[k])
    raise SystemExit(f"instrument differs from frozen source; missing={missing}, extra={extra}, changed={changed}")
if any(p.stat().st_mode & 0o222 for p in copy.rglob("*")):
    raise SystemExit("instrument contains a writable entry")

templates = {}
for line in (ROOT / "PROMPT_TEMPLATES.sha256").read_text().splitlines():
    sha256, name = line.split("  ", 1)
    templates[name] = sha256
for name, sha256 in templates.items():
    if digest(ROOT / name) != sha256:
        raise SystemExit(f"frozen prompt template changed: {name}")

for script in (ROOT / "scripts").glob("*.py"):
    ast.parse(script.read_text(), filename=str(script))
if "start_new_session" in (ROOT / "scripts/run_phase.py").read_text():
    raise SystemExit("runner must keep the child in the foreground process group")

version = (ROOT / "SNAPBACK4_VERSION").read_text().strip()
expo_version = (ROOT / "SNAPBACK4_EXPO_VERSION").read_text().strip()
pending = version == PENDING
expo_pending = expo_version == EXPO_PENDING
semver = r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?"
if not pending and not re.fullmatch(semver, version):
    raise SystemExit(f"invalid SNAPBACK4_VERSION: {version!r}")
if not expo_pending and not re.fullmatch(semver, expo_version):
    raise SystemExit(f"invalid SNAPBACK4_EXPO_VERSION: {expo_version!r}")
if (pending or expo_pending) and "--allow-pending" not in sys.argv:
    raise SystemExit("package pins are pending; set both version files, render again, then verify")
pins = json.loads((ROOT / "PACKAGE_PINS.json").read_text())
if pins != {"snapback4": version, "snapback4-expo": expo_version, "frozen": not pending and not expo_pending}:
    raise SystemExit("PACKAGE_PINS.json does not match the two version files; render again")

comparable_ids = set((ROOT / "GRADER_ASSERTIONS_101.txt").read_text().splitlines())
assertions = json.loads((ROOT / "instrument/schema/social-messenger/assertions.json").read_text())
all_ids = {item["id"] for milestone in assertions["milestones"].values() for item in milestone["assertions"]}
m8_ids = {item["id"] for item in assertions["milestones"]["M8"]["assertions"]}
if len(comparable_ids) != 101 or comparable_ids != all_ids - m8_ids:
    raise SystemExit("GRADER_ASSERTIONS_101.txt no longer matches the prior M1–M7 comparison set")
if len(all_ids) != 119 or len(m8_ids) != 18:
    raise SystemExit("expected frozen assertion partition 119 = prior 101 + M8 18")
report_schema = json.loads((ROOT / "instrument/grader/grader-report.schema.json").read_text())
patterns = report_schema["properties"]["assertionResults"]["patternProperties"]
if set(patterns) != {"^m[1-7]-a[0-9]{2}$"}:
    raise SystemExit("frozen grader-report schema no longer has the recorded M1–M7-only limitation")

models = {"astra": ("gpt-6-astra", "medium"), "grok": ("grok-4.6", "xhigh"), "muse": ("muse-spark-1.3", "xhigh")}
for wave in WAVES:
    lane = ROOT / "lanes" / f"{wave}-snapback4"
    entries = sorted(p.name for p in lane.iterdir())
    if entries != ["instrument"] or not (lane / "instrument").is_symlink():
        raise SystemExit(f"{wave} builder lane is not cold: {entries}")
    for suffix in ("", ".score", ".grade", ".m7"):
        prompt = ROOT / "prompts" / f"{wave}-snapback4{suffix}.md"
        if not prompt.is_file():
            raise SystemExit(f"missing rendered prompt: {prompt}")
        text = prompt.read_text()
        if pending != (PENDING in text) or expo_pending != (EXPO_PENDING in text):
            raise SystemExit(f"prompt/version mismatch: {prompt}")
        if suffix != ".score" and "49340–49359" not in text:
            raise SystemExit(f"assigned port range missing: {prompt}")
        if suffix in {"", ".m7"}:
            model, effort = models[wave]
            if model not in text or f"effort={effort}" not in text:
                raise SystemExit(f"model metadata mismatch: {prompt}")
        elif suffix == ".score" and models[wave][0] not in text:
            raise SystemExit(f"holistic scorer identity mismatch: {prompt}")
        elif suffix == ".grade" and (
            "Grade all 119" not in text
            or "m8-assertion-results.json" not in text
            or "prior-101 subtotal" not in text
        ):
            raise SystemExit(f"complete-grade partition instructions missing: {prompt}")

commands = {
    "codex": Path.home() / ".volta/bin/codex",
    "grok": Path.home() / ".local/bin/grok",
    "muse": Path.home() / ".local/bin/muse",
    "claude": Path.home() / ".local/bin/claude",
    "node": Path.home() / ".volta/tools/image/node/24.18.0/bin/node",
}
for name, path in commands.items():
    if not path.is_file() or not os.access(path, os.X_OK):
        raise SystemExit(f"{name} executable unavailable: {path}")

if any((ROOT / "logs").iterdir()):
    raise SystemExit("logs/ is not empty; a phase may already have started")

print(f"packet verified: {len(actual)} frozen instrument files, 3 cold lanes, snapback4={version}, snapback4-expo={expo_version}")
