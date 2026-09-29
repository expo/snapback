"""Prepare a fresh private replay using SQ's unchanged adaptation/protocol."""
import os, pathlib, shutil, sys

root = pathlib.Path(__file__).resolve().parents[4]
base = pathlib.Path(sys.argv[2]).resolve()
source = pathlib.Path(sys.argv[1]).resolve()
base.mkdir(parents=True, exist_ok=True)
if (base / 'replay').exists():
    raise RuntimeError('replay already exists; use a fresh output directory')
shutil.copytree(source, base / 'replay', symlinks=True,
                ignore=shutil.ignore_patterns('.snapback4', 'evidence', 'node_modules', 'instrument'))
for p in (base / 'replay').rglob('*'):
    if not p.is_symlink(): p.chmod(p.stat().st_mode | 0o200)
modules = base / 'replay/node_modules'
(modules / '.bin').mkdir(parents=True)
(modules / 'snapback4').symlink_to(root / 'snapback4/packages/snapback4')
(modules / '.bin/snapback4').symlink_to(base / 'server')
(base / 'replay/instrument').mkdir()
(base / 'replay/instrument/fixtures').symlink_to(root / 'benchmarks/fixtures/social-messenger')
sq = root / 'snapback4/reports/20260929-sq-storage-read-path/tools'
code = (sq / 'prepare-live.py').read_text()
code = code.replace("base=root/'target/sq'", f'base=pathlib.Path({str(base)!r})')
code = code.replace("base/'snapback4-diagnostic'", "base/'server'")
code = code.replace('49561', os.environ.get('BP_PORT', '49671'))
exec(compile(code, str(sq / 'prepare-live.py'), 'exec'))
# SQ's source copies the template's generated types, then dev refreshes them.
# Timestamp the end of probes before verification/snapshot so drain is measured
# from a well-defined point, even though verification itself lets work progress.
p = base / 'live/scripts/replay.mjs'
s = p.read_text().replace('  fs.copyFileSync(stateFile, "state.private.json");',
    '  fs.writeFileSync(path.resolve("..",stage+"-immediate-end.json"),JSON.stringify({at:Date.now()}));\n  fs.copyFileSync(stateFile, "state.private.json");')
p.write_text(s)
