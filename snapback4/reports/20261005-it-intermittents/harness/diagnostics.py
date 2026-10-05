#!/usr/bin/env python3
"""Count recorded diagnostics, separately from native test verdicts."""
import collections
import gzip
import json
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
decoder = json.JSONDecoder()
summary = {}
def logs(directory):
    archive = directory / "logs.tar.gz"
    if archive.exists():
        with tarfile.open(archive, "r:gz") as packed:
            for entry in packed.getmembers():
                if entry.isfile() and entry.name.endswith(".log.gz"):
                    yield entry.name, packed.extractfile(entry).read()
    else:
        for path in sorted(directory.glob("*.log.gz")):
            yield path.name, path.read_bytes()

for phase in ("baseline", "fixed", "candidate", "burst", "pressure", "worker-fixed", "worker-final", "suite", "suite-final"):
    events = []
    suite_log = root / ("full-suite-final.log.gz" if phase == "suite-final" else "full-suite.log.gz")
    inputs = [(suite_log.name, suite_log.read_bytes())] if phase.startswith("suite") and suite_log.exists() else logs(root / phase)
    for name, blob in inputs:
        for line in gzip.decompress(blob).decode(errors="replace").splitlines():
            if "IT_DIAGNOSTIC " not in line:
                continue
            try:
                event, _ = decoder.raw_decode(line.split("IT_DIAGNOSTIC ", 1)[1])
            except json.JSONDecodeError:
                continue
            event["log"] = name
            events.append(event)
    counts = collections.Counter()
    timeouts = []
    for event in events:
        error = event.get("error") or {}
        while error.get("cause"):
            error = error["cause"]
        code = str(error.get("code", error.get("name", "unknown")))
        counts[f"{event['kind']}:{code}"] += 1
        if code == "UND_ERR_CONNECT_TIMEOUT":
            timeouts.append(event)
    summary[phase] = {"events": len(events), "codes": dict(counts), "connectTimeouts": timeouts,
                      "maxFDsAtError": max((event["fds"] for event in events if isinstance(event.get("fds"), int)), default=None),
                      "maxRecordedLoopDelayMs": max((event.get("lagMaxMs", 0) for event in events), default=None)}
    if phase == "suite-final":
        summary[phase]["logIncomplete"] = True  # ENOSPC interrupted the outer log's collection.
print(json.dumps(summary, indent=2))
