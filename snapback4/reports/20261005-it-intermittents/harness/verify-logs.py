#!/usr/bin/env python3
"""Verify every recorded native result against its retained log; optionally archive.

Use --archive only after the selected phase has completed and its owners exited.
Archives preserve the original gzip members, so receipts continue to bind the
uncompressed logs. This script never changes a native verdict.
"""
import argparse
import collections
import gzip
import hashlib
import json
import tarfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("phase", choices=("baseline", "fixed", "candidate", "burst", "pressure", "worker-fixed", "worker-final"))
parser.add_argument("--archive", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent / args.phase
records = [json.loads(line) for path in sorted(root.glob("*.jsonl"))
           for line in path.read_text().splitlines()]
assert records, "no native receipts"
assert len({record["name"] for record in records}) == len(records), "duplicate invocation"
archive = root / "logs.tar.gz"
packed = tarfile.open(archive, "r:gz") if archive.exists() else None
try:
    for record in records:
        name = record["name"] + ".log.gz"
        blob = (root / name).read_bytes() if (root / name).exists() else packed.extractfile(name).read()
        assert hashlib.sha256(gzip.decompress(blob)).hexdigest() == record["logSha"], name
        assert not record["passed"] or (record["code"] == 0 and record["signal"] is None), record["name"]
finally:
    if packed:
        packed.close()
if args.archive:
    assert not archive.exists(), "archive already exists"
    assert (root / "cleanup.json").exists(), "owner-exit receipt required before archiving"
    assert json.loads((root / "cleanup.json").read_text())["allGone"], "owners still active"
    files = sorted(root.glob("*.log.gz"))
    assert len(files) == len(records), "unreceipted or missing logs"
    with tarfile.open(archive, "w:gz") as target:
        for path in files:
            target.add(path, arcname=path.name)
    # Re-read all members before removing redundant loose copies.
    with tarfile.open(archive, "r:gz") as target:
        for path in files:
            assert target.extractfile(path.name).read() == path.read_bytes(), path.name
    for path in files:
        path.unlink()
print(json.dumps({"phase": args.phase, "verified": len(records),
                  "passed": sum(record["passed"] for record in records),
                  "failed": [record["name"] for record in records if not record["passed"]],
                  "perFile": dict(collections.Counter(record["file"] for record in records)),
                  "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest() if archive.exists() else None}, indent=2))
