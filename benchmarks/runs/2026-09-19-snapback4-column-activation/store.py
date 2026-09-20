"""Stopped-store fixture backfill; never used against an application store.

This is a protocol proxy, not the proposed private maintain or its evaluator.
Only fixture row images change. The required field has no authored default.
"""
import json
import resource
import sqlite3
import sys
import time
from urllib.parse import quote

mode, path = sys.argv[1:]
started = time.monotonic()
db = sqlite3.connect(path if mode == "backfill" else f"file:{quote(path)}?mode=ro", uri=mode != "backfill")
catalog = dict(db.execute("SELECT name, num FROM _catalog"))

def scalar(query, args=()):
    return db.execute(query, args).fetchone()[0]

def counters():
    tables = {name: scalar("SELECT count(*) FROM r WHERE t=?", (catalog[name],))
              for name in ("posts", "likes") if name in catalog}
    return {"rows": tables,
            "generation": scalar("SELECT value FROM _meta WHERE key IN ('generation', 'device:generation') ORDER BY key LIMIT 1"),
            "log_rows": scalar("SELECT count(*) FROM _log"),
            "commits": scalar("SELECT count(*) FROM _commits"),
            "parents_with_count": scalar("SELECT count(*) FROM r WHERE t=? AND json_extract(data, '$.Row.likeCount.Int')=10", (catalog["posts"],))}

before = counters()
if mode == "backfill":
    assert before["rows"] == {"posts": 100000, "likes": 1000000}, before
    assert before["parents_with_count"] == 0, before
    # Derive from the million actual source images, not the generator's promise.
    totals = dict(db.execute("SELECT json_extract(data, '$.Row.postId.Id'), count(*) FROM r WHERE t=? GROUP BY 1", (catalog["likes"],)))
    assert len(totals) == 100000 and set(totals.values()) == {10}
    with db:
        db.executemany("UPDATE r SET data=json_set(data, '$.Row.likeCount', json_object('Int', ?)) WHERE t=? AND id=?",
                       ((total, catalog["posts"], parent) for parent, total in totals.items()))
    assert scalar("SELECT count(*) FROM r WHERE t=? AND json_extract(data, '$.Row.likeCount.Int')=10", (catalog["posts"],)) == 100000
after = counters()
if mode == "backfill":
    assert before["log_rows"] == after["log_rows"] and before["commits"] == after["commits"]
    assert before["generation"] == after["generation"]
print(json.dumps({"mode": mode, "before": before, "after": after,
                  "elapsed_ms": (time.monotonic() - started) * 1000,
                  "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024)}))
