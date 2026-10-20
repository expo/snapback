"""Real-user HTTP visibility proof over read-only-backed Wave 19 copies.

The evidence deployments are never served or written.  Each run copies release
source, backs SQLite up from a mode=ro connection, and uses a private binary
copy so a concurrent build cannot change the executable mid-proof.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager, closing
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


LANES = {
    "008": "008-snapback-fish-hatchery-raceways",
    "020": "020-snapback-septic-pumpout-compliance",
}
DOWN_020 = """
down extensions legacyReason(id: id):
  {reason:(explanations[extension = id] ! else MISSING_REASON).explanation}
"""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def digest_values(values) -> str:
    encoded = json.dumps(sorted(values), separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


def run(binary: Path, cwd: Path, *args: str, sensitive: bool = False):
    result = subprocess.run(
        [str(binary), *args], cwd=cwd, capture_output=True, text=True, timeout=120
    )
    if result.returncode:
        detail = "output suppressed" if sensitive else (result.stdout + result.stderr)[-3000:]
        raise RuntimeError(f"snapback4 {' '.join(args)} failed ({result.returncode}): {detail}")
    return result


def copy_binary(source: Path, target: Path) -> str:
    before = source.stat()
    shutil.copy2(source, target)
    after = source.stat()
    if (before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    ):
        raise RuntimeError("binary changed while it was copied; retry with stable bytes")
    target.chmod(0o700)
    return sha256(target)


def read_current(source: Path) -> int:
    return int((source / "deploy/current").read_text().strip())


def copy_deployment(source: Path, root: Path) -> Path:
    deployment = root / "deployment"
    deployment.mkdir()
    shutil.copytree(
        source / "deploy/releases",
        deployment / "releases",
        ignore=shutil.ignore_patterns(".snapback4", "node_modules"),
    )
    original_uri = (source / "deploy/store.sqlite").resolve().as_uri() + "?mode=ro"
    with sqlite3.connect(original_uri, uri=True) as original, closing(
        sqlite3.connect(deployment / "store.sqlite")
    ) as copied:
        original.backup(copied)
    current = read_current(source)
    (deployment / "current").write_text(f"{current}\n")
    shutil.copytree(
        deployment / "releases" / str(current) / "snapback", root / "snapback"
    )
    (root / "package.json").write_text('{"private":true,"type":"module"}\n')
    return deployment


def table_roles(database: Path, table: str) -> dict[str, set[str]]:
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as db:
        number = db.execute("SELECT num FROM _catalog WHERE name=?", (table,)).fetchone()[0]
        roles: dict[str, set[str]] = {}
        for (data,) in db.execute("SELECT data FROM r WHERE t=?", (number,)):
            row = json.loads(data)["Row"]
            role = row["role"]["String"]
            roles.setdefault(role, set()).add(row["principal"]["Id"])
        return roles


def expand_template(template: str, role: str, index: int) -> str:
    value = template.replace("${role}", role).replace("${i}", str(index))
    if "${" in value:
        raise RuntimeError("credential template contains an unsupported expression")
    return value


def credentials(source: Path, lane: str, role: str, index: int) -> tuple[str, str]:
    if lane == "008":
        text = (source / "scripts/prod-lib.mjs").read_text()
        email_match = re.search(r"prodEmail\s*=\s*\(role,\s*i\)\s*=>\s*`([^`]*)`", text)
        password_match = re.search(r"PROD_PASSWORD\s*=\s*(\"(?:[^\"\\]|\\.)*\")", text)
        if not email_match or not password_match:
            raise RuntimeError("could not read 008 proof credentials")
        return expand_template(email_match.group(1), role, index), json.loads(password_match.group(1))
    text = (source / "scripts/users.mjs").read_text()
    email_match = re.search(r"email:\s*`([^`]*)`", text)
    password_match = re.search(r"password:\s*`([^`]*)`", text)
    if not email_match or not password_match:
        raise RuntimeError("could not read 020 proof credentials")
    return (
        expand_template(email_match.group(1), role, index),
        expand_template(password_match.group(1), role, index),
    )


class ServedCopy:
    def __init__(self, binary: Path, root: Path, deployment: Path):
        self.binary = binary
        self.root = root
        self.deployment = deployment
        self.process = None
        self.stdout = None
        self.stderr = None
        self.url = None

    def __enter__(self):
        try:
            self.stdout = (self.root / "serve.stdout").open("w+")
            self.stderr = (self.root / "serve.stderr").open("w+")
            self.process = subprocess.Popen(
                [str(self.binary), "serve", str(self.deployment), "--port", "0"],
                cwd=self.root,
                stdout=self.stdout,
                stderr=self.stderr,
                text=True,
            )
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                self.stdout.flush()
                self.stdout.seek(0)
                first = self.stdout.readline().strip()
                self.stderr.flush()
                self.stderr.seek(0)
                log = self.stderr.read()
                if first and "SNAPBACK4_READY" in log:
                    self.url = first
                    break
                if self.process.poll() is not None:
                    raise RuntimeError(f"serve exited before ready: {log[-2000:]}")
                time.sleep(0.05)
            if not self.url:
                raise RuntimeError("serve did not become ready within 30 seconds")
            if not self.url.startswith("http://127.0.0.1:"):
                raise RuntimeError("serve did not bind the owned copy to loopback")
            token = run(
                self.binary,
                self.root,
                "token",
                "--service",
                "operator",
                "--days",
                "1",
                "--release",
                str(self.deployment),
                "--quiet",
                sensitive=True,
            ).stdout.strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
                raise RuntimeError("copied-store operator token was malformed")
            return self
        except Exception:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, _kind, _value, _traceback):
        if self.process is not None and self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        if self.stdout:
            self.stdout.close()
        if self.stderr:
            self.stderr.close()

    def post(self, path: str, body: dict, token: str | None = None) -> tuple[int, dict]:
        headers = {"content-type": "application/json"}
        if token:
            headers["authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            self.url + path,
            data=json.dumps(body, separators=(",", ":")).encode(),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read())
            except Exception:
                body = {"denied": {"code": "HTTP_ERROR"}}
            return error.code, body

    def login(self, source: Path, lane: str, role: str, index: int, allowed: set[str]):
        email, password = credentials(source, lane, role, index)
        status, result = self.post("/auth/login", {"email": email, "password": password})
        session = result.get("session")
        if status != 200 or not session or session.get("principal") not in allowed:
            code = result.get("denied", {}).get("code", "invalid-session")
            raise RuntimeError(f"copied-store login for {lane} {role} was refused: {status} {code}")
        return session["token"], session["principal"]

    def query(self, token: str, operation: str, args: dict):
        status, result = self.post(f"/q/{operation}", {"args": args}, token)
        if status != 200 or "data" not in result:
            code = result.get("denied", {}).get("code", "missing-data")
            raise RuntimeError(f"HTTP query {operation} failed: {status} {code}")
        if result.get("complete") is not True or result.get("next") is not None:
            raise RuntimeError(f"HTTP query {operation} did not fit its declared complete page")
        return result["data"]


def viewer_summary(principal: str, role: str, rows: list[dict], scopes: int):
    return {
        "role": role,
        "principalSha256": hashlib.sha256(principal.encode()).hexdigest(),
        "scopes": scopes,
        "rows": len(rows),
        "rowIdsSha256": digest_values(row["id"] for row in rows),
        "zeroObservations": sum(row.get("count") == 0 for row in rows),
    }


def read_008(binary: Path, root: Path, deployment: Path, source: Path):
    roles = table_roles(deployment / "store.sqlite", "staff")
    viewers = []
    with ServedCopy(binary, root, deployment) as served:
        for role, index, list_operation in [
            ("manager", 0, "board"),
            ("culturist", 0, "myRaceways"),
        ]:
            token, principal = served.login(source, "008", role, index, roles[role])
            me = served.query(token, "myRole", {})
            if not me or me.get("role") != role:
                raise RuntimeError(f"008 HTTP myRole did not confirm {role}")
            raceways = served.query(token, list_operation, {"c": None})
            mortality = []
            for raceway in raceways:
                mortality.extend(
                    served.query(
                        token,
                        "mortalityLogsFor",
                        {"raceway": raceway["id"], "c": None},
                    )
                )
            viewers.append(
                viewer_summary(principal, role, mortality, len(raceways))
            )
    return {"operatorAuthority": "minted for copied store", "viewers": viewers}


def read_020(binary: Path, root: Path, deployment: Path, source: Path, v1: bool):
    roles = table_roles(deployment / "store.sqlite", "roles")
    viewers = []
    all_officer_extensions = []
    with ServedCopy(binary, root, deployment) as served:
        for role, index, list_operation in [
            ("officer", 1, "allProperties"),
            ("owner", 1, "myProperties"),
        ]:
            token, principal = served.login(source, "020", role, index, roles[role])
            me = served.query(token, "myRole", {})
            if not me or me.get("role") != role:
                raise RuntimeError(f"020 HTTP myRole did not confirm {role}")
            properties = served.query(token, list_operation, {"c": None})
            extensions = []
            for prop in properties:
                extensions.extend(
                    served.query(
                        token,
                        "extensionsOf",
                        {"property": prop["id"], "c": None},
                    )
                )
            summary = {
                "role": role,
                "principalSha256": hashlib.sha256(principal.encode()).hexdigest(),
                "properties": len(properties),
                "extensions": len(extensions),
                "extensionIdsSha256": digest_values(row["id"] for row in extensions),
            }
            if v1:
                if any("reason" not in row for row in extensions):
                    raise RuntimeError("020 v1 HTTP row omitted reason")
                summary["reasonNulls"] = sum(row["reason"] is None for row in extensions)
                summary["reasonTexts"] = sum(isinstance(row["reason"], str) for row in extensions)
                summary["reasonValuesSha256"] = digest_values(
                    [row["id"], row["reason"]] for row in extensions
                )
            viewers.append(summary)
            if role == "officer":
                all_officer_extensions = extensions
    return {
        "operatorAuthority": "minted for copied store",
        "viewers": viewers,
        "officerRows": all_officer_extensions,
    }


def rollback(binary: Path, root: Path, deployment: Path, target: str, check=False):
    args = ["rollback", str(deployment), "--to", target]
    if check:
        args.extend(["--check", "--json"])
    result = run(binary, root, *args)
    return json.loads(result.stdout) if check else None


def prove_008(binary: Path, source: Path, root: Path):
    deployment = copy_deployment(source, root)
    initial = read_008(binary, root, deployment, source)
    manager = initial["viewers"][0]
    if (manager["rows"], manager["zeroObservations"]) != (84, 9):
        raise RuntimeError(f"008 copied v2 manager saw unexpected counts: {manager}")
    cycles = []
    for cycle in (1, 2):
        preview = rollback(binary, root, deployment, "1", check=True)
        rollback(binary, root, deployment, "1")
        old = read_008(binary, root, deployment, source)
        old_manager = old["viewers"][0]
        if (old_manager["rows"], old_manager["zeroObservations"]) != (75, 0):
            raise RuntimeError(f"008 v1 manager did not lose exactly the nine zero observations: {old_manager}")
        rollback(binary, root, deployment, "latest")
        forward = read_008(binary, root, deployment, source)
        forward_manager = forward["viewers"][0]
        if (forward_manager["rows"], forward_manager["zeroObservations"]) != (84, 9):
            raise RuntimeError(f"008 forward did not restore user-visible observations: {forward_manager}")
        if forward_manager["rowIdsSha256"] != manager["rowIdsSha256"]:
            raise RuntimeError("008 forward changed the manager-visible row identity set")
        cycles.append(
            {
                "cycle": cycle,
                "previewHiddenRows": preview["visibility"]["hiddenRows"],
                "v1": old,
                "forward": forward,
            }
        )
    return {"initialV2": initial, "cycles": cycles}


def officer(view: dict) -> dict:
    return next(item for item in view["viewers"] if item["role"] == "officer")


def prove_020(binary: Path, source: Path, root: Path):
    deployment = copy_deployment(source, root)
    baseline_preview = rollback(binary, root, deployment, "1", check=True)
    rollback(binary, root, deployment, "1")
    baseline = read_020(binary, root, deployment, source, v1=True)
    baseline_officer = officer(baseline)
    if (baseline_officer["extensions"], baseline_officer["reasonNulls"]) != (31, 12):
        raise RuntimeError(f"020 original v1 HTTP baseline was not 12/31 null reasons: {baseline_officer}")
    baseline_null_ids = sorted(row["id"] for row in baseline.pop("officerRows") if row["reason"] is None)
    rollback(binary, root, deployment, "latest")

    schema = root / "snapback/schema.q"
    schema.write_text(schema.read_text() + DOWN_020)
    run(binary, root, "deploy", str(deployment))

    cycles = []
    for cycle in (1, 2):
        preview = rollback(binary, root, deployment, "1", check=True)
        rollback(binary, root, deployment, "1")
        projected = read_020(binary, root, deployment, source, v1=True)
        projected_rows = projected.pop("officerRows")
        projected_officer = officer(projected)
        if (projected_officer["extensions"], projected_officer["reasonNulls"], projected_officer["reasonTexts"]) != (31, 0, 31):
            raise RuntimeError(f"020 declared down did not restore every v1 reason: {projected_officer}")
        restored = [row for row in projected_rows if row["id"] in baseline_null_ids]
        if len(restored) != 12 or any(not isinstance(row["reason"], str) or not row["reason"] for row in restored):
            raise RuntimeError("020 declared down did not turn all twelve baseline nulls into reason text")
        rollback(binary, root, deployment, "latest")
        current = read_020(binary, root, deployment, source, v1=False)
        current_rows = current.pop("officerRows")
        cycles.append(
            {
                "cycle": cycle,
                "previewEmptyCells": preview["visibility"]["emptyCells"],
                "v1": projected,
                "restoredBaselineNullRows": len(restored),
                "restoredReasonValuesSha256": digest_values(
                    [row["id"], row["reason"]] for row in restored
                ),
                "forwardV2": {
                    "officerExtensions": len(current_rows),
                    "extensionIdsSha256": digest_values(row["id"] for row in current_rows),
                    "viewers": current["viewers"],
                },
            }
        )
    return {
        "baselinePreviewEmptyCells": baseline_preview["visibility"]["emptyCells"],
        "originalV1": baseline,
        "originalNullExtensionIdsSha256": digest_values(baseline_null_ids),
        "declaredDownCycles": cycles,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument(
        "--evidence", type=Path, default=Path.home() / "sb4-loop/wave19/apps"
    )
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "status": "running",
        "scope": "real password users over loopback HTTP on SQLite/release copies",
        "originalEvidenceReadOnly": True,
        "serviceMintLimitation": "engine-owned user:* principals cannot be minted by /auth/session; existing copied password accounts authenticate through /auth/login",
        "lanes": {},
    }
    original_hashes = {}
    for number, name in LANES.items():
        original_hashes[number] = sha256(args.evidence / name / "deploy/store.sqlite")
    try:
        with tempfile.TemporaryDirectory(prefix="sb4-dorm-user-visibility-") as temporary:
            scratch = Path(temporary)
            os.chmod(scratch, 0o700)
            stable_binary = scratch / "snapback4"
            report["binarySha256"] = copy_binary(args.binary.resolve(), stable_binary)
            for number, name in LANES.items():
                lane_source = args.evidence / name
                lane_root = scratch / number
                lane_root.mkdir(mode=0o700)
                report["lanes"][name] = (
                    prove_008(stable_binary, lane_source, lane_root)
                    if number == "008"
                    else prove_020(stable_binary, lane_source, lane_root)
                )
                report["lanes"][name]["sourceStoreSha256"] = original_hashes[number]
                report["lanes"][name]["sourceStoreUnchanged"] = (
                    sha256(lane_source / "deploy/store.sqlite") == original_hashes[number]
                )
                if not report["lanes"][name]["sourceStoreUnchanged"]:
                    raise RuntimeError(f"original evidence store changed during {number} proof")
                print(json.dumps({"lane": name, "status": "passed"}), flush=True)
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
