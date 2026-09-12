#!/usr/bin/env python3
"""Fail-closed system preflight for a prepared Linux Clique packet."""

import argparse
import hashlib
import json
import os
import platform
import re
import subprocess
from pathlib import Path

from run_support import occupied_ports, run_env


def run(*args: str, env=None) -> str:
    return subprocess.run(args, check=True, text=True, capture_output=True, env=env).stdout.strip()


def npm_json(package: str, field: str):
    return json.loads(run("npm", "view", package, field, "--json", env=run_env()))


def preflight(root: Path, phase: str, port_start: int, port_count: int) -> dict:
    version = (root / "SNAPBACK2_VERSION").read_text().strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", version):
        raise SystemExit("published version is still pending or invalid")
    if version == "0.0.23":
        raise SystemExit("0.0.23 is Darwin-only and forbidden for this Linux run")
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise SystemExit(f"expected Linux x86_64, observed {platform.system()} {platform.machine()}")

    umbrella = npm_json(f"snapback2@{version}", "version")
    optional = npm_json(f"snapback2@{version}", "optionalDependencies")
    linux_runtime = npm_json(f"snapback2-linux-x64@{version}", "version")
    if umbrella != version or linux_runtime != version:
        raise SystemExit("published umbrella/Linux runtime version mismatch")
    if optional.get("snapback2-linux-x64") != version:
        raise SystemExit("published umbrella does not pin the matching Linux runtime")

    listeners = run("ss", "-ltnpH")
    occupied = []
    listener_evidence = []
    assigned_ports = range(port_start, port_start + port_count)
    for line in listeners.splitlines():
        columns = line.split()
        if len(columns) < 4:
            continue
        match = re.search(r":(\d+)$", columns[3])
        if match and int(match.group(1)) in assigned_ports:
            occupied.append(int(match.group(1)))
            listener_evidence.append(line)
    # Binding catches listeners whose address shape a particular ss build did
    # not parse; ss remains the retained process-evidence source.
    occupied = sorted(set(occupied + occupied_ports(port_start, port_count)))
    if phase == "builder" and occupied:
        raise SystemExit(f"assigned ports occupied: {occupied}")

    expected_manifest = (root / "preflight" / "instrument-files.sha256").read_text().splitlines()
    actual_manifest = []
    for path in sorted((root / "instrument").glob("**/*")):
        if path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            actual_manifest.append(f"{digest}  ./{path.relative_to(root / 'instrument').as_posix()}")
    if actual_manifest != expected_manifest:
        raise SystemExit("frozen instrument differs from the retained file manifest")

    codex_version = run("codex", "--version", env=run_env())
    codex_auth_result = subprocess.run(
        ("codex", "login", "status"), check=True, text=True, capture_output=True, env=run_env()
    )
    auth_lines = [
        line.strip()
        for stream in (codex_auth_result.stdout, codex_auth_result.stderr)
        for line in stream.splitlines()
    ]
    if "Logged in using ChatGPT" not in auth_lines:
        raise SystemExit("Codex is not authenticated with ChatGPT")

    browser_env = run_env()
    browser_env["PLAYWRIGHT_BROWSERS_PATH"] = str(Path.home() / ".cache" / "ms-playwright")
    browser_env["PW_MODULE"] = (
        root / "preflight" / "playwright-1.62.1" / "node_modules" / "playwright" / "index.mjs"
    ).as_uri()
    browser = json.loads(run(
        "node", "--input-type=module", "-e",
        'const { chromium }=await import(process.env.PW_MODULE); const b=await chromium.launch({headless:true}); const p=await b.newPage(); await p.setContent("<main id=probe>HEADLESS_DOM_OK</main>"); console.log(JSON.stringify({version:b.version(),text:await p.locator("#probe").textContent()})); await b.close();',
        env=browser_env,
    ))
    if browser.get("text") != "HEADLESS_DOM_OK":
        raise SystemExit("headless Chromium DOM probe failed")

    meminfo = Path("/proc/meminfo").read_text()
    available_kib = int(re.search(r"^MemAvailable:\s+(\d+)", meminfo, re.M).group(1))
    disk = os.statvfs(root)
    return {
        "status": "ready",
        "phase": phase,
        "host": platform.node(),
        "platform": f"{platform.system()}-{platform.machine()}",
        "load": list(os.getloadavg()),
        "memoryAvailableGiB": round(available_kib / 1024 / 1024, 2),
        "diskFreeGiB": round(disk.f_bavail * disk.f_frsize / 1024**3, 2),
        "ports": f"{port_start}-{port_start + port_count - 1}-clear" if not occupied else occupied,
        "portListeners": listener_evidence,
        "portPolicy": "must-be-clear" if phase == "builder" else "evidence-only-later-phase-never-kill-by-port-or-name",
        "snapback2": version,
        "linuxRuntime": f"snapback2-linux-x64@{linux_runtime}",
        "codex": codex_version,
        "codexAuth": "ChatGPT",
        "playwright": "1.62.1",
        "chromium": browser["version"],
        "nativeSimulatorProof": "unavailable-linux-host",
        "holdoutProbeClaims": "unavailable-none-committed",
        "capBoundaryAdjudication": "unavailable-old-lightweight-runner-no-authentic-boundary-controller",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True, choices=["builder", "grade", "m7", "score"])
    parser.add_argument("--port-start", type=int, default=53100)
    parser.add_argument("--port-count", type=int, default=20)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    print(json.dumps(preflight(root, args.phase, args.port_start, args.port_count), indent=2))


if __name__ == "__main__":
    main()
