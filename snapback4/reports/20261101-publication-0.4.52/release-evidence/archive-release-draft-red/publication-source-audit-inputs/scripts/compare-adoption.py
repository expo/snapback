#!/usr/bin/env python3
"""Compare every physical row/index and device-visible log/commit after adoption.
Usage: python3 scripts/compare-adoption.py legacy.db optimized.db
Both inputs must be closed/checkpointed SQLite stores from the same M7 fixture.
"""
import hashlib
import sqlite3
import sys

assert len(sys.argv) == 3, __doc__
left, right = [sqlite3.connect(f"file:{path}?mode=ro", uri=True) for path in sys.argv[1:]]
for table in ["r", "i", "_log", "_commits"]:
    columns = [row[1] for row in left.execute(f'PRAGMA table_info("{table}")')]
    order = ",".join(f'"{column}"' for column in columns)
    sql = f'SELECT * FROM "{table}" ORDER BY {order}'
    a, b = left.execute(sql), right.execute(sql)
    count, digest = 0, hashlib.sha256()
    while True:
        x, y = a.fetchone(), b.fetchone()
        assert x == y, f"{table} differs at row {count}: {x!r} != {y!r}"
        if x is None:
            break
        digest.update(repr(x).encode())
        digest.update(b"\n")
        count += 1
    print(f"{table}: {count} exact rows; sha256={digest.hexdigest()}", flush=True)
left.close()
right.close()
