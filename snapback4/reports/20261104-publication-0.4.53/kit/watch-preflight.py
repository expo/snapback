from datetime import datetime, timezone
from pathlib import Path
import json
import time

kit = Path.home() / 'sb4-pub-0453'
receipts = Path.home() / 'sb4-pub-0453-wt/target/affected'
seen = set()
while True:
    for path in sorted(receipts.glob('*.json')):
        try:
            receipt = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for result in receipt.get('results', []):
            key = (str(path), result['id'])
            if key in seen:
                continue
            seen.add(key)
            stamp = datetime.now(timezone.utc).strftime('%H:%MZ')
            with (kit / 'STATUS.md').open('a') as out:
                out.write(f"- {stamp} affected {result['id']}: exit={result['status']}, {result.get('elapsedMs', 0) / 1000:.1f}s; receipt {path.name}.\n")
    if (kit / 'release-evidence/affected.exit').exists():
        break
    time.sleep(30)
