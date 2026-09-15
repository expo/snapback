#!/usr/bin/env python3
"""Validate and combine the three same-family holistic Snapback4 scores."""

import json
import re
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parent.parent
WAVES = ["astra", "grok", "muse"]
MODELS = {"astra": "gpt-6-astra", "grok": "grok-4.6", "muse": "muse-spark-1.3"}
CATEGORIES = [
    "setup_and_docs", "data_modeling", "authorization", "queries_and_live",
    "writes_and_transactions", "offline_sync", "media_assets", "background_work",
    "client_integration", "diagnostics_dev_loop", "scale_and_limits", "operations",
]
FENCE = re.compile(r"```json\s*(\{.*?\})\s*```", re.S)


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for nested in value.values():
            yield from strings(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from strings(nested)


def extract(wave: str):
    directory = ROOT / "scores" / wave
    for name in ("FINAL.md", "raw.out"):
        path = directory / name
        if not path.exists() or path.stat().st_size == 0:
            continue
        text = path.read_text(errors="replace")
        blocks = FENCE.findall(text)
        if not blocks and name == "raw.out":
            for line in text.splitlines():
                try:
                    event = json.loads(line)
                except Exception:
                    continue
                for value in strings(event):
                    if "```json" in value:
                        blocks.extend(FENCE.findall(value))
        for block in reversed(blocks):
            try:
                parsed = json.loads(block)
            except Exception:
                continue
            if "snapback4" in parsed.get("backends", {}):
                return parsed, f"scores/{wave}/{name}"
    raise SystemExit(f"no fenced Snapback4 score found for {wave}")


scores = {}
sources = {}
for wave in WAVES:
    lifecycle = ROOT / "logs" / f"{wave}-snapback4.score.end.json"
    if not lifecycle.is_file():
        raise SystemExit(f"holistic scorer has no lifecycle end record: {wave}")
    if json.loads(lifecycle.read_text()).get("exitCode") != 0:
        raise SystemExit(f"holistic scorer did not exit successfully: {wave}")
    score, source = extract(wave)
    if score.get("scorer", {}).get("family") != wave or score.get("scorer", {}).get("model") != MODELS[wave]:
        raise SystemExit(f"scorer identity mismatch: {wave}")
    backend = score["backends"]["snapback4"]
    for category in ["overall", *CATEGORIES]:
        entry = backend.get(category)
        if not isinstance(entry, dict) or not isinstance(entry.get("score"), int) or not 0 <= entry["score"] <= 100:
            raise SystemExit(f"invalid {wave} score for {category}")
        if not isinstance(entry.get("note"), str) or not entry["note"].strip():
            raise SystemExit(f"missing {wave} evidence note for {category}")
    scores[wave] = score
    sources[wave] = source

output = ROOT / "scores"
(output / "all.json").write_text(json.dumps({"scores": scores, "sources": sources}, indent=2) + "\n")

def value(wave: str, category: str) -> int:
    return scores[wave]["backends"]["snapback4"][category]["score"]

lines = [
    "# Clique full run: same-family holistic Snapback 4 scores (0–100)", "",
    "Each builder model scored only its own lane's narrative evidence at xhigh. This adapts the September 5 rubric from three backends per family to one Snapback 4 lane per family; prior cross-backend scores remain anchors rather than directly pooled observations.", "",
    "| Category | Astra | Grok | Muse | Mean |", "| --- | ---: | ---: | ---: | ---: |",
]
for category in ["overall", *CATEGORIES]:
    values = [value(wave, category) for wave in WAVES]
    lines.append(f"| {category} | {values[0]} | {values[1]} | {values[2]} | {mean(values):.0f} |")
lines += ["", "## Verdicts", ""]
for wave in WAVES:
    backend = scores[wave]["backends"]["snapback4"]
    lines.append(f"- **{wave}:** {backend.get('verdict', '')} Would use again for: {backend.get('would_use_again_for', '')}")
(output / "summary.md").write_text("\n".join(lines) + "\n")
print(f"aggregated holistic scores from {sources}")
