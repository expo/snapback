from datetime import datetime, timezone
from pathlib import Path
import json
import time

kit = Path.home() / 'sb4-pub-0453'
report = Path.home() / 'sb4-pub-0453-wt/snapback4/reports/20261104-publication-0.4.53'
seen = set()
while not (kit / 'lane-monitor-stop').exists():
    for path in sorted(report.glob('attempt-*.json')):
        try:
            receipt = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        key = (path.name, receipt.get('start'))
        if key in seen or 'exit' not in receipt:
            continue
        seen.add(key)
        stamp = datetime.now(timezone.utc).strftime('%H:%MZ')
        with (kit / 'STATUS.md').open('a') as out:
            out.write(f"- {stamp} Mac {receipt['step']}: exit={receipt['exit']}, {receipt.get('seconds')}s; {path.name}.\n")
    time.sleep(20)
