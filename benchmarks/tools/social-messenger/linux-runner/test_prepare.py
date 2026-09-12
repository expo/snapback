#!/usr/bin/env python3
"""Targeted custody regressions for the maintained Linux Clique runner."""

import importlib
import os
import socket
import subprocess
import sys
import tempfile
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


if __name__ == "__main__":
    unittest.main()
