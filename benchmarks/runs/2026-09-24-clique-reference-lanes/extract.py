#!/usr/bin/env python3
"""Read the frozen packet; write clocks.json and tokens.json beside this script.

No packet code is imported/executed, no services are started, and the packet is
never written. Run with Python 3.9+: python3 extract.py /path/to/clique-ref-20260924
Optional second argument selects an output directory (outside the packet).
Epoch subtraction, not end.json's inconsistent wallSeconds, defines builder wall.
First-green reports and receipt timestamps are preserved separately, not silently
reconciled. Transcript usage is builder-only; cache counters are not added twice.
"""

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


LANES = [f"{wave}-{backend}" for wave in ("astra", "opus")
         for backend in ("snapback4", "convex", "supabase")]
MILESTONES = ["M1", "M2", "M3", "M4", "M5", "M6", "M8"]


def iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(
        timespec="milliseconds").replace("+00:00", "Z")


def epoch(timestamp):
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)


def extract(packet):
    digests = {}

    def source(path, **locator):
        path = Path(path)
        if path not in digests:
            digests[path] = hashlib.sha256(path.read_bytes()).hexdigest()
        return {"path": str(path.relative_to(packet)), "sha256": digests[path], **locator}

    def read(path):
        return json.loads(path.read_text())

    clocks, tokens = {}, {}
    for lane in LANES:
        start_path = packet / "logs" / f"{lane}.start.json"
        start = read(start_path)
        started = start["startedEpoch"]
        assert epoch(start["startedAt"]) == started
        stream_path = packet / "logs" / f"{lane}.ndjson"
        usage_events, recovered = [], {}
        last_line = 0
        for line_no, line in enumerate(stream_path.open(), 1):
            event = json.loads(line)
            last_line = line_no
            expected = "turn.completed" if lane.startswith("astra-") else "result"
            if event.get("type") == expected:
                usage_events.append((line_no, event))
            if lane == "opus-supabase" and event.get("type") == "user":
                # A tool-result's captured run-log, not an unexecuted command or
                # an assistant's intention. Duplicate stdout representations agree.
                for content in event.get("message", {}).get("content", []):
                    if content.get("type") != "tool_result":
                        continue
                    for text in strings(content.get("content")):
                        for match in re.finditer(
                                r"(?m)^(\d{10}) (M[1-8]) GREEN \(first green\)$", text):
                            value, milestone = int(match[1]), match[2]
                            if milestone in recovered:
                                assert recovered[milestone][0] == value
                            else:
                                recovered[milestone] = (value, line_no, match[0])

        incomplete = lane == "opus-supabase"
        clock = {
            "lane": lane, "status": "incomplete" if incomplete else "complete",
            "started_at": start["startedAt"], "started_epoch": started,
            "start_source": source(start_path, fields=["startedAt", "startedEpoch"]),
            "ended_at": None, "ended_epoch": None, "builder_wall_seconds": None,
            "end_file_wall_seconds": None, "wall_discrepancy_seconds": None,
            "last_output_at": None, "last_output_epoch": None,
            "milestones": {},
        }
        if incomplete:
            terminated_path = packet / "logs" / f"{lane}.terminated.json"
            terminated = read(terminated_path)
            assert last_line == terminated["ndjsonLines"]
            clock.update({
                "not_run_reason": "Harness terminated; no end.json or final-report.md; not rerun, graded or scored.",
                "last_output_at": terminated["lastStdoutWriteAt"],
                "last_output_epoch": terminated["lastStdoutWriteEpoch"],
                "observed_output_span_seconds": terminated["lastStdoutWriteEpoch"] - started,
                "termination_source": source(terminated_path),
            })
            assert set(recovered) == set(MILESTONES)
            for milestone in MILESTONES:
                value, line_no, excerpt = recovered[milestone]
                clock["milestones"][milestone] = {
                    "status": "recovered builder first-green marker; ungraded",
                    "first_green_epoch": value, "first_green_at": iso(value),
                    "seconds_from_harness_start": value - started,
                    "source": source(stream_path, line=line_no, excerpt=excerpt),
                }
        else:
            end_path = packet / "logs" / f"{lane}.end.json"
            end = read(end_path)
            assert epoch(end["endedAt"]) == end["endedEpoch"]
            wall = end["endedEpoch"] - started
            clock.update({
                "ended_at": end["endedAt"], "ended_epoch": end["endedEpoch"],
                "builder_wall_seconds": wall,
                "end_file_wall_seconds": end["wallSeconds"],
                "wall_discrepancy_seconds": round(wall - end["wallSeconds"], 3),
                "end_source": source(end_path, fields=["endedAt", "endedEpoch", "wallSeconds"]),
            })
            report_path = packet / "lanes" / lane / "final-report.md"
            header = None
            for line_no, line in enumerate(report_path.read_text().splitlines(), 1):
                if not line.startswith("|"):
                    continue
                cells = [c.strip() for c in line.strip("|").split("|")]
                if cells[0] == "Milestone":
                    header = cells
                if not re.match(r"M[1-8]\b", cells[0]) or not header:
                    continue
                index = next((i for i, name in enumerate(header)
                              if name.lower().replace("-", " ").replace("retained ", "")
                              == "first green epoch"), None)
                if index is None or not re.fullmatch(r"\d{10}(?:\.\d+)?", cells[index]):
                    continue
                milestone = cells[0][:2]
                value = float(cells[index])
                clock["milestones"][milestone] = {
                    "status": "builder-reported green (not an independent grade)",
                    "first_green_epoch": value, "first_green_at": iso(value),
                    "seconds_from_harness_start": round(value - started, 3),
                    "source": source(report_path, line=line_no, column=header[index]),
                }
            assert set(clock["milestones"]) == set(MILESTONES), lane
            # Inspect combined suite/choreography greens without reading app stores
            # or secret files. These receipt times corroborate the report clocks.
            receipts = {}
            for folder in ("evidence", "receipts"):
                for path in sorted((packet / "lanes" / lane / folder).glob("*choreo*.jsonl")):
                    for line_no, line in enumerate(path.open(), 1):
                        event = json.loads(line)
                        if event.get("type") != "segment-summary" or not event.get("green"):
                            continue
                        milestone = event["segment"].upper()
                        if milestone not in MILESTONES:
                            continue
                        value = epoch(event["recordedAt"])
                        if milestone not in receipts or value < receipts[milestone][0]:
                            receipts[milestone] = (value, path, line_no, event)
            for milestone, (value, path, line_no, event) in receipts.items():
                item = clock["milestones"][milestone]
                item["earliest_retained_combined_green"] = {
                    "epoch": value, "at": event["recordedAt"],
                    "seconds_from_harness_start": round(value - started, 3),
                    "report_minus_receipt_seconds": round(item["first_green_epoch"] - value, 3),
                    "suite_pass": event["suite"]["pass"],
                    "choreography_pass": event["choreography"]["pass"],
                    "suite_receipt": event["suite"]["receipt"],
                    "suite_receipt_sha256": event["suite"].get("receiptSha256"),
                    "source": source(path, line=line_no),
                }
            assert "earliest_retained_combined_green" in clock["milestones"]["M8"]
        clock["milestones"]["M7"] = {"status": "not run", "first_green_epoch": None}
        clocks[lane] = clock

        token = {"lane": lane, "status": "not run" if incomplete else "recorded",
                 "source": source(stream_path), "input_tokens": None,
                 "output_tokens": None, "cache_read_input_tokens": None,
                 "cache_creation_input_tokens": None, "reasoning_output_tokens": None}
        if incomplete:
            assert not usage_events
            token["reason"] = "No terminal result event; partial message usage is not substituted."
        else:
            # Each supplied cold lane has exactly one terminal usage event.
            assert len(usage_events) == 1, (lane, len(usage_events))
            line_no, event = usage_events[0]
            usage = event["usage"]
            token["source"].update(line=line_no, event_type=event["type"], field="usage")
            token.update(input_tokens=usage["input_tokens"], output_tokens=usage["output_tokens"])
            if lane.startswith("astra-"):
                token.update(cache_read_input_tokens=usage["cached_input_tokens"],
                             cache_creation_input_tokens=usage["cache_write_input_tokens"],
                             reasoning_output_tokens=usage["reasoning_output_tokens"],
                             input_semantics="Codex input_tokens includes cached_input_tokens; do not add them.")
            else:
                token.update(cache_read_input_tokens=usage["cache_read_input_tokens"],
                             cache_creation_input_tokens=usage["cache_creation_input_tokens"],
                             reasoning_output_tokens=usage["output_tokens_details"]["thinking_tokens"],
                             input_semantics="Claude result usage separates input, cache-read and cache-creation.")
            token["raw_usage_counters"] = {k: usage[k] for k in usage if k.endswith("tokens")}
        tokens[lane] = token
    return clocks, tokens


if __name__ == "__main__":
    packet = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path(__file__).resolve().parent
    if output == packet or packet in output.parents:
        raise SystemExit("Output must be outside the read-only packet")
    clocks, tokens = extract(packet)
    output.mkdir(parents=True, exist_ok=True)
    for name, value in (("clocks", clocks), ("tokens", tokens)):
        (output / f"{name}.json").write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    print("Wrote clocks.json and tokens.json for six lanes (five complete, one incomplete).")
