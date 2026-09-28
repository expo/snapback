#!/usr/bin/env python3
"""Run the existing invalid-boundary regression with hostile native stderr."""
import json
import os
import subprocess
import sys

for binary in sys.argv[1:]:
    for fault in ("closed", "full"):
        reader, writer = os.pipe()  # Python creates non-inheritable descriptors.
        if fault == "closed":
            os.close(reader)
        else:
            os.set_blocking(writer, False)
            try:
                while True:
                    os.write(writer, b"x" * 4096)
            except BlockingIOError:
                pass
            os.set_blocking(writer, True)
        command = [binary, "--exact", "staged_completion_and_unsolicited_boundary_and_legacy_wire", "--nocapture"]
        try:
            result = subprocess.run(command, stdout=subprocess.PIPE, stderr=writer, timeout=10)
            print(json.dumps({"binary": binary, "fault": fault, "exit": result.returncode, "stdout": result.stdout.decode()}), flush=True)
        except subprocess.TimeoutExpired:
            print(json.dumps({"binary": binary, "fault": fault, "timeout": 10}), flush=True)
        finally:
            os.close(writer)
            if fault == "full":
                os.close(reader)
