#!/usr/bin/env python3
"""Freeze a built package, adding diagnostic events only in the copied JS.
Run from snapback4: python3 reports/20261004-op-observation-publication/trace-sdk.py before
LU's page already collects window.events; no shipping source is edited.
"""
from pathlib import Path
import shutil, sys

root = Path(__file__).resolve().parents[2]
source = root / (sys.argv[2] if len(sys.argv) > 2 else 'packages/snapback4')
dest = root / 'target/op' / ('sdk-' + sys.argv[1])
dest.mkdir(parents=True, exist_ok=True)
shutil.copy2(source / 'package.json', dest)
shutil.copytree(source / 'dist', dest / 'dist', dirs_exist_ok=True)
prefix = "const opTrace = detail => globalThis.events?.push({stage:'op',at:performance.timeOrigin+performance.now(),...detail});\n"
p = dest / 'dist/local-query.js'
s = p.read_text()
s = s.replace('    const checkpoint = () => {', '    const checkpoint = (site) => {')
s = s.replace('        if (env.current && !env.current())\n            throw new Interrupted(loading);',
    "        if (env.current && !env.current()) { opTrace({event:'checkpoint-change',name:op.name,site,authority,current:env.authority}); throw new Interrupted(loading); }")
s = s.replace('        if (revision !== env.incarnation || authority !== env.authority)\n            throw new Interrupted(loading);',
    "        if (revision !== env.incarnation || authority !== env.authority) { opTrace({event:'checkpoint-authority',name:op.name,site,authority,current:env.authority,revision,incarnation:env.incarnation}); throw new Interrupted(loading); }")
for proof in ['covered', 'publicationCurrent', '(publishingCurrent ?? publicationCurrent)']:
    s = s.replace(f'        if ((env.current && !env.current() || authority !== env.authority) && !{proof}())\n            throw new Interrupted(loading);',
        f"        if ((env.current && !env.current() || authority !== env.authority) && !{proof}()) {{ opTrace({{event:'checkpoint-uncovered',name:op.name,site,authority,current:env.authority}}); throw new Interrupted(loading); }}")
lines = s.splitlines()
sites = []
for i, line in enumerate(lines):
    if 'checkpoint();' in line:
        sites.append(f'{i+1}: ' + '\n'.join(lines[max(0,i-2):i+1]))
        lines[i] = line.replace('checkpoint();', f'checkpoint({i+1});')
s = '\n'.join(lines) + '\n'
s = s.replace('}, undefined, eph);', "}, undefined, eph); opTrace({event:'decoded',name:op.name,seq:response.json?.seq,authority,current:env.authority});")
s = s.replace('        const result = await publish(candidate);', "        opTrace({event:'candidate',name:op.name,origin:candidate.origin,seq:candidate.result.seq,authority,current:env.authority});\n        const result = await publish(candidate);")
p.write_text(prefix + s)
(dest / 'checkpoint-sites.txt').write_text('\n\n'.join(sites))
p = dest / 'dist/local-reads.js'
s = p.read_text()
s += """
for (const method of ['notified','changed','applied','clear','withdrawScopes','refuse']) {
  const original = LocalReads.prototype[method];
  LocalReads.prototype[method] = function(...args) {
    const before = this.revision;
    const result = original.apply(this,args);
    opTrace({event:method,before,after:this.revision,name:method==='changed'?args[0].op.name:undefined,
      cut:method==='changed'||method==='notified'||method==='applied'?args[1]:undefined,
      operation:method==='clear'?args[3]:undefined});
    return result;
  };
}
"""
p.write_text(prefix + s)
p = dest / 'dist/local.js'
s = p.read_text().replace('if (revision !== incarnation || authority !== answers.revision || resetVersion !== watch.resetVersion || changeVersion !== watch.changeVersion) {', "if (revision !== incarnation || authority !== answers.revision || resetVersion !== watch.resetVersion || changeVersion !== watch.changeVersion) { opTrace({event:'rerun-reject',name:watch.op.name,authority,current:answers.revision,changeVersion,nowVersion:watch.changeVersion});")
s = s.replace('if (!answers.current(watch, result)) {', "if (!answers.current(watch, result)) { opTrace({event:'cut-reject',name:watch.op.name,seq:result.seq,serverOnly:result.serverOnly,cut:watch.changeCut,scope:watch.scopeCut});")
s = s.replace('if (revision !== incarnation || resetVersion !== watch.resetVersion || (authority !== answers.revision || changeVersion !== watch.changeVersion) && !result.publicationCurrent?.()) {',
    "if (revision !== incarnation || resetVersion !== watch.resetVersion || (authority !== answers.revision || changeVersion !== watch.changeVersion) && !result.publicationCurrent?.()) { opTrace({event:'rerun-reject',name:watch.op.name,authority,current:answers.revision,changeVersion,nowVersion:watch.changeVersion});")
p.write_text(prefix + s)
print(dest)
