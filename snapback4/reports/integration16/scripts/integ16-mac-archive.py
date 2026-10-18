from pathlib import Path
import subprocess, json, hashlib, tarfile
root=Path.home()/"sb4-ws-integ16"; sb=root/"snapback4"; target=sb/"target"
rows=json.loads((target/"integ16-mac-pinned/results.json").read_text())
assert any(r["label"]=="final-client-wire-reset" for r in rows) and all(r["exit"]==0 for r in rows), "final Mac scope/extras are not all green"
expected=json.loads((root/"integ16-mac-expected.json").read_text())
for path,wanted in expected["files"].items():
 assert hashlib.sha256((root/path).read_bytes()).hexdigest()==wanted,path
actualChanges=subprocess.check_output(["git","diff","--name-only","--","snapback4"],cwd=root,timeout=20).decode().splitlines()
assert set(actualChanges)<=set(expected["files"])|{"snapback4/metrics/witness.jsonl"},actualChanges
meta={"status":subprocess.check_output(["git","status","--short"],cwd=root,timeout=20).decode(),"expectedIntegratedTree":expected,"allChangedFencedFilesMatch":True,"results":rows,"source":subprocess.check_output(["git","rev-parse","HEAD"],cwd=root,timeout=20).decode().strip(),"diff":subprocess.check_output(["git","diff","--","snapback4/crates/snapback4/tests/replay.rs","snapback4/packages/snapback4/test/periphery.test.mjs"],cwd=root,timeout=20).decode(),"node":subprocess.check_output([str(target/"node-v24.13.1-darwin-arm64/bin/node"),"--version"],timeout=10).decode().strip(),"xcode":subprocess.check_output(["xcodebuild","-version"],timeout=20).decode(),"binarySha256":hashlib.sha256((target/"debug/snapback4").read_bytes()).hexdigest()}
(target/"integ16-mac-final-binding.json").write_text(json.dumps(meta,indent=2))
archive=target/"integ16-final-mac-evidence.tar.gz"
with tarfile.open(archive,"w:gz") as t:
 for name in ["integ16-mac","integ16-mac-pinned","integ16-native-pinned"]:
  base=target/name
  for p in sorted(base.rglob("*")):
   if p.is_file() and (p.suffix in [".json",".jsonl",".log"] or "background-drain-failure" in p.relative_to(base).parts) and "tmp" not in p.relative_to(base).parts:
    t.add(p,arcname=str(p.relative_to(target)),recursive=False)
 t.add(target/"integ16-mac-final-binding.json",arcname="integ16-mac-final-binding.json")
print(archive,archive.stat().st_size)
