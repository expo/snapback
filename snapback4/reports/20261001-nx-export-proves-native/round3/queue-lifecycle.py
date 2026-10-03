from pathlib import Path
import time,subprocess,json,os
report=Path(__file__).resolve().parent
while not (report/'config-controls.json').exists():time.sleep(5)
started=time.time()
with (report/'lifecycle-controls.log').open('x') as log:
    child=subprocess.Popen(['/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node',str(report/'lifecycle-controls.mjs')],stdout=log,stderr=subprocess.STDOUT)
    (report/'lifecycle-process.json').write_text(json.dumps({'pid':child.pid,'startedAt':started}))
    status=child.wait()
(report/'lifecycle-status.json').write_text(json.dumps({'status':status,'durationSeconds':time.time()-started})+'\n')
