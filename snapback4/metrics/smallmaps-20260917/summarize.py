"""Summarize every HTTP pair, including all three noisy batches."""
import json, statistics
from pathlib import Path
root = Path(__file__).parent
batches = [json.loads((root / name).read_text())["records"] for name in ["paired-storage.json", "paired-storage-repeat.json", "paired-storage-third.json"]]
out = {}
for name in batches[0][0]["measurements"]:
    out[name] = {}
    for metric in ["p50Ms", "p95Ms"]:
        ratios = []
        for records in batches:
            for trial in range(7):
                pair = {r["stage"]: r["measurements"][name][metric] for r in records if r["trial"] == trial}
                ratios.append(pair["after"] / pair["before"])
        out[name][metric] = {"pairs": len(ratios), "median_pair_ratio": statistics.median(ratios), "pair_ratios": ratios}
print(json.dumps(out, indent=2))
