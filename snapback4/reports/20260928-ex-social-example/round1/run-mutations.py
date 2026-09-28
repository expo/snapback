"""Mutate generated starter copies; never change the worktree's implementation."""
import gzip
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[3]
report = Path(__file__).resolve().parent
test = root / 'packages/snapback4/test/social-browser.test.mjs'
source = test.read_text()
source = source.replace('resolve(import.meta.dirname, "../../..")', json.dumps(str(root)))
for relative in ['../../../witness/lib.mjs', './helpers/app-server.mjs', './helpers/social-browser.mjs']:
    source = source.replace(json.dumps(relative), json.dumps(str((test.parent / relative).resolve())))
source = source.replace('  page.on("pageerror"', '  page.setDefaultTimeout(3000);\n  page.on("pageerror"')
mutants = [
    ('empty-renewal', 'src/useTyping.ts', '      if (Date.now() - touched >= 2000) stop();\n      else renew();', '      // renewal removed', 'renewal, idle without blur'),
    ('no-viewer-withdrawal', 'src/Conversation.tsx', '  useEffect(() => { if (invalid) { media.close(); onClose(); } }, [invalid, media.close, onClose]);', '', "the viewer's own read"),
    ('allow-revalidating-member', 'src/Conversation.tsx', ' && !member.revalidating', '', 'route, history and decorations'),
    ('keep-sensitive-reads', 'src/Conversation.tsx', '{ keep: false }', '{ keep: true }', 'observations make retention'),
    ('no-route-key', 'app/conversation/[id].tsx', 'key={id}', '', 'renewal, idle without blur'),
    ('no-route-visibility', 'app/conversation/[id].tsx', 'visible={focused && foreground}', '', 'renewal, idle without blur'),
    ('no-stop-on-cleanup', 'src/useTyping.ts', 'alive = false; stop();', 'alive = false; stop(false);', 'renewal, idle without blur'),
    ('close-arm-before-stop', 'src/useOnlineArm.ts', 'queueMicrotask(() => { void Promise.allSettled([...pending]).then(() => client.close()); });', 'void client.close();', 'renewal, idle without blur'),
]
results = []
for name, filename, before, after, expected in mutants:
    injection = '\n  { const file = join(dir, ' + json.dumps(filename) + '); const text = readFileSync(file, "utf8"); assert.ok(text.includes(' + json.dumps(before) + ')); writeFileSync(file, text.replaceAll(' + json.dumps(before) + ', ' + json.dumps(after) + ')); }\n'
    changed = source.replace('  const { url } = await server', injection + '  const { url } = await server')
    target = root / 'target' / ('social-mutant-' + name + '.test.mjs')
    target.write_text(changed)
    try:
        result = subprocess.run(['node', '--test', str(target)], cwd=root, capture_output=True, timeout=55)
        output = (result.stdout + result.stderr).decode()
        log = report / ('mutant-' + name + '.log.gz')
        log.write_bytes(gzip.compress(output.encode(), mtime=0))
        killed = result.returncode != 0 and any(expected in line and ('✖' in line or 'not ok' in line) for line in output.splitlines())
        results.append({'name': name, 'exit': result.returncode, 'killed_by_target': killed, 'log': log.name})
        print(json.dumps(results[-1]), flush=True)
    finally:
        target.unlink(missing_ok=True)
(report / 'mutations.json').write_text(json.dumps(results, indent=2) + '\n')
assert all(item['killed_by_target'] for item in results), results
