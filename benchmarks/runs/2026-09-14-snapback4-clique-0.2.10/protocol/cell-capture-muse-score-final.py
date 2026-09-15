#!/usr/bin/env python3
"""Capture Muse's public holistic-score answer from its terminal JSONL event.

This helper is intentionally external to the frozen benchmark packet. Run it
only after `scripts/run_phase.py score muse` has completed successfully.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple


DEFAULT_PACKET = Path("/Users/ccheever/clique-sb4-20260913-full-3models")
EXPECTED_LANE = "muse-snapback4"
EXPECTED_PHASE = "score"
EXPECTED_MODEL = "muse-spark-1.3"
SCORE_CATEGORIES = [
    "overall",
    "setup_and_docs",
    "data_modeling",
    "authorization",
    "queries_and_live",
    "writes_and_transactions",
    "offline_sync",
    "media_assets",
    "background_work",
    "client_integration",
    "diagnostics_dev_loop",
    "scale_and_limits",
    "operations",
]
FINAL_SCORE = re.compile(
    r"\A[\t\r\n ]*```json[\t ]*\r?\n(?P<body>[\t\r\n ]*\{.*\}[\t\r\n ]*)```[\t\r\n ]*\Z",
    re.DOTALL,
)


class CaptureError(Exception):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_object(path: Path, label: str) -> Tuple[Dict[str, Any], bytes]:
    try:
        raw = path.read_bytes()
    except FileNotFoundError as error:
        raise CaptureError(f"missing {label}: {path}") from error
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CaptureError(f"invalid JSON in {label}: {path}: {error}") from error
    if not isinstance(value, dict):
        raise CaptureError(f"{label} must be a JSON object: {path}")
    return value, raw


def path_matches(recorded: Any, expected: Path) -> bool:
    return isinstance(recorded, str) and Path(recorded).expanduser().resolve() == expected.resolve()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CaptureError(message)


def validate_lifecycle(packet: Path, raw_path: Path) -> Tuple[Dict[str, Any], Dict[str, Any], bytes, bytes]:
    start_path = packet / "logs/muse-snapback4.score.start.json"
    end_path = packet / "logs/muse-snapback4.score.end.json"
    start, start_raw = load_object(start_path, "score start lifecycle")
    end, end_raw = load_object(end_path, "score end lifecycle")

    for label, record in (("start", start), ("end", end)):
        require(record.get("lane") == EXPECTED_LANE, f"{label} lifecycle lane is not {EXPECTED_LANE}")
        require(record.get("phase") == EXPECTED_PHASE, f"{label} lifecycle phase is not {EXPECTED_PHASE}")
        require(path_matches(record.get("stdout"), raw_path), f"{label} lifecycle stdout does not name {raw_path}")
    require(end.get("exitCode") == 0, "Muse score lifecycle did not exit successfully")
    require(isinstance(start.get("pid"), int) and end.get("pid") == start.get("pid"), "score lifecycle PID mismatch")
    require(start.get("model") == EXPECTED_MODEL, f"score lifecycle model is not {EXPECTED_MODEL}")
    require(path_matches(start.get("cwd"), packet), "score lifecycle cwd does not name the packet root")
    require(path_matches(start.get("prompt"), packet / "prompts/muse-snapback4.score.md"), "score lifecycle prompt path is wrong")

    command = start.get("command")
    require(isinstance(command, list) and all(isinstance(item, str) for item in command), "score lifecycle command is invalid")
    require(len(command) >= 2 and Path(command[0]).name == "muse" and command[1] == "exec", "score lifecycle command is not muse exec")
    require("--json" in command, "Muse score lifecycle command did not request JSONL")
    model_index = command.index("--model") if "--model" in command else -1
    require(model_index >= 0 and model_index + 1 < len(command) and command[model_index + 1] == EXPECTED_MODEL, "Muse score lifecycle command model mismatch")
    return start, end, start_raw, end_raw


def load_events(raw_path: Path) -> Tuple[bytes, List[Tuple[Dict[str, Any], bytes]]]:
    try:
        raw = raw_path.read_bytes()
    except FileNotFoundError as error:
        raise CaptureError(f"missing Muse score JSONL: {raw_path}") from error
    events: List[Tuple[Dict[str, Any], bytes]] = []
    previous_sequence = 0
    for line_number, line_with_ending in enumerate(raw.splitlines(keepends=True), 1):
        line = line_with_ending.rstrip(b"\r\n")
        require(bool(line), f"blank JSONL record at line {line_number}")
        try:
            event = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise CaptureError(f"invalid JSONL record at line {line_number}: {error}") from error
        require(isinstance(event, dict), f"JSONL record {line_number} is not an object")
        sequence = event.get("sequence")
        require(isinstance(sequence, int) and sequence > previous_sequence, f"non-increasing sequence at line {line_number}")
        previous_sequence = sequence
        events.append((event, line))
    require(bool(events), "Muse score JSONL is empty")
    return raw, events


def select_public_terminal(events: List[Tuple[Dict[str, Any], bytes]]) -> Tuple[Dict[str, Any], bytes, str, str, str]:
    session_streams = {
        json.dumps(event.get("stream"), sort_keys=True, separators=(",", ":"))
        for event, _ in events
    }
    require(len(session_streams) == 1, "Muse JSONL has more than one top-level session stream")
    session_stream = events[0][0].get("stream")
    require(isinstance(session_stream, dict) and session_stream.get("kind") == "session" and isinstance(session_stream.get("id"), str), "Muse JSONL session stream is invalid")

    linked = [
        event for event, _ in events
        if event.get("record_type") == "event"
        and event.get("durability") == "durable"
        and event.get("payload_type") == "session.run.linked"
        and isinstance(event.get("payload"), dict)
        and event["payload"].get("kind") == "session_run_linked"
    ]
    require(len(linked) == 1, f"expected one durable session.run.linked event, found {len(linked)}")
    link_payload = linked[0]["payload"]
    run_stream = link_payload.get("run_stream")
    command_id = link_payload.get("command_id")
    require(isinstance(run_stream, dict) and run_stream.get("kind") == "run" and isinstance(run_stream.get("id"), str), "linked run stream is invalid")
    require(isinstance(command_id, str) and command_id, "linked run command id is invalid")

    configured = [
        event for event, _ in events
        if event.get("record_type") == "event"
        and event.get("durability") == "durable"
        and event.get("payload_type") == "run.model.configured"
    ]
    require(len(configured) == 1, f"expected one durable run.model.configured event, found {len(configured)}")
    model_payload = configured[0].get("payload")
    require(isinstance(model_payload, dict), "run.model.configured payload is invalid")
    require(model_payload.get("run_stream") == run_stream and model_payload.get("command_id") == command_id, "configured model belongs to another run")
    require(model_payload.get("model_id") == EXPECTED_MODEL, f"configured model is not {EXPECTED_MODEL}")

    terminals = [
        (event, line) for event, line in events
        if isinstance(event.get("payload_type"), str)
        and event["payload_type"].startswith("run.terminal.")
    ]
    require(len(terminals) == 1, f"expected exactly one run terminal event, found {len(terminals)}")
    terminal, terminal_line = terminals[0]
    payload = terminal.get("payload")
    require(terminal.get("record_type") == "event", "run terminal is not an event record")
    require(terminal.get("durability") == "durable", "run terminal is not durable")
    require(terminal.get("payload_type") == "run.terminal.completed", "run terminal is not completed")
    require(isinstance(payload, dict) and payload.get("kind") == "run_terminal", "run terminal payload is invalid")
    require(payload.get("terminal") == "completed" and payload.get("reason") is None, "run terminal does not report clean completion")
    require(payload.get("run_stream") == run_stream and payload.get("command_id") == command_id, "run terminal belongs to another run")
    require(terminal.get("causation_id") == command_id, "run terminal causation does not match its command")
    require(terminal is events[-1][0], "run terminal is not the final JSONL record")
    text = payload.get("text")
    require(isinstance(text, str) and text, "completed run terminal has no public answer text")
    return terminal, terminal_line, text, session_stream["id"], run_stream["id"]


def validate_final_score(text: str) -> Dict[str, Any]:
    require(text.count("```") == 2, "public final answer must contain exactly one fenced JSON block")
    match = FINAL_SCORE.fullmatch(text)
    require(match is not None, "public final answer must contain only one fenced JSON block and surrounding whitespace")
    body = match.group("body")
    try:
        score = json.loads(body)
    except json.JSONDecodeError as error:
        raise CaptureError(f"public final answer contains invalid score JSON: {error}") from error
    require(isinstance(score, dict), "public final score must be a JSON object")

    scorer = score.get("scorer")
    require(isinstance(scorer, dict), "public final score has no scorer object")
    require(scorer.get("family") == "muse", "public final score scorer family is not muse")
    require(scorer.get("model") == EXPECTED_MODEL, f"public final score scorer model is not {EXPECTED_MODEL}")

    backends = score.get("backends")
    require(isinstance(backends, dict), "public final score has no backends object")
    backend = backends.get("snapback4")
    require(isinstance(backend, dict), "public final score has no snapback4 object")
    for category in SCORE_CATEGORIES:
        entry = backend.get(category)
        require(isinstance(entry, dict), f"public final snapback4 score is missing {category}")
        value = entry.get("score")
        require(type(value) is int and 0 <= value <= 100, f"public final snapback4 {category} score must be a non-boolean integer from 0 through 100")
        note = entry.get("note")
        require(isinstance(note, str) and bool(note.strip()), f"public final snapback4 {category} note is empty")
    verdict = backend.get("verdict")
    would_use_again_for = backend.get("would_use_again_for")
    require(isinstance(verdict, str) and bool(verdict.strip()), "public final snapback4 verdict is empty")
    require(isinstance(would_use_again_for, str) and bool(would_use_again_for.strip()), "public final snapback4 would_use_again_for is empty")

    body_bytes = body.encode("utf-8")
    return {
        "fencedJsonBlocks": 1,
        "onlySurroundingWhitespace": True,
        "fencedJsonBytes": len(body_bytes),
        "fencedJsonSha256": sha256(body_bytes),
        "scorerFamily": "muse",
        "scorerModel": EXPECTED_MODEL,
        "backend": "snapback4",
        "requiredEntries": list(SCORE_CATEGORIES),
        "requiredEntryCount": len(SCORE_CATEGORIES),
        "integerScoresExcludeBoolean": True,
        "scoreMinimum": 0,
        "scoreMaximum": 100,
        "nonemptyNotes": True,
        "nonemptyVerdict": True,
        "nonemptyWouldUseAgainFor": True,
    }


def write_exclusive(path: Path, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o644)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        raise


def capture(packet: Path, dry_run: bool) -> Dict[str, Any]:
    packet = packet.expanduser().resolve()
    raw_path = packet / "scores/muse/raw.out"
    final_path = packet / "scores/muse/FINAL.md"
    receipt_path = packet / "scores/muse/FINAL.provenance.json"
    require(not final_path.exists(), f"refusing to replace existing final answer: {final_path}")
    require(not receipt_path.exists(), f"refusing to replace existing provenance receipt: {receipt_path}")

    start, end, start_raw, end_raw = validate_lifecycle(packet, raw_path)
    raw, events = load_events(raw_path)
    terminal, terminal_line, text, session_id, run_id = select_public_terminal(events)
    score_validation = validate_final_score(text)
    final_bytes = text.encode("utf-8")
    payload = terminal["payload"]
    receipt: Dict[str, Any] = {
        "schemaVersion": 1,
        "kind": "muse-score-final-public-answer-capture",
        "capturedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "packetRoot": str(packet),
        "source": "scores/muse/raw.out:run.terminal.completed.payload.text",
        "raw": {"path": str(raw_path), "bytes": len(raw), "sha256": sha256(raw)},
        "lifecycle": {
            "startPath": str(packet / "logs/muse-snapback4.score.start.json"),
            "startSha256": sha256(start_raw),
            "endPath": str(packet / "logs/muse-snapback4.score.end.json"),
            "endSha256": sha256(end_raw),
            "exitCode": end["exitCode"],
            "pid": start["pid"],
            "model": start["model"],
        },
        "stream": {"sessionId": session_id, "runId": run_id, "commandId": payload["command_id"]},
        "terminalEvent": {
            "id": terminal.get("id"),
            "sequence": terminal["sequence"],
            "recordedAt": terminal.get("recorded_at"),
            "sha256": sha256(terminal_line),
            "hashBasis": "exact raw JSONL record bytes excluding its line terminator",
        },
        "final": {
            "path": str(final_path),
            "bytes": len(final_bytes),
            "sha256": sha256(final_bytes),
            "validation": score_validation,
        },
    }

    if not dry_run:
        require(final_path.parent.is_dir(), f"score output directory is missing: {final_path.parent}")
        write_exclusive(final_path, final_bytes)
        try:
            write_exclusive(receipt_path, (json.dumps(receipt, indent=2, sort_keys=True) + "\n").encode("utf-8"))
        except BaseException:
            final_path.unlink(missing_ok=True)
            raise
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("packet", nargs="?", type=Path, default=DEFAULT_PACKET)
    parser.add_argument("--dry-run", action="store_true", help="validate and print receipt metadata without writing FINAL.md or its receipt")
    args = parser.parse_args()
    try:
        receipt = capture(args.packet, args.dry_run)
    except CaptureError as error:
        print(f"capture refused: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "dryRun": args.dry_run, "receipt": receipt}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
