"""Force a legal offline/reconnect history before minting the search cursor.

The unchanged seed-130 page equality must then survive a plain reopen. This
control does not alter the whole oracle or accept a restarted page.
"""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=root/'target/sl-load/controls/ordinary-search-trace-v2.test.mjs';s=source.read_text()
needle='        const visible = () => model.readable(!offline);';assert s.count(needle)==1
s=s.replace(needle,'''        offline = true;
        await client.sync();
        offline = false;
        await client.sync();
        model.sync();
        trace.push({event: 'controlled offline/reconnect before cursor'});
'''+needle)
start=s.index("for (const host of ['process']) for (let repetition")
s=s[:start]+'''for (const host of ['process','wasm']) for (let repetition=1; repetition<=5; repetition++)
    test(`reconnect before cursor then plain reopen: ${host} repetition ${repetition}`, {timeout: 60000}, async () => {
        await scenario(host,130);
    });
'''
target=root/'target/sl-load/controls/ordinary-search-reconnect.test.mjs';target.write_text(s)
Path(__file__).with_name('search-reconnect-source.json').write_text(json.dumps({'input':str(source.relative_to(root)), 'input_sha256':hashlib.sha256(source.read_bytes()).hexdigest(), 'output':str(target.relative_to(root)), 'output_sha256':hashlib.sha256(target.read_bytes()).hexdigest(), 'seed':130,'hosts':['process','wasm'],'repetitions_per_host':5,'injection':'offline sync, online sync before minting the cursor; unchanged normal oracle assertions'},indent=2)+'\n')
