#!/usr/bin/env python3
"""Render the Astra/Snapback 2 builder prompt for one fresh Linux packet."""

import argparse
import re
from pathlib import Path


VERSION_PATTERN = re.compile(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?")

SCALE_OWNER_CUSTODY_APPENDIX = """

## Required scale-owner lifecycle handshake

The Linux launcher gives this session a unique `CLIQUE_SCALE_CUSTODY_RUN_ID`.
For every M6 or M8 scale attempt, start a fresh scale backend with all three
declarations on the `snapback2 dev` process itself:

```sh
CLIQUE_SCALE_MILESTONE=M8 \\
CLIQUE_SCALE_ATTEMPT=1 \\
CLIQUE_SCALE_RESULT="$PWD/evidence/scale-replay/result.json" \\
npx snapback2 dev --project "$PWD/replays/scale-m8-attempt-1" --port <assigned-port>
```

Use the real milestone, monotonically increasing positive attempt number, and
the absolute path of that attempt's eventual JSON result. A retry starts a new
owner with a new attempt number and its own result path. These declarations
are mandatory execution custody, not optional evidence metadata: the launcher
inherits and verifies the run ID automatically, binds the declaration to the
exact owner process and `owner.json`, and will not associate a result by path
name or modification time. Write the normal full
`snapback.full-journey-scale-replay.v1`,
`snapback.full-journey-scale-replay-failure.v1`, or raw replay report shape to
the declared path. A schema-invalid, stale, unrelated, or undeclared result
does not stop an owner. Actor exit still cleans every owner proved to belong to
this actor.
"""


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
    rendered = rendered.rstrip() + SCALE_OWNER_CUSTODY_APPENDIX
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
