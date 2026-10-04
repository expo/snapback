#!/usr/bin/env python3
"""tokens.py <ndjson> [<end.json>] — print wall seconds and token usage for a Codex (Astra) or Grok builder log."""
import json, sys
path = sys.argv[1]
codex = None; grok = {"input": 0, "cached": 0, "output": 0, "reasoning": 0, "calls": 0}
for line in open(path, errors="replace"):
    line = line.strip()
    if not line.startswith("{"): continue
    try: e = json.loads(line)
    except Exception: continue
    t = e.get("type")
    if t == "turn.completed" and "usage" in e:
        u = e["usage"]; codex = codex or {"input": 0, "cached": 0, "output": 0, "reasoning": 0, "calls": 0}
        codex["input"] += u.get("input_tokens", 0) - u.get("cached_input_tokens", 0)
        codex["cached"] += u.get("cached_input_tokens", 0)
        codex["output"] += u.get("output_tokens", 0)
        codex["reasoning"] += u.get("reasoning_output_tokens", 0)
        codex["calls"] += 1
    elif t == "usage" and "usage" in e:
        u = e["usage"]
        grok["input"] += u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
        grok["cached"] += u.get("cache_read_input_tokens", 0)
        grok["output"] += u.get("output_tokens", 0)
        grok["reasoning"] += u.get("reasoning_tokens", 0)
        grok["calls"] += 1
r = codex if codex else grok
wall = None
if len(sys.argv) > 2:
    try:
        d = json.load(open(sys.argv[2])); wall = d.get("wallSeconds") or (d.get("end", 0) - d.get("start", 0)) or None
    except Exception: pass
tot = r["input"] + r["cached"] + r["output"]
print(json.dumps({"log": path, "family": "astra" if codex else "grok", "wall_s": wall, "fresh_input": r["input"], "cached_input": r["cached"],
                  "output": r["output"], "reasoning_in_output": r["reasoning"], "total": tot, "turns_or_calls": r["calls"]}))
