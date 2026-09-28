#!/usr/bin/env python3
"""Reproduce calibration queries on a fresh COPY; never open the source database.

python3 prepare.py --evidence ~/sb4-intent/gs-store --out /tmp/gs-copy \
    --binary /absolute/path/to/snapback4
Then run the gs_search_probe example against /tmp/gs-copy/.snapback4/store.sqlite.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def hashes(directory):
    return {p.name: hashlib.file_digest(p.open("rb"), "sha256").hexdigest()
            for p in sorted(directory.glob("store.sqlite*"))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--binary", type=Path, required=True)
    args = parser.parse_args()
    source = args.evidence.resolve() / "scale-1790491840"
    target = args.out.resolve()
    if target.exists():
        parser.error("--out must not exist; this probe never replaces a prior store")
    before = hashes(source / ".snapback4")
    if not {"store.sqlite", "store.sqlite-wal"} <= before.keys():
        parser.error("the supplied evidence must include the database and WAL")
    target.mkdir(parents=True)
    shutil.copytree(source / "snapback", target / "snapback")
    shutil.copytree(source / ".snapback4", target / ".snapback4")
    binary = args.binary.resolve()
    program = target / "snapback/messaging.q"
    base = ("messages matching q where not .tombstone and exists "
            "members[.conversation, viewer] last 20 by .at after c")
    sender = "senderProfile: profiles[principal = .sender]"
    chat = "chat: conversations[.conversation]"
    peers = ("peers: members[conversation = .conversation] where .principal != viewer "
             "{ profile: profiles[principal = .principal] }")
    shapes = {"bare": "", "sender": sender, "chat": chat, "peers": peers,
              "originalFixed": f"{sender}, {chat}, {peers}"}
    text = program.read_text()
    for name, shape in shapes.items():
        suffix = " { *, " + shape + " }" if shape else ""
        text += f"\nquery gs{name}(q: text <=100, c: cursor ?):\n  return {base}{suffix}\n"
    text += ("\nquery gsOriginal(q: text <=100, c: cursor ?):\n  return "
             "messages where not .tombstone matching q last 20 by .at after c"
             " { *, " + shapes["originalFixed"] + " }\n")
    text += ("\nquery gssenderChat(q: text <=100, c: cursor ?):\n  return "
             + base + " { *, " + sender + ", " + chat + " }\n")
    program.write_text(text)
    output = target / "evidence"
    output.mkdir()
    summary = {}
    try:
        for name in ["gsOriginal", *("gs" + name for name in shapes), "gssenderChat", "searchMessages"]:
            result = subprocess.run([
                str(binary), "run", "messaging." + name, '{"q":"coffee"}',
                "--as", "user:01M3GT3FPQGRMD803E1A4BPK07",
                "--now", "1790493000000", "--json",
            ], cwd=target, text=True, capture_output=True, check=True)
            (output / (name + ".json")).write_text(result.stdout)
            (output / (name + ".log")).write_text(result.stderr)
            page = json.loads(result.stdout)
            summary[name] = {**{k: v for k, v in page.items() if k not in ("data", "next")},
                             "rows": len(page["data"]) if isinstance(page["data"], list) else None,
                             "next": bool(page.get("next"))}
        original = summary["gsOriginal"]
        assert original["rows"] == 0 and not original["complete"] and not original["next"]
        assert original["cut"] is None and original["metered"]["examined"] == 1
        assert original["metered"]["index_entries"] == 33
        for name in ["gsbare", "gsoriginalFixed", "searchMessages"]:
            assert summary[name]["complete"] and summary[name]["rows"] == 20 and summary[name]["next"]
        cost = subprocess.run([str(binary), "check", "--cost", "--json"], cwd=target,
                              text=True, capture_output=True, check=True)
        (output / "cost.json").write_text(cost.stdout)
        (output / "cost.log").write_text(cost.stderr)
        (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    finally:
        after = hashes(source / ".snapback4")
        (output / "source-hashes.json").write_text(json.dumps({"before": before, "after": after}, indent=2) + "\n")
        assert before == after, "source evidence changed during reproduction"
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
