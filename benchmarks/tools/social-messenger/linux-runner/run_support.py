#!/usr/bin/env python3
"""Small run-local helpers for foreground custody and raw Codex retention."""

import hashlib
import json
import os
import signal
import shutil
import subprocess
from pathlib import Path


LINUX_PATH_PREFIX = "/home/ccheever/.cargo/bin:/home/ccheever/.bun/bin:/home/ccheever/.local/bin"
# @ref LLP 1002#templates-are-products — a public client URL names one
# project's owner and must not leak from the shell launching another lane.
CLIENT_URL_ENVIRONMENT_VARIABLES = ("EXPO_PUBLIC_SNAPBACK_URL", "VITE_SNAPBACK_URL")


class ProcessInterrupted(Exception):
    pass


def wait_tracked_process(process: subprocess.Popen) -> tuple[int, str | None]:
    """Wait in foreground; on INT/TERM stop the exact child and return evidence."""
    tracked_signals = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
    previous_handlers = {signum: signal.getsignal(signum) for signum in tracked_signals}

    def interrupted(signum, _frame):
        raise ProcessInterrupted(signal.Signals(signum).name)

    for signum in tracked_signals:
        signal.signal(signum, interrupted)
    reason = None
    try:
        try:
            returncode = process.wait()
        except (KeyboardInterrupt, ProcessInterrupted) as error:
            reason = "SIGINT" if isinstance(error, KeyboardInterrupt) else str(error)
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
            try:
                returncode = process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    returncode = process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    returncode = process.wait(timeout=10)
        return returncode, reason
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)


def run_env() -> dict[str, str]:
    env = dict(os.environ)
    env["PATH"] = LINUX_PATH_PREFIX + ":" + env.get("PATH", "")
    env.pop("CI", None)
    for variable in CLIENT_URL_ENVIRONMENT_VARIABLES:
        env.pop(variable, None)
    return env


def rollout_snapshot() -> set[str]:
    root = Path.home() / ".codex" / "sessions"
    return {str(path.resolve()) for path in root.glob("**/rollout-*.jsonl")}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _session_meta(path: Path) -> dict:
    try:
        with path.open(errors="replace") as handle:
            record = json.loads(handle.readline())
    except Exception:
        return {}
    return record.get("payload", {}) if record.get("type") == "session_meta" else {}


def _stdout_thread_id(stdout_path: Path) -> str | None:
    try:
        with stdout_path.open(errors="replace") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if record.get("type") == "thread.started":
                    return record.get("thread_id")
    except FileNotFoundError:
        pass
    return None


def retain_codex_rollout_tree(
    *, root: Path, lane: Path, phase: str, stdout_path: Path,
    before: set[str], started_epoch: int, ended_epoch: int,
) -> Path:
    """Copy the fresh root/descendant rollouts; make no metering/cap claim."""
    new_paths = [Path(value) for value in sorted(rollout_snapshot() - before)]
    candidates = [(path, _session_meta(path)) for path in new_paths]
    root_id = _stdout_thread_id(stdout_path)
    selected_ids = {root_id} if root_id else set()
    changed = True
    while changed:
        changed = False
        for _, meta in candidates:
            native_id = meta.get("id") or meta.get("session_id")
            parent = meta.get("parent_thread_id") or meta.get("forked_from_id")
            if parent in selected_ids and native_id not in selected_ids:
                selected_ids.add(native_id)
                changed = True
    selected = []
    for path, meta in candidates:
        native_id = meta.get("id") or meta.get("session_id")
        if native_id in selected_ids:
            selected.append((path, meta))
    capture_dir = root / "native" / "codex" / phase
    capture_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for index, (source, meta) in enumerate(selected):
        destination = capture_dir / source.name
        shutil.copy2(source, destination)
        entries.append({
            "index": index,
            "nativeSessionId": meta.get("id") or meta.get("session_id"),
            "parentThreadId": meta.get("parent_thread_id") or meta.get("forked_from_id"),
            "threadSource": meta.get("thread_source"),
            "cwd": meta.get("cwd"),
            "relativePath": destination.relative_to(root).as_posix(),
            "sha256": _sha256(destination),
        })
    native_ids = {entry["nativeSessionId"] for entry in entries}
    manifest = {
        "version": "clique-raw-codex-retention.v1",
        "phase": phase,
        "rootThreadId": root_id,
        "lane": str(lane),
        "startedEpoch": started_epoch,
        "endedEpoch": ended_epoch,
        "freshRolloutCandidates": len(candidates),
        "selectedTreeEntries": len(entries),
        "rootFound": root_id is not None and root_id in native_ids,
        "rawRetention": "root-and-reachable-descendants",
        "tokenAccounting": "raw-retained-not-joined",
        "capBoundaryAdjudication": "unavailable-old-lightweight-runner-no-authentic-boundary-controller",
        "entries": entries,
    }
    manifest_path = capture_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    if not manifest["rootFound"]:
        raise RuntimeError(f"native root rollout missing; incomplete manifest retained at {manifest_path}")
    return manifest_path
