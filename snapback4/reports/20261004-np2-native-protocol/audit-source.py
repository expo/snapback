#!/usr/bin/env python3
"""Read-only source census; occurrence never means mounted/native/passing."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
ids = '''sm-auth-email sm-auth-password sm-auth-submit sm-chats-item
sm-convo-input sm-convo-send sm-convo-bubble sm-convo-receipt sm-convo-media
sm-convo-viewonce sm-convo-error sm-media-viewer-image sm-media-viewer-close
sm-search-input sm-search-result sm-search-offline'''.split()
files = sorted(p for directory in ['app', 'src', 'ui/src']
               for p in (root / directory).rglob('*') if p.is_file())
rows = {identifier: [] for identifier in ids}
for path in files:
    for number, line in enumerate(path.read_text().splitlines(), 1):
        for identifier in ids:
            if identifier in line:
                rows[identifier].append({'file': str(path.relative_to(root)), 'line': number})
print(json.dumps({
    'kind': 'source-presence-only', 'source': str(root), 'ids': rows,
    'sourceFiles': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
}, indent=2))
