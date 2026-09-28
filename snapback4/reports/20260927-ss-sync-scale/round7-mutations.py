from pathlib import Path
import json, os, shutil, subprocess
root=Path.cwd(); out=root/'target/lane-ss-round7'; base=out/'mutants'; base.mkdir(parents=True, exist_ok=True)
results=[]
def run(name, file, change, witness, case=None, source=False):
    if os.environ.get('ONLY') and os.environ['ONLY'] != name: return
    dest=base/name; dest.mkdir(exist_ok=True)
    pkg=dest/'sdk'; pkg.mkdir(exist_ok=True)
    folder='src' if source else 'dist'
    for part in ['src','dist']: shutil.copytree(root/'packages/snapback4'/part, pkg/part, dirs_exist_ok=True)
    shutil.copyfile(root/'packages/snapback4/package.json', pkg/'package.json')
    path=pkg/folder/file; before=path.read_text(); after=change(before); assert after!=before, name
    path.write_text(after)
    text=(root/'witness'/witness).read_text().replace("'./lib.mjs'", repr(str(root/'witness/lib.mjs')))
    text=text.replace("'../packages/snapback4/bin/web-shell.js'", repr(str(root/'packages/snapback4/bin/web-shell.js')))
    text=text.replace("'../packages/snapback4/dist/client.js'", repr(str(root/'packages/snapback4/dist/client.js')))
    text=text.replace("join(root, 'packages/snapback4/"+folder+"')", repr(str(pkg/folder)))
    text=text.replace("join(root, 'target/lane-ss-round4/worker-protocol')", repr(str(dest/'bundle')))
    if source: text=text.replace('const NativeWorker = window.Worker;', "import { webDevice as mutantDevice } from '${sdk}/web.ts';\nwindow.webDevice = mutantDevice;\nconst NativeWorker = window.Worker;")
    script=dest/witness; script.write_text(text)
    env=os.environ.copy()
    if case: env['SS_WORKER_CASE']=case
    command=['node',str(script),str(dest/'result.json')]
    with (dest/'run.log').open('w') as log: done=subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, env=env, timeout=90)
    result={'name':name,'exit':done.returncode,'command':command,'log':str((dest/'run.log').relative_to(root))}
    if (dest/'result.json').exists():
        raw=json.loads((dest/'result.json').read_text()); result['failures']=[r['name'] for r in raw.get('results',[]) if not r.get('ok',True)]
    results.append(result); print(json.dumps(result),flush=True)

def erase_restore(s):
    a=s.index('        if (status === "restore"'); b=s.index('        if (status !== "match")',a)
    return s[:a]+s[b:]
def erase_prep_catch(s):
    a=s.index('                    if (pendingCalls === 1'); b=s.index('                    return reply;',a)
    return s[:a]+'                    if (pendingCalls === 1 && ["admit", "enqueue", "settle", "settle_exit", "begin_send"].includes(String(request.op))) await suspension.prepare();\n'+s[b:]
run('lost-restore-proof','local.ts',erase_restore,'worker-watch.mjs',source=True)
run('old-observer-clears-refusal','local.ts',lambda s:s.replace('if (observed.denied || partitionDenied?.code === "E_STORE_RESTORE")', 'if (observed.denied)').replace('        if (partitionDenied?.code === "E_STORE_RESTORE") return false;\n        if (!denied)', '        if (!denied)'), 'worker-watch.mjs',source=True)
run('missing-control-drops-proof','local.ts',lambda s:s.replace('(!now || (now.transfer_store_id ?? now.store_id) === json.store_id)', '(now && (now.transfer_store_id ?? now.store_id) === json.store_id)'), 'worker-watch.mjs',source=True)
run('preparation-rejects-admission','web-worker-device.js',erase_prep_catch,'worker-protocol.mjs','exit preparation failure')
run('empty-worker-footprint','web-worker-runtime.js',lambda s:s.replace('predictions: unknown ? null : [...predictions]', 'predictions: []'),'worker-protocol.mjs','Worker emits')
run('forget-proof-before-save','web-worker-host.js',lambda s:s.replace('        const proof = this.restore;', '        const proof = this.restore; this.restore = undefined;'),'worker-protocol.mjs','restore evidence survives')
kept=json.loads((out/'mutations.json').read_text()) if os.environ.get('ONLY') and (out/'mutations.json').exists() else []
results=[r for r in kept if r['name'] not in {v['name'] for v in results}]+results
(out/'mutations.json').write_text(json.dumps(results,indent=2)+'\n')
assert all(r['exit']!=0 for r in results), 'a mutant survived'
