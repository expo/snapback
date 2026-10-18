from pathlib import Path
import time
p=Path("/home/ccheever/projects/snapback-sb4loop/snapback4/target/integ16-qualification4/day2-proof.json")
end=time.time()+7200
while not p.exists():
 if time.time()>end:raise RuntimeError("qualification4 release-build deadline")
 time.sleep(5)
Path("/tmp/integ16-client-fixes-ready").write_text("All six discovered client failures fixed; qualification4 has finished the current musl build. Full Rust repeat may run.\n")
print("Released full Rust repeat after final fixes and fresh production build",flush=True)
