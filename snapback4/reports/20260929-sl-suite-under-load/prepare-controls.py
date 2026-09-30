"""Preserve baseline assertions while adding timelines to intermittent cases.

Controls are generated outside the suite inventory; run.py records their runs.
They import this checkout's built client. The report must distinguish such
focused diagnostics from whole-suite qualification.
"""
import hashlib
import json
from pathlib import Path
import subprocess

report = Path(__file__).resolve().parent
root = report.parents[1]
base = json.loads((report / 'environment.json').read_text())['head']
output = root / 'target/sl-load/controls'
output.mkdir(parents=True, exist_ok=True)
records = []
for name in ['answer-withdrawal', 'client-lifecycle', 'web-admission-review']:
    path = f'snapback4/packages/snapback4/test/{name}.test.mjs'
    original = subprocess.check_output(['git', 'show', f'{base}:{path}'], cwd=root, text=True)
    text = original.replace('"../dist/', json.dumps(str(root / 'packages/snapback4/dist'))[:-1] + '/')
    text = text.replace('"../src/wasm/', json.dumps(str(root / 'packages/snapback4/src/wasm'))[:-1] + '/')
    if name == 'client-lifecycle':
        text = text.replace('const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");', f'const root = {json.dumps(str(root))};')
        start = text.index('  test(`${tier}: population growth cannot mint new IDs during prediction replay`')
        end = text.index('  test(`${tier}: retry without observers', start)
        case = text[start:end]
        case = case.replace('    const deviceRefusals = [];', '''    const deviceRefusals = [], timeline = [];
    t.after(() => t.diagnostic('replay timeline: ' + JSON.stringify(timeline)));''')
        case = case.replace('        const result = await core.call(request);', '''        const result = await core.call(request);
        if (['sync_state', 'observe_store', 'apply', 'begin_send', 'admit'].includes(request.op)) timeline.push({ at: performance.now(), request: structuredClone(request),
          result: structuredClone(result), ...(result.denied ? { stack: new Error().stack } : {}) });''')
        text = text[:start] + case + text[end:]
    elif name == 'answer-withdrawal':
        text = text.replace('resolve(import.meta.dirname, "../../../target/debug/snapback4")', json.dumps(str(root / 'target/debug/snapback4')))
        start = text.index('for (const keep of [undefined, false]) for (const mode of ["held"')
        case = text[start:]
        case = case.replace('  let armed = false;', '''  let armed = false;
  const timeline = [];
  t.after(() => t.diagnostic('withdrawal timeline: ' + JSON.stringify(timeline)));''')
        case = case.replace('    if (armed &&', '''    timeline.push({ at: performance.now(), event: 'request', path: new URL(input).pathname, armed });
    if (armed &&''', 1)
        case = case.replace('  const watch = client.observe(readOp, {}, { keep });', '''  const watch = client.observe(readOp, {}, { keep });
  watch.subscribe(() => timeline.push({ at: performance.now(), event: 'observation', read: structuredClone(watch.getSnapshot()), deadline: episodeDeadline(watch.getSnapshot()) }));''')
        case = case.replace('  armed = true;', '''  timeline.push({ at: performance.now(), event: 'arm', read: structuredClone(watch.getSnapshot()) });
  armed = true;''')
        text = text[:start] + case
    else:
        text = text.replace("'../../../witness/lib.mjs'", repr(str(root / 'witness/lib.mjs')))
        text = text.replace("'./helpers/app-server.mjs'", repr(str(root / 'packages/snapback4/test/helpers/app-server.mjs')))
        start = text.index("  for (const hidden of [false, true]) await check(`replacement after validation")
        end = text.index("  for (const recovered of [false, true])", start)
        case = text[start:end]
        case = case.replace("    const { session } = await fresh(), before = await total(session);", """    const timeline = [], started = performance.now();
    const mark = (event, detail) => timeline.push({ ms: performance.now() - started, event, detail });
    const trace = async (event, work) => { mark(event + ':begin'); try { return await work(); } finally { mark(event + ':end'); } };
    const { session } = await trace('fresh', fresh), before = await total(session);
    const request = request => { if (['/probe', '/sync', '/m/removeMember'].includes(new URL(request.url()).pathname)) mark('request', { url: request.url(), body: request.postData() }); };
    const responseEvent = response => { if (response.url().endsWith('/m/removeMember')) mark('response', response.status()); };
    page.on('request', request); page.on('response', responseEvent);""")
        case = case.replace("      replacement = await replacementFor(session);", "      replacement = await trace('replacement', () => replacementFor(session));")
        case = case.replace("      await peer.evaluate(() => app.close()); await peer.close();", "      await trace('peer-app-close', () => peer.evaluate(() => app.close())); await trace('peer-page-close', () => peer.close());")
        case = case.replace("      const rejected = await response;", """      const rejected = await response.catch(async error => {
        mark('original-response-timeout');
        // Keep the original failure. Observe whether release/transport actually
        // completes late, or whether this is a missed recovery rather than load.
        const late = await page.waitForResponse(r => r.url() === replacement.api + '/m/removeMember', { timeout: 60_000 }).catch(() => null);
        mark('late-response', late?.status());
        mark('state', await page.evaluate(async () => ({ sent, pollCount, outcomes, openingDone,
          link: app.client.link, store: await core.call({ op: 'sync_state', capture: false }), queued: await core.call({ op: 'queued' }), locks: await navigator.locks.query() })));
        throw error;
      });""")
        case = case.replace("    } finally {", """    } finally {
      mark('cleanup');
      t.diagnostic('orphan timeline: ' + JSON.stringify(timeline));
      page.off('request', request); page.off('response', responseEvent);""")
        text = text[:start] + case + text[end:]
    target = output / f'{name}.test.mjs'
    target.write_text(text)
    records.append({'base': base, 'original': path, 'original_sha256': hashlib.sha256(original.encode()).hexdigest(),
                    'control': str(target.relative_to(root)), 'control_sha256': hashlib.sha256(text.encode()).hexdigest()})
(report / 'control-sources.json').write_text(json.dumps(records, indent=2) + '\n')
print('Prepared timeline controls; no tests executed.')
