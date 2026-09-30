"""Instrument the unchanged R5 assertions in 100 focused repetitions.

This copy is diagnostic only, outside the suite inventory. It does not replace
any full-suite case or lower any production suite seed/sample count.
"""
import hashlib,json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
tier = sys.argv[1] if len(sys.argv) > 1 else 'wasm'
assert tier in ('wasm', 'process'), tier
source=root/'packages/snapback4/test/retained-history.test.mjs'
s=source.read_text()
s=s.replace('"../dist/',json.dumps(str(root/'packages/snapback4/dist'))[:-1]+'/')
s=s.replace('const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");',f'const root = {json.dumps(str(root))};')
a=s.index('for (const tier of ["wasm", "process"]) for (const scenario of [')
b=s.index(' test(`${scenario}',a)
s=s[:a]+f'''for (let repetition = 1; repetition <= 100; repetition++) for (const tier of [{json.dumps(tier)}]) for (const scenario of ["R5 history"])'''+s[b:]
s=s.replace('test(`${scenario} ${tier}:','test(`repetition ${repetition}: ${scenario} ${tier}:',1)
s=s.replace('  const directory = mkdtempSync', '''  const timeline = [], started = performance.now();
  let completed = false;
  const mark = (event, detail) => timeline.push({ ms: performance.now() - started, event, detail });
  t.after(() => { if (!completed) t.diagnostic('retained timeline: ' + JSON.stringify(timeline)); });
  const directory = mkdtempSync''',1)
s=s.replace('      allRequests.push(path);','''      allRequests.push(path);
      mark('request', { path, body: init?.body ? JSON.parse(init.body) : undefined });''',1)
s=s.replace('      const response = await fetch(input, init);','''      const response = await fetch(input, init);
      if (path === '/q/history') {
        const read = response.json.bind(response);
        response.json = async () => {
          const value = await read();
          mark('server-query', { room: JSON.parse(init.body).args.room, rows: value.data?.length, seq: value.seq, head: value.head, denied: value.denied });
          return value;
        };
      }''',1)
s=s.replace('const reply = await core.call(request); if (request.op === "query")', '''const reply = await core.call(request); mark('device', { op: request.op, name: request.name, room: request.args?.room, rows: reply.ok?.data?.length, unknown: reply.ok?.unknown, retained: reply.ok?.retained, complete: reply.ok?.complete, seq: reply.ok?.seq, acquired: reply.ok?.acquired, watermark: reply.ok?.watermark, denied: reply.denied }); if (request.op === "query")''',1)
s=s.replace('if (value.data) deliveries.push(value.data.length);','''if (value.data) deliveries.push(value.data.length); mark('publish', { rows: value.data?.length, loading: value.loading, fresh: value.fresh, complete: value.complete });''',1)
s=s.replace('  assert.equal((await post("/m/leave", { args: { room: "left" }, id: "leave-left" })).state, "sent");', '''  mark('leave-begin');
  assert.equal((await post("/m/leave", { args: { room: "left" }, id: "leave-left" })).state, "sent");
  mark('leave-committed');''',1)
needle='  console.log(`R5 ${tier} watch: rows=${watch.getSnapshot().data.length}, complete=${watch.getSnapshot().complete}; offline left: rows=25; revoked server: rows=0`);'
assert needle in s
s=s.replace(needle,needle+'\n  completed = true;')
target=root/'target/sl-load/controls'/('retained-history-trace.test.mjs' if tier == 'wasm' else 'retained-history-process-trace.test.mjs');target.write_text(s)
record={'source':str(source.relative_to(root)),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'control':str(target.relative_to(root)),'control_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'repetitions':100,'tier':tier,'scenario':'R5 history','assertions':'unchanged'}
Path(__file__).with_name('retained-control-source.json' if tier == 'wasm' else 'retained-process-control-source.json').write_text(json.dumps(record,indent=2)+'\n')
print(f'Prepared 100-repetition R5 {tier} timeline control; not executed.')
