"""Write test-only negative controls under target; never change product sources.
Run from snapback4/, then use repeat.py with the paths printed here.
"""
import pathlib
import subprocess

root = pathlib.Path.cwd()
out = root / 'target/lane-fx-evidence'
out.mkdir(parents=True, exist_ok=True)
base = '54099bc882c529713f6e6204c5f51181f696a8ef'
tests = root / 'packages/snapback4/test'

def original(name):
    return subprocess.check_output(['git', 'show', f'{base}:snapback4/packages/snapback4/test/{name}'], text=True)

def write(name, source):
    source = source.replace("'../dist/", "'" + str(root / 'packages/snapback4/dist') + '/')
    source = source.replace('"../dist/', '"' + str(root / 'packages/snapback4/dist') + '/')
    source = source.replace("'./helpers/", "'" + str(tests / 'helpers') + '/')
    source = source.replace('"./helpers/', '"' + str(tests / 'helpers') + '/')
    source = source.replace('"../../../witness/lib.mjs"', repr(str(root / 'witness/lib.mjs')))
    source = source.replace('const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");', 'const root = ' + repr(str(root)) + ';')
    source = source.replace('const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");', 'const root = ' + repr(str(root)) + ';')
    source = source.replace('new URL("../CLIENT-AND-OPERATIONS.md", import.meta.url)', repr(str(root / 'packages/snapback4/CLIENT-AND-OPERATIONS.md')))
    source = source.replace('new URL("../../../crates/snapback4-lang/src/guide/receipts.rs", import.meta.url)', repr(str(root / 'crates/snapback4-lang/src/guide/receipts.rs')))
    path = out / name
    path.write_text(source)
    print(path.relative_to(root))

s = original('expired-server-watch.test.mjs')
s = s.replace('let replay = true, captured, active = 0, peak = 0;', 'let replay = true, captured, active = 0, peak = 0, invalidate = false;')
s = s.replace('requests.length = 0; peak = 0;', 'requests.length = 0; peak = 0; invalidate = true;')
s = s.replace('const response = await defaultFetch(input, init), answer = await response.json();', 'const response = await defaultFetch(input, init), answer = await response.json();\n          if (invalidate) { invalidate = false; await client.sync(); }')
write('expired-arrivals.control.mjs', s)

# A host can schedule a timer without delivering its callback. The old test
# polls request arrival, so this forced schedule hits its unchanged timeout.
s = original('expired-server-watch.test.mjs').replace("import test from 'node:test';", "import test from 'node:test';\nimport { AsyncLocalStorage } from 'node:async_hooks';")
s = s.replace('      const watch = client.observe', '''      const context = new AsyncLocalStorage(), held = [], realTimeout = globalThis.setTimeout;
      t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
        if (!context.getStore()) return realTimeout(callback, ms, ...args);
        const handle = realTimeout(() => {}, ms); clearTimeout(handle);
        held.push(() => { clearTimeout(handle); callback(...args); });
        return handle;
      });
      t.after(() => { for (const fire of held) fire(); });
      const watch = context.run(true, () => client.observe''').replace("{ room: 'r' }, { keep });", "{ room: 'r' }, { keep }));")
write('expired-starved-timer.control.mjs', s)

s = (tests / 'retained-history.test.mjs').read_text()
s = s.replace('    t.mock.method(clock, "sample", () => {});\n', '').replace('    t.mock.method(clientClock, "sample", () => {});\n', '')
write('retained-live-clock-final.control.mjs', s)

s = (tests / 'react.test.mjs').read_text()
s = s.replace('        enforce: "pre",', '''        enforce: "pre",
        transform(code, id) {
          if (id.endsWith('/src/journal-changes.ts')) return code.replace('window.addEventListener?.("storage", storageChanged)', 'void storageChanged');
        },''')
write('react-no-storage-final.control.mjs', s)
