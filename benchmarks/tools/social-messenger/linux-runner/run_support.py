#!/usr/bin/env python3
"""Small run-local helpers for foreground custody and raw Codex retention."""

from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
import re
import secrets
import select
import signal
import shutil
import socket
import stat as stat_module
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import urllib.parse
from contextlib import contextmanager
from errno import EACCES, EADDRINUSE
from pathlib import Path


LINUX_PATH_PREFIX = "/home/ccheever/.cargo/bin:/home/ccheever/.bun/bin:/home/ccheever/.local/bin"
# @ref LLP 1002#templates-are-products — a public client URL names one
# project's owner and must not leak from the shell launching another lane.
CLIENT_URL_ENVIRONMENT_VARIABLES = ("EXPO_PUBLIC_SNAPBACK_URL", "VITE_SNAPBACK_URL")
RUN_LOCK_FD_ENV = "CLIQUE_RUN_ROOT_LOCK_FD"
RUN_LOCK_ID_ENV = "CLIQUE_RUN_ROOT_LOCK_ID"
CHILD_SUBREAPER = 36
SCALE_RUN_ID_ENV = "CLIQUE_SCALE_CUSTODY_RUN_ID"
SCALE_MILESTONE_ENV = "CLIQUE_SCALE_MILESTONE"
SCALE_ATTEMPT_ENV = "CLIQUE_SCALE_ATTEMPT"
SCALE_RESULT_ENV = "CLIQUE_SCALE_RESULT"


class ProcessInterrupted(Exception):
    pass


def enable_child_subreaper() -> None:
    """Adopt daemonized actor descendants so their launch ancestry stays provable."""
    if not Path("/proc/self/stat").is_file():
        raise RuntimeError("Clique Linux process custody requires /proc")
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def _process_identity(pid: int) -> dict | None:
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
        _, fields = stat.rsplit(") ", 1)
        values = fields.split()
        command = Path(f"/proc/{pid}/cmdline").read_bytes().rstrip(b"\0").split(b"\0")
        return {
            "pid": pid,
            "parentPid": int(values[1]),
            "state": values[0],
            "startTicks": int(values[19]),
            "cwd": str(Path(f"/proc/{pid}/cwd").resolve()),
            "command": [value.decode(errors="replace") for value in command],
        }
    except (FileNotFoundError, PermissionError, ProcessLookupError, ValueError):
        return None


def _process_table() -> dict[int, dict]:
    table = {}
    for entry in Path("/proc").iterdir():
        if entry.name.isdigit():
            identity = _process_identity(int(entry.name))
            if identity is not None:
                table[identity["pid"]] = identity
    return table


def _descends_from(pid: int, ancestor: int, table: dict[int, dict]) -> bool:
    visited = set()
    while pid in table and pid not in visited:
        if pid == ancestor:
            return True
        visited.add(pid)
        pid = table[pid]["parentPid"]
    return False


def _process_summary(identity: dict) -> dict:
    return {"pid": identity["pid"], "parentPid": identity["parentPid"],
            "startTicks": identity["startTicks"], "command": identity["command"]}


def _finite_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _pidfd_pid(fd: int) -> int | None:
    try:
        for line in Path(f"/proc/self/fdinfo/{fd}").read_text().splitlines():
            if line.startswith("Pid:\t"):
                value = int(line.split("\t", 1)[1])
                return value if value >= 0 else None
    except (FileNotFoundError, PermissionError, ValueError):
        pass
    return None


class _ProcessHandle:
    """An exact Linux process identity whose later signals cannot cross PID reuse."""

    def __init__(self, identity: dict, fd: int):
        self.identity = identity
        self.fd = fd
        self.closed = False

    @classmethod
    def open(cls, identity: dict) -> _ProcessHandle | None:
        try:
            fd = os.pidfd_open(identity["pid"], 0)
        except (AttributeError, OSError):
            return None
        handle = cls(identity, fd)
        current = _process_identity(identity["pid"])
        if current is None or current["startTicks"] != identity["startTicks"] \
                or _pidfd_pid(fd) != identity["pid"]:
            handle.close()
            return None
        return handle

    def revalidate(self) -> bool:
        if self.closed or _pidfd_pid(self.fd) != self.identity["pid"]:
            return False
        current = _process_identity(self.identity["pid"])
        return current is not None and current["startTicks"] == self.identity["startTicks"]

    def alive(self) -> bool:
        if self.closed:
            return False
        poller = select.poll()
        poller.register(self.fd, select.POLLIN | select.POLLHUP | select.POLLERR)
        return not poller.poll(0)

    def send_signal(self, signum: int) -> bool:
        if not self.alive():
            return False
        try:
            signal.pidfd_send_signal(self.fd, signum)
            return True
        except ProcessLookupError:
            return False

    def close(self) -> None:
        if not self.closed:
            os.close(self.fd)
            self.closed = True


def _process_environment(handle: _ProcessHandle) -> dict[str, str] | None:
    try:
        fields = Path(f"/proc/{handle.identity['pid']}/environ").read_bytes().split(b"\0")
    except (FileNotFoundError, PermissionError, ProcessLookupError):
        return None
    if not handle.revalidate():
        return None
    values = {}
    for field in fields:
        key, separator, value = field.partition(b"=")
        if separator:
            values[key.decode(errors="replace")] = value.decode(errors="replace")
    return values


def _port_closed(url: str | None) -> bool | None:
    if not isinstance(url, str):
        return None
    parsed = urllib.parse.urlparse(url)
    if parsed.hostname is None or parsed.port is None:
        return None
    try:
        with socket.create_connection((parsed.hostname, parsed.port), timeout=0.5):
            return False
    except OSError:
        return True


def _owner_project(identity: dict) -> Path | None:
    command = identity["command"]
    if "dev" not in command or not any("snapback2" in Path(arg).name for arg in command):
        return None
    try:
        project_index = command.index("--project")
        project = Path(command[project_index + 1])
    except (ValueError, IndexError):
        project = Path(identity["cwd"])
    if not project.is_absolute():
        project = Path(identity["cwd"]) / project
    return project.resolve()


def _is_scale_project(project: Path, lane: Path) -> bool:
    try:
        relative = project.relative_to(lane)
    except ValueError:
        return False
    return any("scale" in part.lower() for part in relative.parts)


# @ref LLP 0201#d2--quantitative-instrument — a terminal scale clock releases
# only the pidfd-bound owner which declared that run/milestone/attempt result.
class ScaleOwnerCustody:
    """Track actor-created scale owners and stop only their proven process identities."""

    def __init__(self, *, root: Path, lane: Path, name: str, poll_seconds: float = 0.2):
        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise RuntimeError("Clique Linux process custody requires pidfd signaling")
        self.root = root.resolve()
        self.lane = lane.resolve()
        self.actor_pid = None
        self.launcher_pid = os.getpid()
        self.actor_identity = None
        self.name = name
        self.poll_seconds = poll_seconds
        self.run_id = secrets.token_hex(16)
        self.started_ns = time.time_ns()
        self.receipt_path = self.root / "logs" / f"{name}.scale-owners.jsonl"
        self.owners: dict[tuple[int, int], dict] = {}
        self.associations: dict[tuple[str, int], tuple[int, int]] = {}
        self.result_associations: dict[str, tuple[int, int]] = {}
        self.initial_terminals = self._initial_terminal_fingerprints()
        self.errors: list[str] = []
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._monitor, name=f"{name}-scale-custody", daemon=True)

    def actor_env(self, base: dict[str, str]) -> dict[str, str]:
        env = dict(base)
        env[SCALE_RUN_ID_ENV] = self.run_id
        for variable in (SCALE_MILESTONE_ENV, SCALE_ATTEMPT_ENV, SCALE_RESULT_ENV):
            env.pop(variable, None)
        return env

    def start(self, actor_pid: int) -> None:
        self.actor_pid = actor_pid
        self.actor_identity = _process_identity(actor_pid)
        if self.actor_identity is None:
            raise RuntimeError(f"actor pid {actor_pid} has no observable Linux identity")
        self.receipt_path.parent.mkdir(parents=True, exist_ok=True)
        self._record({"event": "monitor-started", "runId": self.run_id,
                      "actorPid": self.actor_pid,
                      "actorStartTicks": self.actor_identity["startTicks"],
                      "launcherPid": self.launcher_pid,
                      "custodyStartedNs": self.started_ns,
                      "terminalBaselineCount": len(self.initial_terminals)})
        self._thread.start()

    def _record(self, value: dict) -> None:
        value = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **value}
        with self.receipt_path.open("a") as handle:
            handle.write(json.dumps(value, sort_keys=True) + "\n")

    def _owned_by_actor(self, identity: dict, table: dict[int, dict]) -> bool:
        if identity["startTicks"] < self.actor_identity["startTicks"]:
            return False
        return _descends_from(identity["pid"], self.actor_pid, table) or identity["parentPid"] == self.launcher_pid

    def _candidate_terminal_paths(self) -> list[Path]:
        paths = [self.lane / "scale-replay.json", self.lane / "scale-replay-failure.json"]
        evidence = self.lane / "evidence"
        if evidence.is_dir():
            paths.extend(evidence.glob("scale*/result.json"))
            paths.extend(evidence.glob("*/scale*/result.json"))
        return paths

    @staticmethod
    def _read_regular(path: Path) -> tuple[bytes, tuple[int, int, int, str]] | None:
        try:
            before = path.lstat()
            if not stat_module.S_ISREG(before.st_mode):
                return None
            value = path.read_bytes()
            after = path.lstat()
        except (FileNotFoundError, PermissionError, OSError):
            return None
        before_identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        after_identity = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        if before_identity != after_identity:
            return None
        digest = hashlib.sha256(value).hexdigest()
        return value, (after.st_dev, after.st_ino, after.st_size, digest)

    def _initial_terminal_fingerprints(self) -> dict[str, tuple[int, int, int, str]]:
        fingerprints = {}
        for path in self._candidate_terminal_paths():
            result = self._read_regular(path)
            if result is not None:
                fingerprints[str(path.resolve())] = result[1]
        return fingerprints

    def _declaration(self, handle: _ProcessHandle) -> tuple[dict | None, str | None]:
        env = _process_environment(handle)
        if env is None:
            return None, "process environment could not be bound to the opened pidfd"
        if env.get(SCALE_RUN_ID_ENV) != self.run_id:
            return None, f"missing current {SCALE_RUN_ID_ENV}"
        milestone = env.get(SCALE_MILESTONE_ENV, "")
        if not re.fullmatch(r"M[1-8]", milestone):
            return None, f"{SCALE_MILESTONE_ENV} must be M1 through M8"
        attempt_text = env.get(SCALE_ATTEMPT_ENV, "")
        if not re.fullmatch(r"[1-9][0-9]*", attempt_text):
            return None, f"{SCALE_ATTEMPT_ENV} must be a positive integer"
        result_text = env.get(SCALE_RESULT_ENV, "")
        result_path = Path(result_text)
        if not result_path.is_absolute():
            return None, f"{SCALE_RESULT_ENV} must be absolute"
        result_path = result_path.resolve()
        try:
            result_path.relative_to(self.lane)
        except ValueError:
            return None, f"{SCALE_RESULT_ENV} must stay inside the lane"
        if result_path.suffix != ".json":
            return None, f"{SCALE_RESULT_ENV} must name a JSON file"
        return {"runId": self.run_id, "milestone": milestone,
                "attempt": int(attempt_text), "result": str(result_path)}, None

    def _discover(self, table: dict[int, dict]) -> None:
        for identity in table.values():
            project = _owner_project(identity)
            if project is None or not _is_scale_project(project, self.lane) or not self._owned_by_actor(identity, table):
                continue
            owner_path = project / ".snapback" / "owner.json"
            try:
                raw = json.loads(owner_path.read_text())
            except (FileNotFoundError, json.JSONDecodeError, PermissionError):
                continue
            try:
                owner_project = Path(raw.get("project", "")).resolve()
            except TypeError:
                continue
            if raw.get("pid") != identity["pid"] or owner_project != project:
                continue
            key = (identity["pid"], identity["startTicks"])
            if key in self.owners:
                continue
            handle = _ProcessHandle.open(identity)
            if handle is None:
                continue
            try:
                repeated = json.loads(owner_path.read_text())
            except (FileNotFoundError, json.JSONDecodeError, PermissionError):
                handle.close()
                continue
            if repeated.get("pid") != identity["pid"] or repeated.get("project") != raw.get("project") \
                    or not handle.revalidate():
                handle.close()
                continue
            declaration, association_error = self._declaration(handle)
            if declaration is not None:
                association = (declaration["milestone"], declaration["attempt"])
                result = declaration["result"]
                if association in self.associations:
                    association_error = f"duplicate active milestone/attempt {association}"
                    declaration = None
                elif result in self.result_associations:
                    association_error = f"duplicate active result path {result}"
                    declaration = None
            owner = {"identity": identity, "project": str(project), "url": raw.get("url"),
                     "secret": raw.get("secret"), "startedAt": raw.get("startedAt"),
                     "generation": raw.get("generation"), "handle": handle,
                     "descendants": {}, "cleaned": False, "declaration": declaration,
                     "associationError": association_error, "seenTerminals": set()}
            self.owners[key] = owner
            if declaration is not None:
                self.associations[(declaration["milestone"], declaration["attempt"])] = key
                self.result_associations[declaration["result"]] = key
            self._refresh_descendants(owner, table)
            self._record({"event": "claimed", "ownerPid": identity["pid"], "ownerStartTicks": identity["startTicks"],
                          "project": str(project), "url": raw.get("url"),
                          "generation": raw.get("generation"), "declaration": declaration,
                          "associationError": association_error,
                          "descendants": [_process_summary(child.identity) for child in owner["descendants"].values()],
                          "compilerWorkers": [_process_summary(child.identity) for child in owner["descendants"].values()
                                              if "--worker" in child.identity["command"]],
                          "ownership": "actor ancestry or Linux child-subreaper adoption plus matching owner.json"})

    @staticmethod
    def _timestamp_millis(value, field: str) -> int:
        if not isinstance(value, str):
            raise ValueError(f"{field} must be an RFC3339 string")
        try:
            parsed = __import__("datetime").datetime.fromisoformat(value.replace("Z", "+00:00"))
            return round(parsed.timestamp() * 1000)
        except ValueError as error:
            raise ValueError(f"{field} must be an RFC3339 string") from error

    def _validate_success(self, value: dict, owner: dict) -> str:
        required_numbers = ("capSeconds", "probeWallSecondsExcluded", "wallSeconds", "capFractionUsed")
        if value.get("attempted") is not True or any(not _finite_number(value.get(field))
                                                       for field in required_numbers):
            raise ValueError("canonical replay is missing its clock contract")
        if value["capSeconds"] <= 0 or value["probeWallSecondsExcluded"] < 0 \
                or not isinstance(value.get("capExhausted"), bool):
            raise ValueError("canonical replay has invalid clock bounds")
        attempts = value.get("attempts")
        if not isinstance(attempts, list) or not attempts:
            raise ValueError("canonical replay has no attempts")
        previous_finished = None
        previous_prefix = 0
        total = 0.0
        for index, attempt in enumerate(attempts, 1):
            if not isinstance(attempt, dict) or attempt.get("attempt") != index:
                raise ValueError("canonical replay attempt numbering is invalid")
            started = self._timestamp_millis(attempt.get("startedAt"), f"attempt {index}.startedAt")
            finished = self._timestamp_millis(attempt.get("finishedAt"), f"attempt {index}.finishedAt")
            prefix = attempt.get("settledPrefix")
            expected_continuation = None if index == 1 else index - 1
            final = index == len(attempts)
            if finished < started or (previous_finished is not None and started < previous_finished) \
                    or not isinstance(prefix, int) or isinstance(prefix, bool) or prefix < previous_prefix \
                    or attempt.get("continuationOf") != expected_continuation \
                    or (final and attempt.get("disposition") not in ("completed", "aborted")) \
                    or (not final and attempt.get("disposition") != "continued"):
                raise ValueError("canonical replay attempt chronology is invalid")
            previous_finished, previous_prefix = finished, prefix
            total += (finished - started) / 1000
        declaration = owner["declaration"]
        if len(attempts) != declaration["attempt"]:
            raise ValueError("canonical final attempt differs from the owner declaration")
        owner_started = owner.get("startedAt")
        if _finite_number(owner_started) and self._timestamp_millis(attempts[-1]["startedAt"], "final attempt.startedAt") < owner_started:
            raise ValueError("canonical final attempt predates its owner")
        wall = total - value["probeWallSecondsExcluded"]
        if value["wallSeconds"] != wall or value["capFractionUsed"] != wall / value["capSeconds"] \
                or value["capExhausted"] != (wall >= value["capSeconds"]):
            raise ValueError("canonical replay derived clock is inconsistent")
        receipt = value.get("receipt")
        if not isinstance(receipt, dict) or not isinstance(receipt.get("path"), str) \
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", receipt.get("sha256", "")):
            raise ValueError("canonical replay lacks a digest-bound receipt")
        receipt_path = (self.lane / receipt["path"]).resolve()
        try:
            receipt_path.relative_to(self.lane)
        except ValueError as error:
            raise ValueError("canonical receipt escapes the lane") from error
        read = self._read_regular(receipt_path)
        if read is None or "sha256:" + read[1][3] != receipt["sha256"]:
            raise ValueError("canonical receipt is missing, mutable, or has the wrong digest")
        try:
            receipt_value = json.loads(read[0])
        except json.JSONDecodeError as error:
            raise ValueError("canonical receipt is malformed") from error
        if receipt_value.get("version") != "snapback.full-journey-scale-replay-receipt.v1" \
                or not isinstance(receipt_value.get("pass"), bool) \
                or not isinstance(receipt_value.get("actionLog"), dict) \
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", receipt_value["actionLog"].get("sha256", "")) \
                or not isinstance(receipt_value["actionLog"].get("actionCount"), int) \
                or isinstance(receipt_value["actionLog"].get("actionCount"), bool) \
                or not isinstance(receipt_value.get("settledPrefix"), int) \
                or isinstance(receipt_value.get("settledPrefix"), bool) \
                or receipt_value["settledPrefix"] != attempts[-1]["settledPrefix"] \
                or receipt_value["settledPrefix"] > receipt_value["actionLog"]["actionCount"] \
                or not isinstance(receipt_value.get("failedActions"), int) \
                or isinstance(receipt_value.get("failedActions"), bool) \
                or receipt_value["failedActions"] < 0 \
                or not isinstance(receipt_value.get("checkpoints"), list):
            raise ValueError("canonical receipt shape or final prefix is invalid")
        disposition = attempts[-1]["disposition"]
        if disposition == "completed" and (receipt_value["pass"] is not True or receipt_value["failedActions"] != 0):
            raise ValueError("completed replay lacks a passing receipt")
        if disposition == "aborted" and receipt_value["pass"] is not False:
            raise ValueError("aborted replay receipt claims pass")
        return "success" if disposition == "completed" else "failure:aborted"

    def _validate_failure(self, value: dict, owner: dict) -> str:
        outcome = value.get("outcome")
        if outcome not in ("aborted", "settlement-timeout") or value.get("clock", {}).get("attempted") is not True:
            raise ValueError("canonical replay failure has an unsupported disposition")
        started = self._timestamp_millis(value.get("startedAt"), "failure.startedAt")
        finished = self._timestamp_millis(value.get("finishedAt"), "failure.finishedAt")
        if finished < started or value["clock"].get("wallSeconds") != (finished - started) / 1000:
            raise ValueError("canonical replay failure clock is inconsistent")
        owner_started = owner.get("startedAt")
        if _finite_number(owner_started) and started < owner_started:
            raise ValueError("canonical replay failure predates its owner")
        if not isinstance(value.get("failure"), dict) or not isinstance(value["failure"].get("message"), str):
            raise ValueError("canonical replay failure lacks its failure envelope")
        return f"failure:{outcome}"

    @staticmethod
    def _validate_raw(value: dict, owner: dict) -> str:
        if not isinstance(value.get("pass"), bool) or not isinstance(value.get("actions"), int) \
                or isinstance(value.get("actions"), bool) or value["actions"] < 0 \
                or not _finite_number(value.get("start")) \
                or not _finite_number(value.get("end")) or value["end"] < value["start"] \
                or not _finite_number(value.get("excludedProbeMs")) or value["excludedProbeMs"] < 0 \
                or not re.fullmatch(r"[a-f0-9]{64}", value.get("sourceSha256", "")):
            raise ValueError("raw scale result does not match the maintained replay report shape")
        owner_started = owner.get("startedAt")
        if isinstance(owner_started, (int, float)) and value["start"] * 1000 < owner_started:
            raise ValueError("raw scale result predates its owner")
        return "success" if value["pass"] else "failure"

    def _terminal_for(self, owner: dict) -> tuple[Path, str, str] | None:
        declaration = owner["declaration"]
        if declaration is None:
            return None
        path = Path(declaration["result"])
        read = self._read_regular(path)
        if read is None:
            return None
        payload, fingerprint = read
        digest = fingerprint[3]
        seen_key = (fingerprint[0], fingerprint[1], fingerprint[2], digest)
        if seen_key in owner["seenTerminals"]:
            return None
        owner["seenTerminals"].add(seen_key)
        initial = self.initial_terminals.get(str(path))
        if initial is not None and initial[3] == digest:
            self._record({"event": "terminal-rejected", "project": owner["project"],
                          "result": str(path), "sha256": digest,
                          "reason": "terminal content existed before actor launch"})
            return None
        try:
            value = json.loads(payload)
            if not isinstance(value, dict):
                raise ValueError("terminal must be a JSON object")
            if value.get("version") == "snapback.full-journey-scale-replay.v1":
                outcome = self._validate_success(value, owner)
            elif value.get("version") == "snapback.full-journey-scale-replay-failure.v1":
                outcome = self._validate_failure(value, owner)
            elif "version" not in value:
                outcome = self._validate_raw(value, owner)
            else:
                raise ValueError("terminal version is unsupported")
        except (json.JSONDecodeError, ValueError, TypeError, ZeroDivisionError) as error:
            self._record({"event": "terminal-rejected", "project": owner["project"],
                          "result": str(path), "sha256": digest, "reason": str(error)})
            return None
        self._record({"event": "terminal-associated", "project": owner["project"],
                      "ownerPid": owner["identity"]["pid"], "declaration": declaration,
                      "result": str(path), "sha256": digest, "outcome": outcome})
        return path, outcome, digest

    def _refresh_descendants(self, owner: dict, table: dict[int, dict]) -> None:
        identity = owner["identity"]
        for child in table.values():
            key = (child["pid"], child["startTicks"])
            if child["pid"] == identity["pid"] or key in owner["descendants"] \
                    or not _descends_from(child["pid"], identity["pid"], table):
                continue
            handle = _ProcessHandle.open(child)
            if handle is not None:
                owner["descendants"][key] = handle

    @staticmethod
    def _wait_gone(handles: list[_ProcessHandle], timeout: float) -> list[_ProcessHandle]:
        deadline = time.monotonic() + timeout
        remaining = [handle for handle in handles if handle.alive()]
        while remaining and time.monotonic() < deadline:
            time.sleep(0.05)
            remaining = [handle for handle in remaining if handle.alive()]
        return remaining

    @staticmethod
    def _close_owner_handles(owner: dict) -> None:
        owner["handle"].close()
        for child in owner["descendants"].values():
            child.close()

    def _stop_owner(self, owner: dict, reason: str) -> None:
        table = _process_table()
        identity = owner["identity"]
        self._refresh_descendants(owner, table)
        descendants = list(owner["descendants"].values())
        handles = [owner["handle"], *descendants]
        control = "not-attempted"
        if owner["handle"].alive() and isinstance(owner["url"], str) and isinstance(owner["secret"], str):
            request = urllib.request.Request(owner["url"] + "/control/stop", method="POST", data=b'{"cause":"clique scale verification complete"}',
                                             headers={"content-type": "application/json", "x-snapback-control": owner["secret"]})
            try:
                with urllib.request.urlopen(request, timeout=5) as response:
                    control = f"http-{response.status}"
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                control = f"error:{type(error).__name__}"
        remaining = self._wait_gone(handles, 5)
        signals = []
        for process in remaining:
            if process.send_signal(signal.SIGTERM):
                signals.append({"pid": process.identity["pid"], "signal": "SIGTERM", "method": "pidfd"})
        remaining = self._wait_gone(remaining, 2)
        for process in remaining:
            if process.send_signal(signal.SIGKILL):
                signals.append({"pid": process.identity["pid"], "signal": "SIGKILL", "method": "pidfd"})
        remaining = self._wait_gone(remaining, 2)
        port_closed = _port_closed(owner["url"])
        passed = not remaining and port_closed is not False
        owner["cleaned"] = passed
        self._record({"event": "cleanup", "reason": reason, "project": owner["project"],
                      "ownerPid": identity["pid"], "ownerStartTicks": identity["startTicks"],
                      "descendantPids": [child.identity["pid"] for child in descendants],
                      "descendants": [_process_summary(child.identity) for child in descendants],
                      "compilerWorkers": [_process_summary(child.identity) for child in descendants
                                          if "--worker" in child.identity["command"]],
                      "control": control, "signals": signals,
                      "remainingPids": [process.identity["pid"] for process in remaining],
                      "portClosed": port_closed, "pass": passed})
        if passed:
            self._close_owner_handles(owner)
        if not passed:
            raise RuntimeError(f"scale owner cleanup left pidfd identities {[process.identity['pid'] for process in remaining]} or open port {owner['url']}")

    def stop_all(self, reason: str) -> None:
        with self._lock:
            self._discover(_process_table())
            errors = []
            for owner in self.owners.values():
                if not owner["cleaned"]:
                    try:
                        self._stop_owner(owner, reason)
                    except Exception as error:
                        errors.append(f"{owner['project']}: {type(error).__name__}: {error}")
            if errors:
                raise RuntimeError("; ".join(errors))

    def _monitor(self) -> None:
        try:
            while not self._stop.wait(self.poll_seconds):
                with self._lock:
                    self._discover(_process_table())
                    for owner in self.owners.values():
                        if owner["cleaned"]:
                            continue
                        terminal = self._terminal_for(owner)
                        if terminal is not None:
                            path, outcome, _digest = terminal
                            try:
                                self._stop_owner(owner, f"verification-{outcome}:{path.relative_to(self.lane)}")
                            except Exception as error:
                                self.errors.append(f"{owner['project']}: {type(error).__name__}: {error}")
        except Exception as error:
            self.errors.append(f"{type(error).__name__}: {error}")

    def finish(self, reason: str) -> None:
        self._stop.set()
        self._thread.join(timeout=2)
        errors = list(self.errors)
        try:
            self.stop_all(reason)
        except Exception as error:
            errors.append(f"{type(error).__name__}: {error}")
        finally:
            for owner in self.owners.values():
                self._close_owner_handles(owner)
        if errors:
            raise RuntimeError("; ".join(errors))


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
    env.pop(RUN_LOCK_FD_ENV, None)
    env.pop(RUN_LOCK_ID_ENV, None)
    return env


def run_root_id(root: Path) -> str:
    return hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:20]


def run_root_lock_path(root: Path) -> Path:
    return Path(tempfile.gettempdir()) / f"clique-linux-runner-{run_root_id(root)}.lock"


@contextmanager
def exclusive_run_root(root: Path):
    """Hold one nonblocking custody lock across preparation or an actor run."""
    expected_id = run_root_id(root)
    inherited_fd = os.environ.get(RUN_LOCK_FD_ENV)
    if inherited_fd is not None:
        if os.environ.get(RUN_LOCK_ID_ENV) != expected_id:
            raise SystemExit("inherited Clique run-root lock does not match this packet")
        try:
            fd = int(inherited_fd)
            os.fstat(fd)
        except (ValueError, OSError) as error:
            raise SystemExit("inherited Clique run-root lock is invalid") from error
        os.set_inheritable(fd, False)
        yield fd
        return

    lock_path = run_root_lock_path(root)
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise SystemExit(f"Clique run root is already in use: {root}") from error
        yield fd
    finally:
        os.close(fd)


def inherited_lock_env(root: Path, fd: int) -> dict[str, str]:
    """Return an environment that hands this held lock to an exec'd wrapper."""
    os.set_inheritable(fd, True)
    env = dict(os.environ)
    env[RUN_LOCK_FD_ENV] = str(fd)
    env[RUN_LOCK_ID_ENV] = run_root_id(root)
    return env


def occupied_ports(port_start: int, port_count: int) -> list[int]:
    """Return assigned TCP ports that cannot be bound on IPv4 or IPv6."""
    occupied = []
    for port in range(port_start, port_start + port_count):
        for family, address in ((socket.AF_INET, ("0.0.0.0", port)), (socket.AF_INET6, ("::", port))):
            probe = socket.socket(family, socket.SOCK_STREAM)
            try:
                if family == socket.AF_INET6:
                    probe.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                probe.bind(address)
            except OSError as error:
                if error.errno in (EADDRINUSE, EACCES):
                    occupied.append(port)
                    break
                raise
            finally:
                probe.close()
    return occupied


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
