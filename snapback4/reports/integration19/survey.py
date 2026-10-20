"""Read-only 250-schema check survey; all compilation occurs in owned scratch."""
import concurrent.futures, gzip, hashlib, json, pathlib, shutil, subprocess, sys, tempfile, time
ROOT = pathlib.Path(__file__).resolve().parents[3]
BINARY, OUTPUT = pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2]).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
inputs = json.loads((ROOT / "snapback4/reports/20261018-sec/inputs.json").read_text())
for schema in sorted([*pathlib.Path.home().glob("sb4-loop/wave18/apps/*-snapback-*/snapback/schema.q"),*pathlib.Path.home().glob("sb4-loop/wave19/apps/*-snapback-*/snapback/schema.q")]):
    inputs.append({"wave": int(schema.parents[3].name.removeprefix("wave")), "lane": schema.parent.parent.name, "sources": [{"path": str(p), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(schema.parent.glob("*.q"))]})
assert len(inputs) == 250
previous = {}
if len(sys.argv) > 3:
    previous = {(x["wave"], x["lane"]): x for x in (json.load(gzip.open(sys.argv[3], "rt")) if sys.argv[3].endswith(".gz") else json.loads(pathlib.Path(sys.argv[3]).read_text()))["apps"]}
def one(item):
    if (item["wave"], item["lane"]) in previous:
        return previous[(item["wave"], item["lane"])]
    with tempfile.TemporaryDirectory(prefix="sb4-integ19-survey-", dir=pathlib.Path.home()) as tmp:
        target = pathlib.Path(tmp) / "snapback"; target.mkdir(); sources = []
        for source in item["sources"]:
            path = pathlib.Path(source["path"]); data = path.read_bytes()
            sources.append({"path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "matches_previous_survey": hashlib.sha256(data).hexdigest() == source["sha256"]})
            (target/path.name).write_bytes(data)
        start=time.monotonic()
        run=subprocess.run(["timeout", "180s", str(BINARY), "check", "--json"],cwd=tmp,text=True,capture_output=True,timeout=190)
        try: result=json.loads(run.stdout)
        except ValueError: result={"raw":run.stdout,"stderr":run.stderr}
        return {"wave": item["wave"], "lane":item["lane"],"exit":run.returncode,"seconds":round(time.monotonic()-start,3),"sources":sources,"diagnostics":result.get("problems",[]),"compiler_notes":result.get("notes",[]),"security_notes":result.get("security",{}).get("notes",[])}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: apps=list(pool.map(one,inputs))
result={"binary_sha256":hashlib.sha256(BINARY.read_bytes()).hexdigest(),"apps":apps}
(OUTPUT/"survey.json").write_text(json.dumps(result,indent=2)+"\n")
print(json.dumps({"apps":len(apps),"failed":[[a["wave"],a["lane"],a["exit"]] for a in apps if a["exit"]],"unchanged_sources":all(s["matches_previous_survey"] for a in apps for s in a["sources"])}))
