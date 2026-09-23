"""Reproduce the stopped-database check used after acquisition attempt 2.

This is explicitly AFTER the driver's reconnect, not an exact-ID check during
the offline phase. Run against the preserved stopped-documents copy on M5.
"""
from pathlib import Path
from urllib.parse import quote
import hashlib, json, sqlite3, sys

documents, fixture = map(Path, sys.argv[1:3])
files = list(documents.glob('*.sqlite'))
assert len(files) == 1, files
expected = json.loads(fixture.read_text())
db = sqlite3.connect('file:' + quote(str(files[0])) + '?mode=ro', uri=True)
held = {r[0] for r in db.execute("select id from r where t=(select num from _catalog where name='messages')")}
assert held == set(expected['requiredMessageIds'])
members = db.execute("select count(*) from r where t=(select num from _catalog where name='members')").fetchone()[0]
assert members == expected['requiredMembershipRows']
print(json.dumps({'messages': len(held), 'members': members, 'messageIdsSha256': hashlib.sha256('\n'.join(sorted(held)).encode()).hexdigest(), 'phase': 'stopped after reconnect'}))
