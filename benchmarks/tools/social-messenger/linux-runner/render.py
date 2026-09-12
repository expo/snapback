#!/usr/bin/env python3
"""Render the Astra/Snapback 2 builder prompt for one fresh Linux packet."""

import argparse
import re
from pathlib import Path


VERSION_PATTERN = re.compile(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?")


def render_prompt(root: Path, version: str, port_start: int, port_count: int) -> Path:
    if not VERSION_PATTERN.fullmatch(version):
        raise SystemExit("SNAPBACK2_VERSION is pending or invalid")
    template_path = root / "prompts" / "template.md"
    template = template_path.read_text()
    lane_dir = root / "lanes" / "astra-snapback2"
    prompt_path = root / "prompts" / "astra-snapback2.md"
    lane_dir.mkdir(parents=True, exist_ok=False)
    (lane_dir / "instrument").symlink_to(root / "instrument")
    port_end = port_start + port_count - 1
    replacements = {
        "{LANE_DIR}": str(lane_dir),
        "{RUN_ROOT}": str(root),
        "{PLATFORM_PARAGRAPH}": (
            "Build Clique on **Snapback 2**. Install and use ONLY "
            f"`snapback2@{version}` from the public npm registry (exact pin; it installs "
            "its platform binary for this host), its README, the guide it serves "
            "(`npx snapback2 guide`, and the guide files inside the installed package), "
            "and its generated types. Discover everything else from that installed package: "
            "`snapback2 init`, `check`, `dev`, `run`, `test`, `why`, `trace`, `data`, "
            "`persona`. The backend is authored in Quarry (`snapback/*.q`); seeds, tests, "
            "and effect bodies are TypeScript. The client is an Expo Router app (web, plus "
            "the iOS Hermes bundle export) using the package's React and Expo client arms "
            "as its guide documents. Never read the Snapback source repository. If the "
            "package cannot express something the brief requires, record it as a platform "
            "gap with the exact diagnostic and continue."
        ),
        "{PORTS}": f"{port_start}–{port_end}",
        "{OTHER_PORTS}": "none; all ports outside the assigned range remain reserved",
        "{LANE_ID}": "astra-clique-snapback2",
        "{MODEL}": "gpt-6-astra",
        "{EFFORT}": "medium",
        "{BACKEND}": f"snapback2-{version}",
        "{DEFECT_LABEL}": "snapback2-defect",
        "{OTHER_BACKENDS}": "Convex, Supabase",
    }
    rendered = template
    for key, value in replacements.items():
        rendered = rendered.replace(key, value)
    if "{" in rendered.replace("M{n}", ""):
        raise SystemExit("unfilled placeholder in astra-clique-snapback2 prompt")
    with prompt_path.open("x") as handle:
        handle.write(rendered)
    return prompt_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--port-start", type=int, default=53100)
    parser.add_argument("--port-count", type=int, default=20)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    prompt = render_prompt(root, args.version, args.port_start, args.port_count)
    print(f"rendered astra-clique-snapback2 -> {prompt}")


if __name__ == "__main__":
    main()
