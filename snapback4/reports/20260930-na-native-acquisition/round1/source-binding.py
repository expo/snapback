#!/usr/bin/env python3
"""Snapshot tracked executable/test/build/guide inputs; omit report evidence."""
import hashlib,json,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[4]
paths=subprocess.check_output(['git','ls-files','snapback4/crates','snapback4/packages','snapback4/scripts','snapback4/fixtures','snapback4/apps','snapback4/Cargo.toml','snapback4/Cargo.lock','snapback4/bun.lock','snapback4/package.json','snapback4/metrics/wasm-budget.json'],cwd=root,text=True).splitlines()
result={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths if (root/p).is_file()}
Path(sys.argv[1]).write_text(json.dumps(result,indent=2)+'\n')
