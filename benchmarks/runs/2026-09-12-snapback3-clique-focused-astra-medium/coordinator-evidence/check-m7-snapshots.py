"""Read-only audit of retained M7 boundary exports; does not rewrite the grade."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
FIELDS = (
    "id conversationId senderId serverTimestamp type text caption mediaReference "
    "edited tombstone replyTo reactions ownMessageReceiptState"
).split()
result = {"scope": "exact retained pre-M7 and first post-migration exports", "inputs": [], "personas": [], "problems": []}

for actor in ("alice", "bob", "carol"):
    inputs = []
    for phase in ("pre", "post"):
        path = ROOT / f"m7-grader/inputs/{phase}-m7-snapshots/{phase}-m7-{actor}.json"
        data = path.read_bytes()
        result["inputs"].append({"path": str(path.relative_to(ROOT)), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        inputs.append(json.loads(data))
    pre, post = inputs
    if pre["principal"] != post["principal"]:
        result["problems"].append({"actor": actor, "kind": "principal content changed"})
    sides = []
    for label, snapshot in zip(("pre", "post"), inputs):
        rows = [m for c in snapshot["conversations"] for m in c["messages"]]
        by_id = {m["id"]: m for m in rows}
        if len(rows) != len(by_id):
            result["problems"].append({"actor": actor, "side": label, "kind": "duplicate message ID"})
        for row in rows:
            for field in FIELDS:
                if field not in row:
                    result["problems"].append({"actor": actor, "side": label, "id": row["id"], "missingField": field})
        sides.append(by_id)
    before, after = sides
    if set(before) != set(after):
        result["problems"].append({"actor": actor, "missingIds": sorted(set(before) - set(after)), "addedIds": sorted(set(after) - set(before))})
    for message_id in before.keys() & after.keys():
        for field in FIELDS:
            if before[message_id].get(field) != after[message_id].get(field):
                result["problems"].append({"actor": actor, "id": message_id, "changedField": field})
    rows = list(before.values())
    controls = {
        "edited": sum(bool(m["edited"]) for m in rows),
        "tombstone": sum(bool(m["tombstone"]) for m in rows),
        "replies": sum(bool(m["replyTo"]) for m in rows),
        "reactions": sum(len(m["reactions"]) for m in rows),
        "ownReactions": sum(r["mine"] is True for m in rows for r in m["reactions"]),
        "ownFetchedReceipts": sum(bool((m["ownMessageReceiptState"] or {}).get("recipientFetched")) for m in rows),
        "ownViewedReceipts": sum(bool((m["ownMessageReceiptState"] or {}).get("recipientViewed")) for m in rows),
    }
    if not all(controls.values()):
        result["problems"].append({"actor": actor, "kind": "empty required control"})
    result["personas"].append({"actor": actor, "messages": len(rows), "visible": sum(not m["tombstone"] for m in rows), "principalContentEqual": pre["principal"] == post["principal"], "controls": controls})

result["pass"] = not result["problems"]
print(json.dumps(result, indent=2))
raise SystemExit(bool(result["problems"]))
