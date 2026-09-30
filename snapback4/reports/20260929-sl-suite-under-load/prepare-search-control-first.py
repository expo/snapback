"""Trace seed 130 without altering any assertion in the ordinary-search oracle.

The generated diagnostic lives outside the suite inventory. Whole-suite seed
counts and source remain unchanged. Existing device calls are observed, without
adding an extra device read or wait to the schedule.
"""
import hashlib
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
source = root / 'packages/snapback4/test/ordinary-search-oracle.test.mjs'
s = source.read_text()
s = re.sub(r"from '(\.\.?/[^']+)'", lambda m: 'from ' + json.dumps(str((source.parent / m[1]).resolve())), s)
s = s.replace("new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)", json.dumps(str(root / 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')))
old = 'core = await opener.open(...args); return core;'
assert s.count(old) == 1
s = s.replace(old, '''core = await opener.open(...args);
                    const call = core.call.bind(core);
                    core.call = async request => {
                        const reply = await call(request);
                        if (request.op === 'search_state') trace.push({ event: 'search-state', initial: !request.spent, epoch: reply.ok?.epoch, delivery: reply.ok?.delivery, left: reply.ok?.left });
                        return reply;
                    };
                    trace.push({ event: 'opened' });
                    return core;''')
old = 'trace.push({ page, c: !!c, ids:'
assert s.count(old) == 1
s = s.replace(old, '''trace.push({ page, incoming: decode(c), outgoing: decode(read.next), c: !!c, ids:''')
s = s.replace("const query =", "const decode = c => c?.startsWith('sb4s:') ? JSON.parse(Buffer.from(c.slice(5), 'base64url').toString()) : c;\nconst query =", 1)
s = s.replace('client = await createLocalClient(options);', '''client = await createLocalClient(options);
        trace.push({event: 'client-open', link: client.link()});
        client.onLink(link => trace.push({event: 'link', link}));''')
start = s.index('const seeds = process.env.SB4_SEARCH_SEEDS')
s = s[:start] + '''for (const host of ['process', 'wasm']) for (let repetition = 1; repetition <= 100; repetition++)
    test(`seed 130 ${host} repetition ${repetition}`, {timeout: 60000}, async () => {
        await scenario(host, 130);
        await scenario(host, 130, true);
    });
'''
target = root / 'target/sl-load/controls/ordinary-search-trace.test.mjs'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(s)
record = {'source': str(source.relative_to(root)), 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
          'control': str(target.relative_to(root)), 'control_sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
          'seed': 130, 'hosts': ['process', 'wasm'], 'repetitions_per_host': 100,
          'schedules': ['normal', 'current-only'], 'assertions': 'unchanged'}
Path(__file__).with_name('search-control-source.json').write_text(json.dumps(record, indent=2) + '\n')
print('Prepared seed-130 diagnostic, 100 repetitions per host; not executed.')
