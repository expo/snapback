import pathlib,subprocess,os,tempfile,shutil,time,json,hashlib
root=pathlib.Path.home()/"sb4-ws-sec4"/"snapback4"
os.chdir(root)
binary=root/"target/production/snapback4";source=root/"crates/snapback4-lang/src/bind/security/challenges/column_reads.rs"
end=time.monotonic()+1800
while not binary.exists() or binary.stat().st_mtime<source.stat().st_mtime:
 if time.monotonic()>end:raise SystemExit("current production build did not finish")
 time.sleep(10)
out=root/"reports/20261019-sec4-wave19/mac-final4-packed";out.mkdir(parents=True,exist_ok=True)
os.environ["PATH"]="/opt/homebrew/bin:"+os.environ["PATH"]
with tempfile.TemporaryDirectory(prefix="sec4-mac-platform-",dir=out) as d:
 p=pathlib.Path(d)
 for f in ["package.json","THIRD-PARTY-NOTICES"]:shutil.copy2(root/"packages/snapback4-darwin-arm64"/f,p/f)
 shutil.copy2(binary,p/"snapback4")
 r=subprocess.run(["npm","pack","--ignore-scripts","--json","--pack-destination",str(out),str(p)],capture_output=True,text=True,timeout=120)
 if r.returncode:raise SystemExit(r.stderr)
 platform=out/json.loads(r.stdout)[0]["filename"]
 client=root.parent/"sec4-approved-client.tgz"
 for file in [client,platform,binary]:print("SHA256",hashlib.sha256(file.read_bytes()).hexdigest(),file,flush=True)
 subprocess.run(["node","scripts/publication-security.mjs",str(client),str(platform),str(out/"security")],check=True,timeout=1800)
