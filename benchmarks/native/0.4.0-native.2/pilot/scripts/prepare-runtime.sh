#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
export PATH="$HOME/.volta/bin:/opt/homebrew/bin:$PATH"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

if [[ -e "$ROOT/runtime/node/package.json" || -e "$ROOT/runtime/venv/bin/python" ]]; then
  echo "operator runtime must start absent" >&2
  exit 2
fi
mkdir -p "$ROOT/runtime/node" "$ROOT/logs/preparation"
cp "$ROOT/scripts/runtime-package.json" "$ROOT/runtime/node/package.json"
cp "$ROOT/scripts/runtime-package-lock.json" "$ROOT/runtime/node/package-lock.json"
npm --prefix "$ROOT/runtime/node" ci --ignore-scripts \
  > "$ROOT/logs/preparation/npm-ci.log" 2>&1
npm --prefix "$ROOT/runtime/node" exec -- playwright install chromium \
  > "$ROOT/logs/preparation/playwright-install.log" 2>&1
BROWSER="$(cd "$ROOT/runtime/node" && node --input-type=module -e "import {chromium} from 'playwright'; console.log(chromium.executablePath())")"
test -x "$BROWSER"
python3 -m venv "$ROOT/runtime/venv"
"$ROOT/runtime/venv/bin/python" -m pip install --disable-pip-version-check \
  -r "$ROOT/scripts/runtime-requirements.txt" \
  > "$ROOT/logs/preparation/pip-install.log" 2>&1
"$ROOT/runtime/venv/bin/python" - <<'PY'
import importlib.metadata
wanted = {'jsonschema': '4.25.1', 'pillow': '11.3.0', 'numpy': '2.0.2',
          'opencv-python-headless': '4.12.0.88'}
for name, version in wanted.items():
    assert importlib.metadata.version(name) == version, (name, importlib.metadata.version(name))
import cv2, numpy
assert cv2.__version__ == '4.12.0' and numpy.__version__ == '2.0.2'
PY
test -f "$HOME/.snapback-env.sh"
cp "$HOME/.snapback-env.sh" "$ROOT/metadata/operator-environment.sh"
python3 - "$ROOT" "$BROWSER" <<'PY'
import hashlib, json, sys, time
from pathlib import Path
root, browser = Path(sys.argv[1]), Path(sys.argv[2]).resolve()
digest = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
(root / 'metadata/operator-environment.json').write_text(json.dumps({
    'sha256': digest(root / 'metadata/operator-environment.sh'),
    'source': '~/.snapback-env.sh', 'capturedAt': time.time()}, indent=2) + '\n')
(root / 'metadata/browser.json').write_text(json.dumps({
    'executable': str(browser), 'sha256': digest(browser),
    'package': 'playwright', 'version': '1.62.1', 'capturedAt': time.time()}, indent=2) + '\n')
PY
echo "prepared pinned operator runtime"
