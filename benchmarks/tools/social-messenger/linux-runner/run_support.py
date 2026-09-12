#!/usr/bin/env python3
"""Small run-local helpers for foreground custody and raw Codex retention."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import signal
import shutil
import socket
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


def _same_process(identity: dict) -> bool:
    current = _process_identity(identity["pid"])
    return current is not None and current["state"] != "Z" and current["startTicks"] == identity["startTicks"]


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
# its run-owned backend without changing the separately recorded clock.
class ScaleOwnerCustody:
    """Track actor-created scale owners and stop only their proven process identities."""

    def __init__(self, *, root: Path, lane: Path, actor_pid: int, name: str, poll_seconds: float = 0.2):
        self.root = root.resolve()
        self.lane = lane.resolve()
        self.actor_pid = actor_pid
        self.launcher_pid = os.getpid()
        self.actor_identity = _process_identity(actor_pid)
        if self.actor_identity is None:
            raise RuntimeError(f"actor pid {actor_pid} exited before custody started")
        self.name = name
        self.poll_seconds = poll_seconds
        self.started_ns = time.time_ns()
        self.receipt_path = self.root / "logs" / f"{name}.scale-owners.jsonl"
        self.owners: dict[tuple[int, int], dict] = {}
        self.seen_terminals: set[tuple[str, int]] = set()
        self.errors: list[str] = []
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._monitor, name=f"{name}-scale-custody", daemon=True)

    def start(self) -> None:
        self.receipt_path.parent.mkdir(parents=True, exist_ok=True)
        self._record({"event": "monitor-started", "actorPid": self.actor_pid,
                      "actorStartTicks": self.actor_identity["startTicks"],
                      "launcherPid": self.launcher_pid})
        self._thread.start()

    def _record(self, value: dict) -> None:
        value = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **value}
        with self.receipt_path.open("a") as handle:
            handle.write(json.dumps(value, sort_keys=True) + "\n")

    def _owned_by_actor(self, identity: dict, table: dict[int, dict]) -> bool:
        if identity["startTicks"] < self.actor_identity["startTicks"]:
            return False
        return _descends_from(identity["pid"], self.actor_pid, table) or identity["parentPid"] == self.launcher_pid

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
            if raw.get("pid") != identity["pid"] or Path(raw.get("project", "")).resolve() != project:
                continue
            key = (identity["pid"], identity["startTicks"])
            if key in self.owners:
                continue
            descendants = [child for child in table.values() if child["pid"] != identity["pid"]
                           and _descends_from(child["pid"], identity["pid"], table)]
            owner = {"identity": identity, "project": str(project), "url": raw.get("url"),
                     "secret": raw.get("secret"), "descendants": descendants, "cleaned": False}
            self.owners[key] = owner
            self._record({"event": "claimed", "ownerPid": identity["pid"], "ownerStartTicks": identity["startTicks"],
                          "project": str(project), "url": raw.get("url"),
                          "descendants": [_process_summary(child) for child in descendants],
                          "compilerWorkers": [_process_summary(child) for child in descendants if "--worker" in child["command"]],
                          "ownership": "actor ancestry or Linux child-subreaper adoption plus matching owner.json"})

    def _terminal_paths(self) -> list[Path]:
        paths = [self.lane / "scale-replay.json", self.lane / "scale-replay-failure.json"]
        evidence = self.lane / "evidence"
        if evidence.is_dir():
            paths.extend(evidence.glob("scale*/result.json"))
            paths.extend(evidence.glob("*/scale*/result.json"))
        return paths

    def _terminal(self) -> tuple[Path, str] | None:
        for path in self._terminal_paths():
            try:
                modified = path.stat().st_mtime_ns
                key = (str(path), modified)
                if modified < self.started_ns or key in self.seen_terminals:
                    continue
                value = json.loads(path.read_text())
            except (FileNotFoundError, json.JSONDecodeError, PermissionError):
                continue
            outcome = None
            if isinstance(value.get("pass"), bool):
                outcome = "success" if value["pass"] else "failure"
            elif value.get("state") in ("succeeded", "failed", "aborted"):
                outcome = value["state"]
            elif value.get("version") == "snapback.full-journey-scale-replay.v1" \
                    and isinstance(value.get("attempts"), list) and value["attempts"]:
                disposition = value["attempts"][-1].get("disposition")
                if disposition in ("completed", "aborted"):
                    outcome = "success" if disposition == "completed" else "failure:aborted"
            elif path.name == "scale-replay-failure.json" and value.get("outcome"):
                outcome = f"failure:{value['outcome']}"
            if outcome is not None:
                self.seen_terminals.add(key)
                return path, outcome
        return None

    @staticmethod
    def _signal(identity: dict, signum: int, signals: list[dict]) -> None:
        if not _same_process(identity):
            return
        try:
            os.kill(identity["pid"], signum)
            signals.append({"pid": identity["pid"], "signal": signal.Signals(signum).name})
        except ProcessLookupError:
            pass

    @staticmethod
    def _wait_gone(identities: list[dict], timeout: float) -> list[dict]:
        deadline = time.monotonic() + timeout
        remaining = [identity for identity in identities if _same_process(identity)]
        while remaining and time.monotonic() < deadline:
            time.sleep(0.05)
            remaining = [identity for identity in remaining if _same_process(identity)]
        return remaining

    def _stop_owner(self, owner: dict, reason: str) -> None:
        table = _process_table()
        identity = owner["identity"]
        descendants = { (child["pid"], child["startTicks"]): child for child in owner["descendants"] }
        for child in table.values():
            if child["pid"] != identity["pid"] and _descends_from(child["pid"], identity["pid"], table):
                descendants[(child["pid"], child["startTicks"])] = child
        identities = [identity, *descendants.values()]
        control = "not-attempted"
        if _same_process(identity) and isinstance(owner["url"], str) and isinstance(owner["secret"], str):
            request = urllib.request.Request(owner["url"] + "/control/stop", method="POST", data=b'{"cause":"clique scale verification complete"}',
                                             headers={"content-type": "application/json", "x-snapback-control": owner["secret"]})
            try:
                with urllib.request.urlopen(request, timeout=5) as response:
                    control = f"http-{response.status}"
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                control = f"error:{type(error).__name__}"
        remaining = self._wait_gone(identities, 5)
        signals = []
        for process in remaining:
            self._signal(process, signal.SIGTERM, signals)
        remaining = self._wait_gone(remaining, 2)
        for process in remaining:
            self._signal(process, signal.SIGKILL, signals)
        remaining = self._wait_gone(remaining, 2)
        port_closed = _port_closed(owner["url"])
        passed = not remaining and port_closed is not False
        owner["cleaned"] = passed
        self._record({"event": "cleanup", "reason": reason, "project": owner["project"],
                      "ownerPid": identity["pid"], "ownerStartTicks": identity["startTicks"],
                      "descendantPids": [child["pid"] for child in descendants.values()],
                      "descendants": [_process_summary(child) for child in descendants.values()],
                      "compilerWorkers": [_process_summary(child) for child in descendants.values() if "--worker" in child["command"]],
                      "control": control, "signals": signals,
                      "remainingPids": [process["pid"] for process in remaining],
                      "portClosed": port_closed, "pass": passed})
        if not passed:
            raise RuntimeError(f"scale owner cleanup left exact PIDs {[process['pid'] for process in remaining]} or open port {owner['url']}")

    def stop_all(self, reason: str) -> None:
        with self._lock:
            self._discover(_process_table())
            for owner in self.owners.values():
                if not owner["cleaned"]:
                    self._stop_owner(owner, reason)

    def _monitor(self) -> None:
        try:
            while not self._stop.wait(self.poll_seconds):
                with self._lock:
                    self._discover(_process_table())
                    terminal = self._terminal()
                    if terminal is not None:
                        self.stop_all(f"verification-{terminal[1]}:{terminal[0].relative_to(self.lane)}")
        except Exception as error:
            self.errors.append(f"{type(error).__name__}: {error}")

    def finish(self, reason: str) -> None:
        self._stop.set()
        self._thread.join(timeout=2)
        self.stop_all(reason)
        if self.errors:
            raise RuntimeError("; ".join(self.errors))


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
