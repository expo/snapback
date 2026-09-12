#!/usr/bin/env python3
"""Targeted custody regressions for the maintained Linux Clique runner."""

import importlib
import json
import os
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
    for name in ("prepare.py", "preflight.py", "render.py", "run_support.py", "launch.py"):
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
                self.assertFalse((root / "preflight" / "pre-builder.json").exists())
                before = (root / "SNAPBACK2_VERSION").read_bytes(), prompt.read_bytes(), receipt.read_bytes()
                with self.assertRaises(SystemExit):
                    prepare.prepare_packet(root, "0.0.26", 54100, 20)
                self.assertEqual(before, ((root / "SNAPBACK2_VERSION").read_bytes(), prompt.read_bytes(), receipt.read_bytes()))


@unittest.skipUnless(Path("/proc/self/stat").is_file(), "Linux /proc custody test")
class ScaleOwnerCustodyTest(unittest.TestCase):
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

    def run_lifecycle(self, terminal):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lane = root / "lanes" / "astra-snapback2"
            project = lane / "replays" / "scale-small"
            (project / ".snapback").mkdir(parents=True)
            (lane / "evidence" / "scale-small").mkdir(parents=True)
            (root / "logs").mkdir()
            fake_owner = root / "fake-owner.py"
            fake_owner.write_text(textwrap.dedent("""
                import http.server, json, os, signal, subprocess, sys, time
                from pathlib import Path
                project = Path(sys.argv[sys.argv.index('--project') + 1]).resolve()
                worker = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)', '--worker'])
                (project / '.snapback' / 'compiler.pid').write_text(str(worker.pid))
                class Handler(http.server.BaseHTTPRequestHandler):
                    def do_POST(self):
                        self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
                    def log_message(self, *_args): pass
                server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
                owner = {'pid': os.getpid(), 'project': str(project), 'url': 'http://127.0.0.1:' + str(server.server_port),
                         'secret': 'test-secret', 'generation': 'test', 'startedAt': int(time.time() * 1000), 'mode': 'dev'}
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
            actor_script.write_text(textwrap.dedent("""
                import subprocess, sys, time
                from pathlib import Path
                executable, owner_script, project, behavior = sys.argv[1:]
                subprocess.Popen([executable, owner_script, 'dev', '--project', project, '--foreground'], start_new_session=True)
                owner = Path(project) / '.snapback' / 'owner.json'
                while not owner.exists(): time.sleep(0.01)
                if behavior == 'exit': raise SystemExit(7)
                time.sleep(60)
            """))
            run_support.enable_child_subreaper()
            actor = subprocess.Popen([
                sys.executable, str(actor_script), str(snapback2), str(fake_owner), str(project),
                "exit" if terminal == "actor-exit" else "wait",
            ])
            custody = run_support.ScaleOwnerCustody(
                root=root, lane=lane, actor_pid=actor.pid, name="astra-snapback2", poll_seconds=0.02,
            )
            custody.start()
            custody_finished = False
            try:
                owner_path = project / ".snapback" / "owner.json"
                compiler_path = project / ".snapback" / "compiler.pid"
                self.wait_for(lambda: owner_path.exists() and compiler_path.exists(), "fake scale owner did not start")
                owner_pid = json.loads(owner_path.read_text())["pid"]
                compiler_pid = int(compiler_path.read_text())
                if terminal == "actor-exit":
                    self.assertEqual(actor.wait(timeout=5), 7)
                    custody.finish("actor-exit:7")
                    custody_finished = True
                elif terminal == "actor-signal":
                    actor.terminate()
                    self.assertEqual(actor.wait(timeout=5), -15)
                    custody.finish("actor-signal:SIGTERM")
                    custody_finished = True
                elif terminal == "success":
                    (lane / "scale-replay.json").write_text(json.dumps({
                        "version": "snapback.full-journey-scale-replay.v1",
                        "attempts": [{"disposition": "completed"}],
                    }) + "\n")
                else:
                    (lane / "evidence" / "scale-small" / "result.json").write_text(
                        json.dumps({"pass": False}) + "\n"
                    )
                self.wait_for(lambda: not self.alive(owner_pid), f"owner {owner_pid} survived {terminal}")
                self.wait_for(lambda: not self.alive(compiler_pid), f"compiler {compiler_pid} survived {terminal}")
                if not custody_finished:
                    custody.finish(f"test-{terminal}")
                    custody_finished = True
                receipts = [json.loads(line) for line in custody.receipt_path.read_text().splitlines()]
                cleanup = [entry for entry in receipts if entry["event"] == "cleanup"]
                self.assertTrue(cleanup and cleanup[-1]["pass"], receipts)
                self.assertEqual(cleanup[-1]["ownerPid"], owner_pid)
                self.assertIn(compiler_pid, cleanup[-1]["descendantPids"])
                self.assertEqual([worker["pid"] for worker in cleanup[-1]["compilerWorkers"]], [compiler_pid])
                self.assertTrue(cleanup[-1]["portClosed"])
            finally:
                if not custody_finished:
                    try:
                        custody.finish(f"test-cleanup-{terminal}")
                    except Exception:
                        pass
                if actor.poll() is None:
                    actor.terminate()
                    actor.wait(timeout=5)

    def test_scale_owner_and_compiler_stop_after_success(self):
        self.run_lifecycle("success")

    def test_scale_owner_and_compiler_stop_after_failure(self):
        self.run_lifecycle("failure")

    def test_scale_owner_and_compiler_stop_after_actor_exit(self):
        self.run_lifecycle("actor-exit")

    def test_scale_owner_and_compiler_stop_after_actor_signal(self):
        self.run_lifecycle("actor-signal")


if __name__ == "__main__":
    unittest.main()
