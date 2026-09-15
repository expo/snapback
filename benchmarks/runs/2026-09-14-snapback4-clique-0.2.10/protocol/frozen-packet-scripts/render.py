#!/usr/bin/env python3
"""Render builder, independent-grade, and fresh-M7 prompts for all three lanes."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = (ROOT / "SNAPBACK4_VERSION").read_text().strip()
EXPO_VERSION = (ROOT / "SNAPBACK4_EXPO_VERSION").read_text().strip()
PENDING = "PENDING_PUBLISHED_FIXED_PIN"
EXPO_PENDING = "PENDING_PUBLISHED_EXPO_PIN"
PORTS = "49340–49359"
OTHER_PORTS = "every port outside 49340–49359 (other work shares this machine)"
GRADER_MODEL = "claude-opus-5"

WAVES = {
    "astra": ("gpt-6-astra", "medium"),
    "grok": ("grok-4.6", "xhigh"),
    "muse": ("muse-spark-1.3", "xhigh"),
}

if VERSION != PENDING and not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", VERSION):
    raise SystemExit(f"SNAPBACK4_VERSION is neither the pending marker nor a package version: {VERSION!r}")
if EXPO_VERSION != EXPO_PENDING and not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", EXPO_VERSION):
    raise SystemExit(f"SNAPBACK4_EXPO_VERSION is neither the pending marker nor a package version: {EXPO_VERSION!r}")

(ROOT / "PACKAGE_PINS.json").write_text(json.dumps({
    "snapback4": VERSION,
    "snapback4-expo": EXPO_VERSION,
    "frozen": VERSION != PENDING and EXPO_VERSION != EXPO_PENDING,
}, indent=2) + "\n")

platform = (
    f"Build Clique on **Snapback 4**. Install and use ONLY `snapback4@{VERSION}` from the public npm registry "
    f"(exact pin; it installs its platform binary for this host as an optional dependency, so `npx snapback4` works after `npm install snapback4@{VERSION}`), "
    "its README (read the whole published surface first), the guide it serves (`npx snapback4 guide` and its keyword cards), "
    "`npx snapback4 why <CODE>`, and its generated types (`snapback/generated/api.ts`, written by `npx snapback4 check`). "
    "Discover the CLI and authoring surface only from that installed package. The backend is authored in Quarry (`snapback/*.q`); "
    "the whole backend is the schema, its rules, its `sync` lines, and its queries, mutations, jobs, and schedules. "
    "The client is an Expo Router app (web plus the iOS Hermes bundle export) using the installed package's local/replica and React client arms. "
    f"Install and use ONLY `snapback4-expo@{EXPO_VERSION}` for the native Expo arm; do not substitute a source build. Record both exact package pins "
    "at the top of `run-log.md` before installing dependencies. "
    "Never read any Snapback source repository. If the published package cannot express something the brief requires, record it as a platform gap "
    "with the exact diagnostic and continue. Do not infer current limitations from an older Snapback release or benchmark run."
)

m7_platform = (
    f"The inherited app runs on **Snapback 4**, the public npm package `snapback4@{VERSION}` (exact pin; use only its README, "
    "the guide served by `npx snapback4 guide`, `npx snapback4 why <CODE>`, its generated types, and this lane's existing app; "
    "never read a Snapback source checkout). Backend changes are Quarry (`snapback/*.q`) and must use the published CLI's documented "
    f"schema-evolution path. Its native arm remains pinned to the public `snapback4-expo@{EXPO_VERSION}` used by the continuous builder. "
    "Nothing is struck from this run (`ENVIRONMENT.md`): acceptance 4 compares messages, media, receipts, and reactions."
)


def fill(template: str, values: dict[str, str]) -> str:
    for key, value in values.items():
        template = template.replace("{" + key + "}", value)
    missing = [key for key in values if "{" + key + "}" in template]
    if missing:
        raise SystemExit(f"unfilled placeholders: {', '.join(missing)}")
    return template


builder_template = (ROOT / "prompts" / "template.md").read_text()
grade_template = (ROOT / "prompts" / "grade.template.md").read_text()
m7_template = (ROOT / "prompts" / "m7.template.md").read_text()
holistic_template = (ROOT / "prompts" / "holistic.template.md").read_text()

for wave, (model, effort) in WAVES.items():
    lane = ROOT / "lanes" / f"{wave}-snapback4"
    lane.mkdir(parents=True, exist_ok=True)
    link = lane / "instrument"
    if not link.exists():
        link.symlink_to(ROOT / "instrument")
    lane_id = f"{wave}-clique-snapback4-full-20260913"
    common = {
        "LANE_DIR": str(lane),
        "RUN_ROOT": str(ROOT),
        "PORTS": PORTS,
        "LANE_ID": lane_id,
        "MODEL": model,
        "EFFORT": effort,
        "BACKEND": f"snapback4-{VERSION}",
        "DEFECT_LABEL": "snapback4-defect",
    }
    builder = fill(builder_template, {
        **common,
        "PLATFORM_PARAGRAPH": platform,
        "OTHER_PORTS": OTHER_PORTS,
        "OTHER_BACKENDS": "Convex, Supabase, and earlier Snapback generations",
    })
    grade = fill(grade_template, {
        "RUN_ROOT": str(ROOT),
        "LANE_DIR": str(lane),
        "BACKEND": f"snapback4-{VERSION}",
        "PLATFORM_NOTE": f"the public npm packages snapback4@{VERSION} and snapback4-expo@{EXPO_VERSION} (the CLI rides snapback4: `npx snapback4`)",
        "PORTS": PORTS,
        "WAVE": f"full-3models-{wave}",
        "GRADER_MODEL": GRADER_MODEL,
    })
    grade += f"""

## Complete grade and comparable subtotal

The frozen manifest contains 119 unique assertions. Grade all 119 in this one
independent session: M1–M8, including M7's pre-evolution not-run/conditional
results and the 18 M8 results. The frozen grader-report schema only permits the
101 M1–M7 IDs, so keep `grader-report.json` schema-valid with exactly those 101
IDs. Write the remaining 18 results to
`{lane / 'grading/m8-assertion-results.json'}` as a JSON object with exactly
these keys: `reportVersion` (1), `lane` (`{wave}-snapback4`), `grader`
(`family`: `claude`, `model`: `{GRADER_MODEL}`), `assertionManifest` (the path
and SHA-256 of `assertions.json`), and `assertionResults` (an object keyed by
the exact 18 M8 assertion IDs, using the same result records and enum values as
`grader-report.json`). Do not duplicate an ID across the two result files.

The actual September 5 and September 12 structured `assertionResults` carried
only the 101 IDs listed in `{ROOT / 'GRADER_ASSERTIONS_101.txt'}`. Their notes
could describe M8 observations, but they did not provide a machine-comparable
18-ID M8 result set. Record both the frozen schema limitation and that prior
measurement-coverage gap in `trace.md`. The harness will validate the exact
119-ID partition and report the prior-101 subtotal, the 18 M8 results, and the
complete 119-result total. Write `DONE` only after both result files and the
trace are complete.
"""
    m7 = fill(m7_template, {**common, "PLATFORM_PARAGRAPH": m7_platform})
    holistic = fill(holistic_template, {
        "MODEL": model,
        "WAVE": wave,
        "RUN_ROOT": str(ROOT),
        "LANE_DIR": str(lane),
        "SNAPBACK4_VERSION": VERSION,
        "SNAPBACK4_EXPO_VERSION": EXPO_VERSION,
    })
    (ROOT / "prompts" / f"{wave}-snapback4.md").write_text(builder)
    (ROOT / "prompts" / f"{wave}-snapback4.grade.md").write_text(grade)
    (ROOT / "prompts" / f"{wave}-snapback4.m7.md").write_text(m7)
    (ROOT / "prompts" / f"{wave}-snapback4.score.md").write_text(holistic)
    print(f"rendered {wave}: {model}/{effort}, ports {PORTS}, snapback4@{VERSION}, snapback4-expo@{EXPO_VERSION}")
