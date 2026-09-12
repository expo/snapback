#!/usr/bin/env python3
"""Claim, prepare, preflight, and optionally launch one fresh builder packet."""

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

from preflight import preflight
from render import VERSION_PATTERN, render_prompt
from run_support import exclusive_run_root, inherited_lock_env, occupied_ports


def refuse_claimed_packet(root: Path) -> None:
    version_path = root / "SNAPBACK2_VERSION"
    if version_path.exists() and version_path.read_text().strip() not in ("", "PENDING_ROOT_CONFIRMATION"):
        raise SystemExit(f"packet already has a published version: {root}")
    claims = [
        root / ".clique-prepared.json",
        root / "prompts" / "astra-snapback2.md",
        root / "lanes" / "astra-snapback2",
    ]
    claims.extend((root / "preflight").glob("pre-builder*.json"))
    claims.extend((root / "logs").glob("*.pid"))
    claims.extend((root / "logs").glob("*.start.json"))
    existing = [path for path in claims if path.exists()]
    if existing:
        listed = ", ".join(str(path.relative_to(root)) for path in existing)
        raise SystemExit(f"packet already carries run custody evidence: {listed}")


def write_version(root: Path, version: str) -> None:
    destination = root / "SNAPBACK2_VERSION"
    temporary = root / f".SNAPBACK2_VERSION.{os.getpid()}.tmp"
    with temporary.open("x") as handle:
        handle.write(version + "\n")
    os.replace(temporary, destination)


def write_json_exclusive(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")


def prepare_packet(root: Path, version: str, port_start: int, port_count: int) -> tuple[Path, Path]:
    if not VERSION_PATTERN.fullmatch(version):
        raise SystemExit("published version is invalid")
    if port_start < 1024 or port_count < 1 or port_start + port_count > 65536:
        raise SystemExit("invalid unprivileged TCP port range")

    # Port and packet custody checks are deliberately ahead of every run-owned write.
    occupied = occupied_ports(port_start, port_count)
    if occupied:
        raise SystemExit(f"assigned ports occupied: {occupied}")
    refuse_claimed_packet(root)
    required = [
        root / "prompts" / "template.md",
        root / "instrument",
        root / "preflight" / "instrument-files.sha256",
        root / "preflight" / "playwright-1.62.1" / "node_modules" / "playwright" / "index.mjs",
    ]
    missing = [path.relative_to(root) for path in required if not path.exists()]
    if missing:
        raise SystemExit("packet prerequisites missing: " + ", ".join(map(str, missing)))

    write_version(root, version)
    prompt_path = render_prompt(root, version, port_start, port_count)
    result = preflight(root, "builder", port_start, port_count)
    receipt_path = root / "preflight" / f"pre-builder-{os.getpid()}.json"
    write_json_exclusive(receipt_path, result)
    marker = {
        "version": "clique-linux-packet.v1",
        "preparedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "snapback2": version,
        "ports": [port_start, port_start + port_count - 1],
        "prompt": prompt_path.relative_to(root).as_posix(),
        "promptSha256": hashlib.sha256(prompt_path.read_bytes()).hexdigest(),
        "preflightReceipt": receipt_path.relative_to(root).as_posix(),
    }
    write_json_exclusive(root / ".clique-prepared.json", marker)
    return prompt_path, receipt_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--port-start", type=int, default=53100)
    parser.add_argument("--port-count", type=int, default=20)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("wave", nargs="?", default="astra", choices=["astra"])
    parser.add_argument("backend", nargs="?", default="snapback2", choices=["snapback2"])
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    with exclusive_run_root(root) as lock_fd:
        prompt, receipt = prepare_packet(root, args.version, args.port_start, args.port_count)
        print(f"prepared {root}: {prompt.name}; receipt {receipt.name}", flush=True)
        if args.prepare_only:
            return
        launch = root / "scripts" / "launch.py"
        env = inherited_lock_env(root, lock_fd)
        os.execve(sys.executable, [sys.executable, str(launch), args.wave, args.backend], env)


if __name__ == "__main__":
    main()
