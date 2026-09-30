from pathlib import Path
import hashlib, json, sys
import time
while Path('reports/20260930-pr-subscription-pressure/round1/hold-suite').exists():
    time.sleep(1)
root = Path.cwd()
files = set()
for directory in ['crates', 'packages/snapback4/src', 'packages/snapback4/test', 'scripts']:
    files.update(p for p in (root/directory).rglob('*') if p.is_file() and not {'target', 'node_modules', 'dist'} & set(p.relative_to(root).parts))
files.update(root/p for p in ['Cargo.toml','Cargo.lock','package.json','bun.lock','metrics/wasm-budget.json','packages/snapback4/package.json','packages/snapback4/README.md','packages/snapback4/CLIENT-AND-OPERATIONS.md'])
manifest = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}
Path(sys.argv[1]).write_text(json.dumps(manifest, indent=2)+'\n')
print(f'{len(manifest)} inputs recorded')
