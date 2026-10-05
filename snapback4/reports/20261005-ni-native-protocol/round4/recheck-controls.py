"""Explicit diagnostic replays of archived packets; never rewrite a live identity.

Run from the repository root with the instrument's Python dependencies. Arguments:
  archive root (20261005-ni), new output directory.
Each retained mutation carries SOURCE.json. Identical source files are omitted;
reconstruct them from the named immutable archive directory before validation.
"""
import importlib.util, json, shutil, sys, tempfile, time
from pathlib import Path

repo=Path.cwd();instrument=repo/'benchmarks/native/0.4.0-native.1'
sys.path.insert(0,str(instrument/'driver'))
from evidence import sha, verify_directory, viewonce_frame, viewonce_pixels
spec=importlib.util.spec_from_file_location('controls',instrument/'reference/artifact-controls.py')
controls=importlib.util.module_from_spec(spec);spec.loader.exec_module(controls)
archive=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=False)
qualified=json.loads((instrument/'QUALIFIED.json').read_text());results=[]
for segment,run in [('m6','none-m6-071102'),('m8','none-m8-071244')]:
    source=archive/'round3/runs'/run/'evidence'
    cases={'baseline':None,**(controls.CONTROLS if segment=='m6' else {
        **{c:controls.CONTROLS[c] for c in ['wrong-receipts','one-wrong-receipt','late-read']},
        'stale-restart-capture':'restart-capture-before-relaunch','missing-restart-screen':'restart-pending-screen-missing'})}
    if segment=='m6':cases.update({'search-retry':None,'missing-post-scroll-screen':None})
    for control,expected in cases.items():
        started=time.monotonic();dest=out/(segment+'-'+control);shutil.copytree(source,dest)
        manifest=dest/f'{segment}-ios-run.json';m=json.loads(manifest.read_text())
        original={key:m[key] for key in ['instrument','driverSourceSha256','driverBinarySha256']}
        # These fields identify the diagnostic verifier, not a new live execution.
        m.update(qualified);manifest.write_text(json.dumps(m,indent=2)+'\n')
        if control!='baseline':controls.mutate(dest,control,segment)
        try:
            _,receipts=verify_directory(dest,segment)
            reason='accepted';passed=all(r['pass'] for r in receipts)
        except Exception as exc:reason=str(exc);passed=None
        result={'segment':segment,'control':control,'expected':expected or 'accepted','reason':reason,
                'matched':reason.startswith(expected) if expected else reason=='accepted' and passed is True,
                'wallSeconds':round(time.monotonic()-started,3)}
        if segment=='m6' and (control in controls.PIXEL_CONTROLS or control in ['baseline','elsewhere-viewonce-pixels','bright-viewonce-pixels','contrast-viewonce-pixels','stale-viewonce-pixels']):
            frame=viewonce_frame(json.loads((dest/'prime-once.json').read_text()))
            stale,score=viewonce_pixels(dest/'prime-once.png',dest/'cold-once.png',frame,dest/'viewonce-fixture.png')
            result.update(stale=stale,score=score)
        # Retain every differing byte; bind unchanged ones to the source archive.
        inherited={}
        for file in sorted(dest.iterdir()):
            original_file=source/file.name
            if file.is_file() and original_file.is_file() and sha(file)==sha(original_file):
                inherited[file.name]=sha(original_file);file.unlink()
        (dest/'SOURCE.json').write_text(json.dumps({'kind':'diagnostic-replay-not-live','source':str(source),
            'sourceManifestSha256':sha(source/manifest.name),'originalIdentity':original,'verifier':qualified,
            'inheritedFiles':inherited,'result':result},indent=2)+'\n')
        results.append(result);print(json.dumps(result),flush=True)
(out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
sys.exit(0 if all(r['matched'] for r in results) else 1)
