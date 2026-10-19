import pathlib,tarfile,json,hashlib,collections
r=pathlib.Path.home()/"sb4-ws-integ17";out=r/"evidence";keep=[]
for folder in [out,out/"final",out/"native",out/"packed"]:
 for p in folder.iterdir():
  if p.is_file() and p.suffix in [".log",".json"]:keep.append(p)
for p in (out/"native/witness").iterdir():
 if p.is_file() and p.suffix in [".log",".json",".jsonl"] and not p.name.endswith("-device.log"):keep.append(p)
keep.append(out/"packed/proofs/results.json")
keep.extend((out/"packed/proofs/security").glob("*/security-evidence.json"))
keep.extend(r.glob("integ17-mac-*.py"));keep.extend(r.glob("integ17-mac-*.mjs"))
keep.extend(r/n for n in ["integ17-mac-scope.json","integ17-mac-scope2.json","integ17-mac-expected-final.json"])
# Full videos and broad iOS system streams stay in the dedicated scratch, with hashes.
excluded=[]
for p in sorted((out/"native/witness").iterdir()):
 if p.suffix==".mp4" or p.name.endswith("-device.log"):excluded.append({"path":str(p),"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"reason":"video or broad simulator system stream; not needed in git"})
(out/"excluded-native-artifacts.json").write_text(json.dumps(excluded,indent=2));keep.append(out/"excluded-native-artifacts.json")
entries=[]
for p in sorted(set(keep)):
 data=p.read_bytes(); data.decode("utf8")
 assert not any(x in p.parts for x in ["node_modules","tmp",".snapback4","dist","ios"])
 name=str(p.relative_to(r)) if p.is_relative_to(out) else "scripts/"+p.name
 entries.append({"path":name,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()})
manifest={"scope":"strict allowlist: UTF-8 command/test logs, receipts, source manifests and execution scripts only","source":"fc7a63ea0f","files":entries,"filesCount":len(entries),"uncompressedBytes":sum(v["bytes"] for v in entries),"excluded":"All generated app projects, SQLite stores/credentials, node_modules, frameworks/apps/SDKs, wasm/native binaries, videos and broad simulator device logs. Only counters/verdicts retained for packed security."}
(out/"archive-manifest.json").write_text(json.dumps(manifest,indent=2))
with tarfile.open(r/"integ17-mac-evidence-safe.tar.gz","w:gz") as t:
 for v,p in zip(entries,sorted(set(keep))):t.add(p,arcname=v["path"],recursive=False)
 t.add(out/"archive-manifest.json",arcname="evidence/archive-manifest.json")
print(json.dumps({"files":len(entries)+1,"uncompressedBytes":manifest["uncompressedBytes"],"archiveBytes":(r/"integ17-mac-evidence-safe.tar.gz").stat().st_size,"archiveSha256":hashlib.sha256((r/"integ17-mac-evidence-safe.tar.gz").read_bytes()).hexdigest()}))
