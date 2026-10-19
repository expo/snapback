"""Replay retained production data on owned copies; never write evidence lanes.

The unchanged-source pass measures the published apps as authored. The opt-in
020 pass adds the new declaration on a copy, and measures its old reason view.
The population assertions precede read rules and are not per-viewer claims.
"""
import argparse
from contextlib import contextmanager, closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile

LANES = "006 008 020 023 035 037 039 040 043 047 049".split()


@contextmanager
def connection(path):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        yield db
    finally:
        db.close()


def snapshot(path):
    with connection(path) as db:
        meta = dict(db.execute("SELECT key,value FROM _meta"))
        schema = json.loads(db.execute("SELECT schema FROM _generations WHERE generation=?", (int(meta["generation"]),)).fetchone()[0])
        private = {m["target"] for m in schema.get("maintains", [])}
        rows = {}
        for name, identity, data in db.execute("SELECT c.name,r.id,r.data FROM r JOIN _catalog c ON c.num=r.t ORDER BY c.name,r.id"):
            if name.startswith("$") or name in private or name not in schema["tables"]:
                continue
            table = schema["tables"][name]
            fields = json.loads(data)["Row"]
            view = {"id": fields["id"]}
            for column, kind in table.get("columns", {}).items():
                if column in fields:
                    view[column] = fields[column]
                elif isinstance(kind, dict) and "Optional" in kind:
                    view[column] = "Null"
                elif "Literal" in table.get("defaults", {}).get(column, {}):
                    view[column] = table["defaults"][column]["Literal"]
            rows.setdefault(name, {})[identity] = view
        events = db.execute("SELECT count(*) FROM _release_events").fetchone()[0]
        return {"release": int(meta["release"]), "revision": int(meta.get("release_revision", 0)), "events": events, "schema": schema, "rows": rows}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--evidence", type=Path, default=Path.home() / "sb4-loop/wave19/apps")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    binary = str(args.binary.resolve())
    results = []
    args.out.parent.mkdir(parents=True, exist_ok=True)
    for number in LANES:
        source = next(args.evidence.glob(number + "-snapback-*"))
        result = {"lane": source.name, "sourceReadOnly": True, "populationScope": "authoritative schema view before read rules"}
        try:
            with tempfile.TemporaryDirectory(prefix="sb4-dorm-wave19-") as temporary:
                cwd = Path(temporary)
                os.chmod(cwd, 0o700)
                deployment = cwd / "deployment"
                deployment.mkdir()
                shutil.copytree(source / "deploy/releases", deployment / "releases", ignore=shutil.ignore_patterns(".snapback4", "node_modules"))
                with connection(source / "deploy/store.sqlite") as original, closing(sqlite3.connect(deployment / "store.sqlite")) as copied:
                    original.backup(copied)
                initial = snapshot(deployment / "store.sqlite")
                release = initial["release"]
                (deployment / "current").write_text(str(release) + "\n")
                shutil.copytree(deployment / "releases" / str(release) / "snapback", cwd / "snapback")
                (cwd / "package.json").write_text('{"private":true,"type":"module"}\n')

                def invoke(*words, ok=True):
                    process = subprocess.run([binary, *map(str, words)], cwd=cwd, capture_output=True, text=True, timeout=120)
                    if ok and process.returncode:
                        raise RuntimeError(" ".join(map(str, words)) + "\n" + process.stdout + process.stderr)
                    return process

                def status():
                    return json.loads(invoke("releases", deployment, "--json").stdout)

                def count_inspection(table, mode):
                    quoted = '"' + table.replace('"', '""') + '"'
                    return json.loads(invoke("sql", "SELECT _snapback_state, COUNT(*) FROM " + quoted + " GROUP BY _snapback_state", "--release", deployment, mode, "--json").stdout)["rows"]

                moves = []
                for turn in range(2):
                    before = snapshot(deployment / "store.sqlite")
                    preview = json.loads(invoke("rollback", deployment, "--to", "1", "--check", "--json").stdout)
                    assert snapshot(deployment / "store.sqlite") == before, "preview mutated copied live state"
                    invoke("rollback", deployment, "--to", "1")
                    older = snapshot(deployment / "store.sqlite")
                    absent = {}
                    older_tables = set(older["schema"]["tables"])
                    for table, rows in before["rows"].items():
                        missing = sorted(set(rows) - set(older["rows"].get(table, {})))
                        if missing:
                            absent[table] = {"rows": len(missing), "targetHasTable": table in older_tables, "sampleIds": missing[:5], "inspection": count_inspection(table, "--dormant")}
                    old_nulls = sum(row.get("reason", "Null") == "Null" for row in older["rows"].get("extensions", {}).values())
                    # First forward exercises upgraded-source identity selection;
                    # second exercises explicit immutable-source selection.
                    invoke("deploy", deployment) if turn == 0 else invoke("rollback", deployment, "--to", "latest")
                    forward = snapshot(deployment / "store.sqlite")
                    lost = {table: sorted(set(rows) - set(forward["rows"].get(table, {}))) for table, rows in before["rows"].items()}
                    changed = {table: [identity for identity, row in rows.items() if identity in forward["rows"].get(table, {}) and row != forward["rows"][table][identity]] for table, rows in before["rows"].items()}
                    assert not any(lost.values()), "forward lost retained rows"
                    assert not any(changed.values()), "forward changed interpreted authoritative data"
                    moves.append({"round": turn + 1, "previewVisibility": preview.get("visibility"), "dormantByTable": absent, "activeV1": {table: len(rows) for table, rows in older["rows"].items()}, "oldReasonNulls": old_nulls, "forward": {"lost": 0, "changed": 0, "release": forward["release"]}})
                result["rounds"] = moves
                result["releaseDirectories"] = sorted(path.name for path in (deployment / "releases").iterdir())
                if number == "020":
                    schema = cwd / "snapback/schema.q"
                    schema.write_text(schema.read_text() + "\ndown extensions legacyReason(id: id):\n  {reason:(explanations[extension = id] ! else MISSING_REASON).explanation}\n")
                    invoke("deploy", deployment)
                    declared = status()["release"]
                    check = json.loads(invoke("rollback", deployment, "--to", "1", "--check", "--json").stdout)
                    invoke("rollback", deployment, "--to", "1")
                    projected = snapshot(deployment / "store.sqlite")
                    missing = sum(row.get("reason", "Null") == "Null" for row in projected["rows"].get("extensions", {}).values())
                    result["declaredReverseCopy"] = {"release": declared, "visibility": check.get("visibility"), "reasonNulls": missing, "activeExtensions": len(projected["rows"].get("extensions", {}))}
                    assert missing == 0, "declared reverse failed to preserve representable reason text"
                    invoke("rollback", deployment, "--to", "latest")
                if number == "037":
                    now = snapshot(deployment / "store.sqlite")
                    labelled = {row["pickup"]["Id"] for row in now["rows"].get("pickupSizes", {}).values()}
                    result["unchangedAppLabelHoles"] = len(set(now["rows"].get("pickups", {})) - labelled)
                    result["labelNote"] = "Original app uses a manual side-table migration, not a declared backfill; product cannot invent its missing fanout. The declared same-table catch-up is qualified separately."
                result["status"] = "passed"
        except Exception as error:
            result.update(status="failed", error=str(error))
        results.append(result)
        args.out.write_text(json.dumps({"binarySha256": hashlib.sha256(Path(binary).read_bytes()).hexdigest(), "lanes": results}, indent=2) + "\n")
        print(json.dumps({"lane": source.name, "status": result["status"], "error": result.get("error")}), flush=True)
    if any(result["status"] != "passed" for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
