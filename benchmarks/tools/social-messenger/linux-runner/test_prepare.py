#!/usr/bin/env python3
"""Targeted custody regressions for the maintained Linux Clique runner."""

import importlib
import hashlib
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path
from unittest import mock


SOURCE = Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE))
prepare = importlib.import_module("prepare")
run_support = importlib.import_module("run_support")


TEMPLATE = "\n".join([
    "{LANE_DIR}", "{RUN_ROOT}", "{PLATFORM_PARAGRAPH}", "{PORTS}",
    "{OTHER_PORTS}", "{LANE_ID}", "{MODEL}", "{EFFORT}", "{BACKEND}",
    "{DEFECT_LABEL}", "{OTHER_BACKENDS}", "M{n}", "",
])


def packet(root: Path) -> None:
    scripts = root / "scripts"
    scripts.mkdir(parents=True)
    for name in (
        "prepare.py", "preflight.py", "render.py", "run_support.py",
        "scale_terminal_validator.mjs", "launch.py", "launch_m7.py",
    ):
        (scripts / name).write_bytes((SOURCE / name).read_bytes())
    (root / "prompts").mkdir()
    (root / "prompts" / "template.md").write_text(TEMPLATE)
    (root / "instrument").mkdir()
    playwright = root / "preflight" / "playwright-1.62.1" / "node_modules" / "playwright"
    playwright.mkdir(parents=True)
    (playwright / "index.mjs").write_text("// fixture\n")
    (root / "preflight" / "instrument-files.sha256").write_text("")


class PrepareCustodyTest(unittest.TestCase):
    def test_occupied_port_leaves_existing_run_bytes_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            packet(root)
            version = root / "SNAPBACK2_VERSION"
            prompt = root / "prompts" / "astra-snapback2.md"
            receipt = root / "preflight" / "pre-builder.json"
            version.write_bytes(b"0.0.24\n")
            prompt.write_bytes(b"original prompt\n")
            receipt.write_bytes(b"")
            before = [path.read_bytes() for path in (version, prompt, receipt)]
            listener = socket.socket()
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            try:
                result = subprocess.run(
                    [sys.executable, str(root / "scripts" / "prepare.py"),
                     "--version", "0.0.25", "--port-start", str(port),
                     "--port-count", "1", "--prepare-only"],
                    text=True, capture_output=True,
                )
            finally:
                listener.close()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("assigned ports occupied", result.stderr)
            self.assertEqual(before, [path.read_bytes() for path in (version, prompt, receipt)])

    def test_competing_claim_cannot_write_packet(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            packet(root)
            with run_support.exclusive_run_root(root):
                result = subprocess.run(
                    [sys.executable, str(root / "scripts" / "prepare.py"),
                     "--version", "0.0.25", "--port-start", "54000",
                     "--port-count", "1", "--prepare-only"],
                    text=True, capture_output=True,
                )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("already in use", result.stderr)
            self.assertFalse((root / "SNAPBACK2_VERSION").exists())
            self.assertFalse((root / "prompts" / "astra-snapback2.md").exists())

    def test_fresh_packet_uses_unique_receipt_and_becomes_claimed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            packet(root)
            with mock.patch.object(prepare, "occupied_ports", return_value=[]), \
                 mock.patch.object(prepare, "preflight", return_value={"status": "ready"}):
                prompt, receipt = prepare.prepare_packet(root, "0.0.25", 54100, 20)
                self.assertEqual(receipt.name, f"pre-builder-{os.getpid()}.json")
                self.assertTrue(prompt.is_file())
                rendered = prompt.read_text()
                self.assertIn("Required scale-owner lifecycle handshake", rendered)
                self.assertIn("run_support.py scale-attempt", rendered)
                self.assertIn("--milestone M8 --attempt 1", rendered)
                self.assertIn("run_support.py bind-result", rendered)
                self.assertFalse((root / "preflight" / "pre-builder.json").exists())
                before = (root / "SNAPBACK2_VERSION").read_bytes(), prompt.read_bytes(), receipt.read_bytes()
                with self.assertRaises(SystemExit):
                    prepare.prepare_packet(root, "0.0.26", 54100, 20)
                self.assertEqual(before, ((root / "SNAPBACK2_VERSION").read_bytes(), prompt.read_bytes(), receipt.read_bytes()))


class CanonicalValidatorTest(unittest.TestCase):
    def test_prepared_packet_authority_precedes_repository_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "instrument").symlink_to(SOURCE.parents[2], target_is_directory=True)
            doctor = run_support._canonical_validator(
                run_support._canonical_validator_node(), root, doctor=True,
            )
            self.assertEqual(doctor["authoritySource"], "packet-instrument")

    def test_incomplete_prepared_instrument_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "instrument").mkdir()
            with self.assertRaisesRegex(
                run_support.CanonicalValidatorUnavailable,
                "prepared packet instrument lacks canonical metering authority",
            ):
                run_support._canonical_validator(
                    run_support._canonical_validator_node(), root, doctor=True,
                )


@unittest.skipUnless(Path("/proc/self/stat").is_file(), "Linux /proc custody test")
class ScaleOwnerCustodyTest(unittest.TestCase):
    def setUp(self):
        run_support.enable_child_subreaper()
        self.actors = []
        self.owners = []

    def tearDown(self):
        for process in reversed(self.owners + self.actors):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)

    def test_scale_classification_is_relative_to_lane(self):
        lane = Path("/tmp/clique-scale-0026/lanes/astra-snapback2")
        self.assertFalse(run_support._is_scale_project(lane, lane))
        self.assertTrue(run_support._is_scale_project(lane / "replays" / "scale-m6", lane))
        self.assertFalse(run_support._is_scale_project(Path("/tmp/other/replays/scale"), lane))

    def wait_for(self, predicate, message, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.05)
        self.fail(message)

    @staticmethod
    def alive(pid):
        try:
            stat = Path(f"/proc/{pid}/stat").read_text()
            return stat.rsplit(") ", 1)[1].split()[0] != "Z"
        except FileNotFoundError:
            return False

    def fixture(self, directory, poll_seconds=0.02, actor_behavior="wait"):
        root = Path(directory)
        lane = root / "lanes" / "astra-snapback2"
        lane.mkdir(parents=True)
        (root / "logs").mkdir()
        owner_script = root / "fake-owner.py"
        owner_script.write_text(textwrap.dedent("""
            import http.server, json, os, signal, subprocess, sys, time
            from pathlib import Path
            project = Path(sys.argv[sys.argv.index('--project') + 1]).resolve()
            worker = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)', '--worker'])
            (project / '.snapback' / 'compiler.pid').write_text(str(worker.pid))
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_POST(self):
                    if self.headers.get('x-snapback-control') != 'test-secret':
                        self.send_response(403); self.end_headers(); return
                    self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
                def log_message(self, *_args): pass
            server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
            owner = {'pid': os.getpid(), 'project': str(project),
                     'url': 'http://127.0.0.1:' + str(server.server_port),
                     'secret': 'test-secret', 'generation': 'test-generation',
                     'startedAt': int(time.time() * 1000), 'mode': 'dev'}
            (project / '.snapback' / 'owner.json').write_text(json.dumps(owner))
            def cleanup(*_args):
                worker.terminate()
                try: worker.wait(timeout=2)
                except subprocess.TimeoutExpired: worker.kill(); worker.wait()
                (project / '.snapback' / 'owner.json').unlink(missing_ok=True)
                raise SystemExit(0)
            signal.signal(signal.SIGTERM, cleanup); signal.signal(signal.SIGINT, cleanup)
            server.handle_request(); cleanup()
        """))
        snapback2 = root / "snapback2"
        snapback2.symlink_to(sys.executable)
        actor_script = root / "actor.py"
        actor_script.write_text("import sys, time\nraise SystemExit(7) if sys.argv[1] == 'exit' else time.sleep(60)\n")
        custody = run_support.ScaleOwnerCustody(
            root=root, lane=lane, name="astra-snapback2", poll_seconds=poll_seconds,
        )
        actor = subprocess.Popen(
            [sys.executable, str(actor_script), actor_behavior],
            env=custody.actor_env(os.environ),
        )
        self.actors.append(actor)
        custody.start(actor.pid)
        return root, lane, owner_script, snapback2, custody, actor

    def start_owner(self, owner_script, snapback2, custody, lane, milestone, attempt, result_name):
        project = lane / "replays" / f"scale-{milestone.lower()}-attempt-{attempt}"
        (project / ".snapback").mkdir(parents=True)
        result = lane / "evidence" / result_name / "result.json"
        result.parent.mkdir(parents=True, exist_ok=True)
        env, sidecar, envelope = run_support.create_scale_attempt(
            lane=lane, project=project, milestone=milestone, attempt=attempt,
            result=result, base_env=custody.actor_env(os.environ),
        )
        process = subprocess.Popen([
            sys.executable, str(owner_script), str(snapback2), "dev",
            "--project", str(project), "--foreground",
        ], env=env)
        self.owners.append(process)
        owner_path = project / ".snapback" / "owner.json"
        compiler_path = project / ".snapback" / "compiler.pid"
        self.wait_for(lambda: owner_path.exists() and compiler_path.exists(), "fake scale owner did not start")
        owner = json.loads(owner_path.read_text())
        return {
            "process": process, "project": project, "result": result,
            "pid": owner["pid"], "startedAt": owner["startedAt"],
            "compilerPid": int(compiler_path.read_text()), "url": owner["url"],
            "sidecar": sidecar, "envelope": envelope,
        }

    @staticmethod
    def associated_value(owner, value):
        return {**value, "ownerAssociation": owner["envelope"]}

    def write_bound_result(self, lane, owner, value):
        source = owner["result"].with_name(owner["result"].name + ".unbound")
        source.write_text(json.dumps(value) + "\n")
        run_support.bind_scale_result(lane=lane, result=owner["result"], source=source)
        source.unlink()

    @staticmethod
    def raw_result(owner, passed=True, start=None):
        start = max(time.time(), owner["startedAt"] / 1000) if start is None else start
        return {
            "pass": passed, "start": start, "end": start + 1, "actions": 17,
            "sourceSha256": "b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9",
            "excludedProbeMs": 0,
        }

    @staticmethod
    def canonical_result(lane, owner, custody, attempt=1, disposition="completed"):
        authority = custody.canonical_fixture_authority
        action_count = authority["actionCount"]
        start_epoch = max(int(time.time()) + 1, int(owner["startedAt"] / 1000) + 1)
        attempts = []
        for number in range(1, attempt + 1):
            started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start_epoch + (number - 1) * 2))
            finished = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start_epoch + (number - 1) * 2 + 1))
            attempts.append({
                "attempt": number, "startedAt": started, "finishedAt": finished,
                "settledPrefix": action_count if number == attempt else 0,
                "continuationOf": None if number == 1 else number - 1,
                "disposition": disposition if number == attempt else "continued",
            })
        receipt = {
            "version": "snapback.full-journey-scale-replay-receipt.v1",
            "pass": disposition == "completed",
            "actionLog": {
                "sha256": authority["actionLogSha256"],
                "actionCount": action_count,
            },
            "settledPrefix": action_count,
            "failedActions": 0 if disposition == "completed" else 1,
            "checkpoints": authority["checkpoints"],
        }
        receipt_path = lane / f"scale-replay-receipt-{attempt}.json"
        receipt_bytes = (json.dumps(receipt) + "\n").encode()
        receipt_path.write_bytes(receipt_bytes)
        wall = float(attempt)
        return {
            "version": "snapback.full-journey-scale-replay.v1", "attempted": True,
            "capSeconds": 100, "probeWallSecondsExcluded": 0, "attempts": attempts,
            "receipt": {"path": receipt_path.relative_to(lane).as_posix(),
                        "sha256": "sha256:" + hashlib.sha256(receipt_bytes).hexdigest()},
            "wallSeconds": wall, "capFractionUsed": wall / 100, "capExhausted": False,
        }

    @staticmethod
    def canonical_failure(owner, outcome="aborted"):
        started_epoch = max(int(time.time()) + 1, int(owner["startedAt"] / 1000) + 1)
        started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_epoch))
        elapsed = 2 if outcome == "settlement-timeout" else 1
        finished = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_epoch + elapsed))
        value = {
            "version": "snapback.full-journey-scale-replay-failure.v1",
            "outcome": outcome, "startedAt": started, "finishedAt": finished,
            "clock": {"attempted": True, "wallSeconds": elapsed, "capSeconds": None,
                      "capFractionUsed": None, "capExhausted": None,
                      "probeWallSecondsExcluded": 0},
            "failure": {"name": "Error", "message": "fixture abort"},
        }
        if outcome == "settlement-timeout":
            value["deadlineAt"] = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_epoch + 1)
            )
            value["clock"].update({
                "capSeconds": 1, "capFractionUsed": 2, "capExhausted": True,
            })
            value["failure"]["cause"] = "missing-post-m8-token-count"
        return value

    @staticmethod
    def canonical_request(custody, lane, value):
        request = {"kind": "failure", "value": value}
        if value.get("version") == "snapback.full-journey-scale-replay.v1":
            receipt_path = lane / value["receipt"]["path"]
            request = {
                "kind": "success",
                "value": value,
                "receipt": json.loads(receipt_path.read_text()),
            }
        return run_support._canonical_validator(
            custody.validator_node, custody.root, request,
        )

    def assert_owner_gone(self, owner):
        self.wait_for(lambda: not self.alive(owner["pid"]), f"owner {owner['pid']} survived")
        self.wait_for(lambda: not self.alive(owner["compilerPid"]), f"compiler {owner['compilerPid']} survived")

    def finish(self, custody, reason="test-finish"):
        custody.finish(reason)
        receipts = [json.loads(line) for line in custody.receipt_path.read_text().splitlines()]
        return receipts

    def test_two_simultaneous_owners_each_stop_only_for_its_associated_terminal(self):
        with tempfile.TemporaryDirectory() as directory:
            root, lane, owner_script, snapback2, custody, _actor = self.fixture(directory)
            m6 = self.start_owner(owner_script, snapback2, custody, lane, "M6", 1, "scale-m6")
            m8 = self.start_owner(owner_script, snapback2, custody, lane, "M8", 1, "scale-m8")
            self.write_bound_result(lane, m6, self.raw_result(m6))
            self.assert_owner_gone(m6)
            self.assertTrue(self.alive(m8["pid"]), "M6 terminal stopped unrelated M8 owner")
            self.write_bound_result(lane, m8, self.canonical_result(lane, m8, custody))
            self.assert_owner_gone(m8)
            receipts = self.finish(custody)
            associated = [entry for entry in receipts if entry["event"] == "terminal-associated"]
            self.assertEqual([(entry["declaration"]["milestone"], entry["ownerPid"]) for entry in associated],
                             [("M6", m6["pid"]), ("M8", m8["pid"])])

    def test_valid_result_copied_from_simultaneous_owner_cannot_cross_association(self):
        with tempfile.TemporaryDirectory() as directory:
            _root, lane, owner_script, snapback2, custody, _actor = self.fixture(directory, poll_seconds=0.2)
            m6 = self.start_owner(owner_script, snapback2, custody, lane, "M6", 1, "scale-copy-m6")
            m8 = self.start_owner(owner_script, snapback2, custody, lane, "M8", 1, "scale-copy-m8")
            self.write_bound_result(lane, m8, self.raw_result(m8))
            m6["result"].write_bytes(m8["result"].read_bytes())
            self.assert_owner_gone(m8)
            time.sleep(0.25)
            self.assertTrue(self.alive(m6["pid"]), "another simultaneous attempt's valid result stopped M6")
            m6["result"].unlink()
            self.write_bound_result(lane, m6, self.raw_result(m6))
            self.assert_owner_gone(m6)
            receipts = self.finish(custody)
            self.assertTrue(any(entry["event"] == "terminal-rejected" and "exact owner/attempt" in entry["reason"]
                                for entry in receipts), receipts)

    def test_failed_attempt_then_retry_rejects_copied_touched_old_result(self):
        with tempfile.TemporaryDirectory() as directory:
            _root, lane, owner_script, snapback2, custody, _actor = self.fixture(directory)
            first = self.start_owner(owner_script, snapback2, custody, lane, "M8", 1, "scale-attempt-1")
            old = self.raw_result(first, passed=False)
            self.write_bound_result(lane, first, old)
            self.assert_owner_gone(first)
            retry = self.start_owner(owner_script, snapback2, custody, lane, "M8", 2, "scale-attempt-2")
            retry["result"].write_bytes(first["result"].read_bytes())
            os.utime(retry["result"], None)
            time.sleep(0.15)
            self.assertTrue(self.alive(retry["pid"]), "copied/touched attempt-one result stopped retry")
            retry["result"].unlink()
            self.write_bound_result(lane, retry, self.canonical_result(lane, retry, custody, attempt=2))
            self.assert_owner_gone(retry)
            receipts = self.finish(custody)
            self.assertTrue(any(entry["event"] == "terminal-rejected" and "exact owner/attempt" in entry["reason"]
                                for entry in receipts), receipts)

    def test_pre_actor_terminal_and_malformed_or_unsupported_terminal_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stale = root / "lanes" / "astra-snapback2" / "evidence" / "scale-stale" / "result.json"
            stale.parent.mkdir(parents=True)
            stale.write_text(json.dumps({
                "pass": True, "start": 1, "end": 2, "actions": 1,
                "sourceSha256": "c" * 64, "excludedProbeMs": 0,
            }) + "\n")
            (root / "logs").mkdir()
            owner_script = root / "fake-owner.py"
            # fixture creates these files, so preserve the baseline while reusing its scripts.
            _, lane, generated_owner, snapback2, custody, _actor = self.fixture_existing(root)
            owner = self.start_owner(generated_owner, snapback2, custody, lane, "M6", 1, "scale-stale")
            unrelated = lane / "scale-replay.json"
            unrelated.write_text(json.dumps(self.associated_value(
                owner, self.canonical_result(lane, owner, custody)
            )) + "\n")
            time.sleep(0.15)
            self.assertTrue(self.alive(owner["pid"]), "undeclared canonical terminal stopped owner")
            os.utime(stale, None)
            time.sleep(0.15)
            self.assertTrue(self.alive(owner["pid"]), "touched pre-actor result stopped owner")
            stale.unlink()
            self.write_bound_result(lane, owner, {"pass": True})
            time.sleep(0.15)
            self.assertTrue(self.alive(owner["pid"]), "malformed generic pass stopped owner")
            stale.unlink()
            self.write_bound_result(lane, owner, {"version": "unknown.v1", "state": "succeeded"})
            time.sleep(0.15)
            self.assertTrue(self.alive(owner["pid"]), "unsupported state terminal stopped owner")
            stale.unlink()
            self.write_bound_result(lane, owner, self.raw_result(owner))
            self.assert_owner_gone(owner)
            receipts = self.finish(custody)
            self.assertGreaterEqual(len([entry for entry in receipts if entry["event"] == "terminal-rejected"]), 3)

    def test_canonical_failure_shape_stops_only_its_declared_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            _root, lane, owner_script, snapback2, custody, _actor = self.fixture(directory)
            owner = self.start_owner(owner_script, snapback2, custody, lane, "M6", 1, "scale-failure")
            self.write_bound_result(lane, owner, self.canonical_failure(owner))
            self.assert_owner_gone(owner)
            receipts = self.finish(custody)
            associated = [entry for entry in receipts if entry["event"] == "terminal-associated"]
            self.assertEqual(associated[-1]["outcome"], "failure:aborted")

    def test_canonical_success_custody_matches_current_fixture_authority(self):
        with tempfile.TemporaryDirectory() as directory:
            _root, lane, owner_script, snapback2, custody, _actor = self.fixture(directory)
            owner = self.start_owner(owner_script, snapback2, custody, lane, "M8", 1, "scale-canonical")
            authority = custody.canonical_fixture_authority
            invalid_cases = (
                "wrong-fixture-hash", "wrong-action-count", "wrong-checkpoints",
                "partial-completed-prefix", "excessive-excluded-time",
            )
            rejected = 0
            for case in invalid_cases:
                value = self.canonical_result(lane, owner, custody)
                receipt_path = lane / value["receipt"]["path"]
                receipt = json.loads(receipt_path.read_text())
                if case == "wrong-fixture-hash":
                    receipt["actionLog"]["sha256"] = "sha256:" + "0" * 64
                elif case == "wrong-action-count":
                    receipt["actionLog"]["actionCount"] = authority["actionCount"] + 1
                elif case == "wrong-checkpoints":
                    receipt["checkpoints"] = []
                elif case == "partial-completed-prefix":
                    partial = authority["actionCount"] - 1
                    receipt["settledPrefix"] = partial
                    receipt["checkpoints"] = [
                        checkpoint for checkpoint in authority["checkpoints"]
                        if checkpoint["settledPrefix"] <= partial
                    ]
                    value["attempts"][-1]["settledPrefix"] = partial
                else:
                    value["probeWallSecondsExcluded"] = 2
                    value["wallSeconds"] = -1
                    value["capFractionUsed"] = -0.01
                receipt_bytes = (json.dumps(receipt) + "\n").encode()
                receipt_path.write_bytes(receipt_bytes)
                value["receipt"]["sha256"] = "sha256:" + hashlib.sha256(receipt_bytes).hexdigest()
                with self.subTest(case=case):
                    with self.assertRaisesRegex(ValueError, "canonical scale validator rejected"):
                        self.canonical_request(custody, lane, value)
                    self.write_bound_result(lane, owner, value)
                    rejected += 1
                    self.wait_for(
                        lambda: sum(
                            json.loads(line)["event"] == "terminal-rejected"
                            for line in custody.receipt_path.read_text().splitlines()
                        ) >= rejected,
                        f"custody did not reject {case}",
                    )
                    self.assertTrue(self.alive(owner["pid"]), f"{case} stopped the owner")
                    owner["result"].unlink()
            valid = self.canonical_result(lane, owner, custody)
            self.assertEqual(self.canonical_request(custody, lane, valid)["outcome"], "success")
            self.write_bound_result(lane, owner, valid)
            self.assert_owner_gone(owner)
            aborted_owner = self.start_owner(
                owner_script, snapback2, custody, lane, "M6", 1, "scale-canonical-aborted"
            )
            valid_aborted = self.canonical_result(
                lane, aborted_owner, custody, disposition="aborted"
            )
            self.assertEqual(
                self.canonical_request(custody, lane, valid_aborted)["outcome"],
                "failure:aborted",
            )
            self.write_bound_result(lane, aborted_owner, valid_aborted)
            self.assert_owner_gone(aborted_owner)
            self.finish(custody)

    def test_canonical_failure_requires_producer_envelope_and_accepts_settlement_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            _root, lane, owner_script, snapback2, custody, _actor = self.fixture(directory)
            owner = self.start_owner(owner_script, snapback2, custody, lane, "M6", 1, "scale-abort")
            invalid_cases = ("missing-name", "missing-message", "missing-clock-field")
            rejected = 0
            for case in invalid_cases:
                value = self.canonical_failure(owner)
                if case == "missing-name":
                    del value["failure"]["name"]
                elif case == "missing-message":
                    del value["failure"]["message"]
                else:
                    del value["clock"]["probeWallSecondsExcluded"]
                with self.subTest(case=case):
                    with self.assertRaisesRegex(ValueError, "canonical scale validator rejected"):
                        self.canonical_request(custody, lane, value)
                    self.write_bound_result(lane, owner, value)
                    rejected += 1
                    self.wait_for(
                        lambda: sum(
                            json.loads(line)["event"] == "terminal-rejected"
                            for line in custody.receipt_path.read_text().splitlines()
                        ) >= rejected,
                        f"custody did not reject {case}",
                    )
                    self.assertTrue(self.alive(owner["pid"]), f"{case} stopped the owner")
                    owner["result"].unlink()
            valid_abort = self.canonical_failure(owner)
            self.assertEqual(
                self.canonical_request(custody, lane, valid_abort)["outcome"], "failure:aborted"
            )
            self.write_bound_result(lane, owner, valid_abort)
            self.assert_owner_gone(owner)
            timeout_owner = self.start_owner(
                owner_script, snapback2, custody, lane, "M8", 1, "scale-settlement-timeout"
            )
            timeout = self.canonical_failure(timeout_owner, outcome="settlement-timeout")
            self.assertEqual(
                self.canonical_request(custody, lane, timeout)["outcome"],
                "failure:settlement-timeout",
            )
            self.write_bound_result(lane, timeout_owner, timeout)
            self.assert_owner_gone(timeout_owner)
            self.finish(custody)

    def fixture_existing(self, root, poll_seconds=0.02):
        lane = root / "lanes" / "astra-snapback2"
        owner_script = root / "fake-owner.py"
        owner_script.write_text(textwrap.dedent("""
            import http.server, json, os, signal, subprocess, sys, time
            from pathlib import Path
            project = Path(sys.argv[sys.argv.index('--project') + 1]).resolve()
            worker = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)', '--worker'])
            (project / '.snapback' / 'compiler.pid').write_text(str(worker.pid))
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_POST(self): self.send_response(200); self.end_headers()
                def log_message(self, *_args): pass
            server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
            (project / '.snapback' / 'owner.json').write_text(json.dumps({
                'pid': os.getpid(), 'project': str(project), 'url': 'http://127.0.0.1:' + str(server.server_port),
                'secret': 'test-secret', 'generation': 'test-generation', 'startedAt': int(time.time() * 1000), 'mode': 'dev'}))
            def cleanup(*_args):
                worker.terminate(); worker.wait(timeout=2)
                (project / '.snapback' / 'owner.json').unlink(missing_ok=True); raise SystemExit(0)
            signal.signal(signal.SIGTERM, cleanup); server.handle_request(); cleanup()
        """))
        snapback2 = root / "snapback2"
        snapback2.symlink_to(sys.executable)
        actor_script = root / "actor.py"
        actor_script.write_text("import time; time.sleep(60)\n")
        custody = run_support.ScaleOwnerCustody(root=root, lane=lane, name="astra-snapback2", poll_seconds=poll_seconds)
        actor = subprocess.Popen([sys.executable, str(actor_script)], env=custody.actor_env(os.environ))
        self.actors.append(actor)
        custody.start(actor.pid)
        return root, lane, owner_script, snapback2, custody, actor

    def test_current_result_before_delayed_owner_discovery_is_not_consumed(self):
        with tempfile.TemporaryDirectory() as directory:
            _root, lane, owner_script, snapback2, custody, _actor = self.fixture(directory, poll_seconds=0.5)
            owner = self.start_owner(owner_script, snapback2, custody, lane, "M6", 1, "scale-delayed")
            self.write_bound_result(lane, owner, self.raw_result(owner))
            self.assert_owner_gone(owner)
            receipts = self.finish(custody)
            events = [entry["event"] for entry in receipts]
            self.assertLess(events.index("claimed"), events.index("terminal-associated"))

    def test_actor_fast_exit_and_sigterm_both_reap_owned_processes(self):
        for behavior in ("exit", "wait"):
            with self.subTest(behavior=behavior), tempfile.TemporaryDirectory() as directory:
                _root, lane, owner_script, snapback2, custody, actor = self.fixture(directory, actor_behavior=behavior)
                owner = self.start_owner(owner_script, snapback2, custody, lane, "M6", 1, f"scale-{behavior}")
                if behavior == "exit":
                    self.assertEqual(actor.wait(timeout=5), 7)
                else:
                    actor.terminate()
                    self.assertEqual(actor.wait(timeout=5), -15)
                self.finish(custody, f"actor-{behavior}")
                self.assert_owner_gone(owner)

    def test_unchanged_unassociated_owner_is_stopped_and_fails_actionably(self):
        with tempfile.TemporaryDirectory() as directory:
            _root, lane, owner_script, snapback2, custody, _actor = self.fixture(directory)
            project = lane / "replays" / "scale-unassociated"
            (project / ".snapback").mkdir(parents=True)
            process = subprocess.Popen([
                sys.executable, str(owner_script), str(snapback2), "dev",
                "--project", str(project), "--foreground",
            ], env=custody.actor_env(os.environ))
            self.owners.append(process)
            owner_path = project / ".snapback" / "owner.json"
            compiler_path = project / ".snapback" / "compiler.pid"
            self.wait_for(lambda: owner_path.exists() and compiler_path.exists(), "unassociated owner did not start")
            owner = {"pid": json.loads(owner_path.read_text())["pid"],
                     "compilerPid": int(compiler_path.read_text())}
            self.assert_owner_gone(owner)
            with self.assertRaisesRegex(RuntimeError, "omitted/refused the executable scale-attempt boundary"):
                custody.finish("unassociated-default")

    def test_executable_scale_attempt_and_bind_result_commands_drive_real_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root, lane, owner_script, snapback2, custody, _actor = self.fixture(directory)
            project = lane / "replays" / "scale-cli-boundary"
            (project / ".snapback").mkdir(parents=True)
            result = lane / "evidence" / "scale-cli-boundary" / "result.json"
            result.parent.mkdir(parents=True)
            dev_launcher = root / "fake-dev-launcher.py"
            dev_launcher.write_text(textwrap.dedent("""
                import os, subprocess, sys, time
                from pathlib import Path
                owner_script, executable, *command = sys.argv[1:]
                subprocess.Popen([sys.executable, owner_script, executable, *command], env=os.environ,
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, start_new_session=True)
                project = Path(command[command.index('--project') + 1])
                while not (project / '.snapback' / 'owner.json').exists(): time.sleep(0.01)
            """))
            support = SOURCE / "run_support.py"
            attempt = subprocess.run([
                sys.executable, str(support), "scale-attempt",
                "--lane", str(lane), "--project", str(project),
                "--milestone", "M8", "--attempt", "1", "--result", str(result), "--",
                sys.executable, str(dev_launcher), str(owner_script), str(snapback2),
                "dev", "--project", str(project),
            ], env=custody.actor_env(os.environ), text=True, capture_output=True)
            self.assertEqual(attempt.returncode, 0, attempt.stderr)
            self.assertIn('"event": "scale-attempt-bound"', attempt.stdout)
            owner_path = project / ".snapback" / "owner.json"
            compiler_path = project / ".snapback" / "compiler.pid"
            owner_json = json.loads(owner_path.read_text())
            owner = {"pid": owner_json["pid"], "startedAt": owner_json["startedAt"],
                     "compilerPid": int(compiler_path.read_text())}
            source = result.with_name("result.unbound.json")
            source.write_text(json.dumps(self.raw_result(owner)) + "\n")
            bound = subprocess.run([
                sys.executable, str(support), "bind-result", "--lane", str(lane),
                "--result", str(result), "--source", str(source),
            ], text=True, capture_output=True)
            self.assertEqual(bound.returncode, 0, bound.stderr)
            self.assertIn('"event": "scale-result-bound"', bound.stdout)
            self.assert_owner_gone(owner)
            self.finish(custody)

    def test_first_cleanup_failure_still_attempts_second_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            _root, lane, owner_script, snapback2, custody, _actor = self.fixture(directory)
            first = self.start_owner(owner_script, snapback2, custody, lane, "M6", 1, "scale-first")
            second = self.start_owner(owner_script, snapback2, custody, lane, "M8", 1, "scale-second")
            real_port_closed = run_support._port_closed
            calls = 0
            def fail_first_port(url):
                nonlocal calls
                calls += 1
                return False if calls == 1 else real_port_closed(url)
            with mock.patch.object(run_support, "_port_closed", side_effect=fail_first_port):
                with self.assertRaisesRegex(RuntimeError, str(first["project"])):
                    custody.finish("aggregate-cleanup")
            self.assert_owner_gone(first)
            self.assert_owner_gone(second)
            receipts = [json.loads(line) for line in custody.receipt_path.read_text().splitlines()]
            cleanups = [entry for entry in receipts if entry["event"] == "cleanup"]
            self.assertEqual({entry["ownerPid"] for entry in cleanups}, {first["pid"], second["pid"]})
            self.assertEqual([entry["pass"] for entry in cleanups], [False, True])

    def test_pidfd_open_verification_and_signal_never_fall_back_to_numeric_pid(self):
        identity = {"pid": 424242, "parentPid": 1, "state": "S", "startTicks": 100,
                    "cwd": "/tmp", "command": ["snapback2", "dev"]}
        fd = os.open("/dev/null", os.O_RDONLY)
        with mock.patch.object(os, "pidfd_open", return_value=fd), \
             mock.patch.object(run_support, "_pidfd_pid", return_value=identity["pid"]), \
             mock.patch.object(run_support, "_process_identity", return_value={**identity, "startTicks": 101}), \
             mock.patch.object(signal, "pidfd_send_signal") as pidfd_signal:
            self.assertIsNone(run_support._ProcessHandle.open(identity))
            pidfd_signal.assert_not_called()

        fd = os.open("/dev/null", os.O_RDONLY)
        handle = run_support._ProcessHandle(identity, fd)
        with mock.patch.object(handle, "alive", return_value=True), \
             mock.patch.object(signal, "pidfd_send_signal") as pidfd_signal, \
             mock.patch.object(os, "kill", side_effect=AssertionError("numeric PID signal used")):
            self.assertTrue(handle.send_signal(signal.SIGTERM))
            pidfd_signal.assert_called_once_with(fd, signal.SIGTERM)
        handle.close()


if __name__ == "__main__":
    unittest.main()
