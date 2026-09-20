"""Re-derive the gate from captured HTTP bodies and the raw device counters."""
import gzip
import hashlib
import json
from pathlib import Path

record = Path(__file__).resolve().parent / "evidence"
read = lambda name: json.loads((record / name).read_text())
raw = gzip.decompress((record / "before-large-page.json.gz").read_bytes())
before = json.loads(raw)
halves = [json.loads(gzip.decompress((record / f"after-half-{i}.json.gz").read_bytes())) for i in range(2)]
refusal = read("after-large-page-refusal.json")
after = {**before, "generation": refusal["generation"], "events": [e for half in halves for e in half["events"]]}
encode = lambda value: json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
before_bytes, after_bytes = len(raw), len(encode(after))
assert len(encode(before)) == before_bytes
assert hashlib.sha256(raw).hexdigest() == read("pre-activation.json")["response_sha256"]
assert all(e["data"]["likeCount"] == 10 for e in after["events"])
for event in after["events"]:
    del event["data"]["likeCount"]
after["generation"] = before["generation"]
assert after == before, "the old page differs only by the new column and generation"
ceiling = read("metadata.json")["http_ceiling_bytes"]
assert before_bytes <= ceiling < after_bytes
assert refusal["denied"]["code"] == "E_BOUND" and refusal["generation"] == 2
print(f"old page: {before_bytes} bytes; new page: {after_bytes} bytes; added: {after_bytes-before_bytes} bytes")
print(f"ceiling: {ceiling} bytes; old margin: {ceiling-before_bytes} bytes; new excess: {after_bytes-ceiling} bytes")
result = read("result.json")
activation = result["activation"]
peak = result["activation_resources"]["peak_rss_bytes"]
print(f"activation startup: {activation['startup_ms']:.3f} ms; peak RSS: {peak} bytes")
print(f"offline proxy backfill: {result['backfill']['elapsed_ms']:.3f} ms; peak RSS: {result['backfill']['peak_rss_bytes']} bytes")
requests = [json.loads(line) for line in (record / "requests.jsonl").read_text().splitlines()]
for device in result["devices"]:
    assert device["state"]["generation"] == 2
    assert device["persisted"]["after"]["parents_with_count"] == 100000
    rows = [r for r in requests if r["who"] == device["name"] and r["phase"] == f"{device['name']}-adoption"]
    print(f"{device['name']}: {device['elapsed_ms']:.3f} ms; generation {device['state']['generation']}; watermark {device['state']['watermark']}; 100000/100000 parents read 10; peak RSS {device['resource']['peak_rss_bytes']} bytes")
    print("  first requests:", " -> ".join(
        f"{r['path']}" + (f"(from={r['request']['from']},limit={r['request']['limit']}," +
            (r['denied']['code'] if r.get('denied') else f"events={r.get('events', 0)}") + ")" if r['path'] == '/sync' else '')
        for r in [r for r in rows if "path" in r][:4]))
    if device["name"] == "lagging":
        assert rows[0]["denied"]["code"] == "E_BOUND"
        assert [r["path"] for r in rows if "path" in r][:3] == ["/sync", "/schema", "/sync"]
assert result["gate5"] == "FAIL"
print("gate 5: FAIL; devices adopted 2/2; no-oversize clause FAIL")
